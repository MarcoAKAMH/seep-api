const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const version = '2026_09_inventory_foundation';
const source = fs.readFileSync(path.join(__dirname, '../sql', `${version}.sql`), 'utf8').replace(/\r\n/g, '\n');
const checksum = crypto.createHash('sha256').update(source).digest('hex');
const statements = source.replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean);
const tables = [...source.matchAll(/CREATE TABLE (inv_\w+)/g)].map(match => match[1]);

async function migrateInventory(db, apply = false) {
  let locked = false;
  let lockName;
  try {
    const [[server]] = await db.query('SELECT VERSION() AS version, DATABASE() AS db');
    const parts = server.version.split('.').map(n => parseInt(n, 10));
    if (/mariadb/i.test(server.version) || parts[0] < 8 || (parts[0] === 8 && parts[1] === 0 && parts[2] < 16)) {
      throw new Error('Se requiere MySQL 8.0.16 o posterior para aplicar las restricciones CHECK.');
    }
    lockName = `inv_migration_${crypto.createHash('sha256').update(server.db).digest('hex').slice(0, 40)}`;
    if (apply) {
      const [[lock]] = await db.query('SELECT GET_LOCK(?, 10) AS acquired', [lockName]);
      if (Number(lock.acquired) !== 1) throw new Error('Otra migración de inventario está en curso.');
      locked = true;
    }
    const [parents] = await db.query(`SELECT c.TABLE_NAME, c.COLUMN_TYPE, t.ENGINE
      FROM information_schema.COLUMNS c JOIN information_schema.TABLES t
      ON t.TABLE_SCHEMA=c.TABLE_SCHEMA AND t.TABLE_NAME=c.TABLE_NAME
      WHERE c.TABLE_SCHEMA=DATABASE() AND c.TABLE_NAME IN ('usuario','cat_sucursal') AND c.COLUMN_NAME='id'`);
    if (parents.length !== 2 || parents.some(row => row.COLUMN_TYPE.toLowerCase() !== 'bigint unsigned' || row.ENGINE !== 'InnoDB')) {
      throw new Error('usuario.id y cat_sucursal.id deben ser BIGINT UNSIGNED en tablas InnoDB.');
    }
    const [existing] = await db.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME LIKE 'inv\\_%'");
    const names = new Set(existing.map(row => row.TABLE_NAME));
    if (names.has('inv_migracion')) {
      const [history] = await db.query('SELECT checksum FROM inv_migracion WHERE version = ?', [version]);
      if (history.length) {
        if (history[0].checksum !== checksum) throw new Error('La migración aplicada tiene otro checksum. No edites migraciones ya aplicadas.');
        if (tables.some(table => !names.has(table))) throw new Error('Faltan tablas de una migración registrada. Requiere revisión.');
        return { version, status: 'already_applied', tables };
      }
    }
    if (tables.some(table => names.has(table))) {
      throw new Error('Existen tablas de inventario sin versión completada. Posible aplicación parcial: revisar antes de continuar; no se borrarán datos.');
    }
    if (!apply) return { version, status: 'pending', tables };
    // MySQL DDL commits implicitly. Record completion only after every statement succeeds.
    await db.query(`CREATE TABLE IF NOT EXISTS inv_migracion (
      version VARCHAR(100) PRIMARY KEY, checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    for (const sql of statements) await db.query(sql);
    await db.query('INSERT INTO inv_migracion(version, checksum) VALUES (?, ?)', [version, checksum]);
    return { version, status: 'applied', tables };
  } finally {
    if (locked) await db.query('SELECT RELEASE_LOCK(?)', [lockName]);
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['--check', '--apply'].includes(args[0])) {
    console.error('Uso: node scripts/migrate-inventory.js --check | --apply');
    process.exitCode = 1;
  } else {
    const dotenv = require('dotenv');
    dotenv.config({ path: path.resolve(__dirname, '../.env') });
    dotenv.config({ path: path.resolve(__dirname, '../.env.local'), override: true });
    const { pool } = require('../src/config/db');
    (async () => {
      const db = await pool.getConnection();
      try { console.log(JSON.stringify(await migrateInventory(db, args[0] === '--apply'), null, 2)); }
      finally { db.release(); }
    })().catch(error => {
      console.error(error.code ? `Error de base de datos: ${error.code}` : error.message);
      process.exitCode = 1;
    }).finally(() => pool.end());
  }
}

module.exports = { migrateInventory, tables };
