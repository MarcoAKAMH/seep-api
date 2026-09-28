const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const version = '2026_09_inventory_controls';
const source = fs.readFileSync(path.join(__dirname, '../sql', `${version}.sql`), 'utf8').replace(/\r\n/g, '\n');
const checksum = crypto.createHash('sha256').update(source).digest('hex');
const statements = source.replace(/^--.*$/gm, '').split(';').map(value => value.trim()).filter(Boolean);
const tables = ['inv_transferencia', 'inv_transferencia_detalle', 'inv_ajuste_solicitud'];

async function migrateInventoryControls(db, apply = false) {
  const [[server]] = await db.query('SELECT DATABASE() db');
  const lockName = `inv_controls_${crypto.createHash('sha256').update(server.db).digest('hex').slice(0, 40)}`;
  let locked = false;
  try {
    const [history] = await db.query('SELECT checksum FROM inv_migracion WHERE version=?', [version]);
    if (history.length) {
      if (history[0].checksum !== checksum) throw new Error('La migración de controles aplicada tiene otro checksum.');
      const [existing] = await db.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?)", [tables]);
      if (existing.length !== tables.length) throw new Error('Faltan tablas de controles registradas como aplicadas.');
      return { version, status: 'already_applied', tables };
    }
    const [existing] = await db.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?)", [tables]);
    if (existing.length) throw new Error('Existen tablas parciales de controles; requiere revisión manual.');
    if (!apply) return { version, status: 'pending', tables };
    const [[lock]] = await db.query('SELECT GET_LOCK(?,10) acquired', [lockName]);
    if (Number(lock.acquired) !== 1) throw new Error('Otra migración de inventario está en curso.');
    locked = true;
    for (const statement of statements) await db.query(statement);
    await db.query('INSERT INTO inv_migracion(version,checksum) VALUES (?,?)', [version, checksum]);
    return { version, status: 'applied', tables };
  } finally { if (locked) await db.query('SELECT RELEASE_LOCK(?)', [lockName]); }
}
if (require.main === module) {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
  require('dotenv').config({ path: path.resolve(__dirname, '../.env.local'), override: true });
  const { pool } = require('../src/config/db');
  const apply = process.argv.includes('--apply');
  (async () => { const db = await pool.getConnection(); try { console.log(JSON.stringify(await migrateInventoryControls(db, apply), null, 2)); } finally { db.release(); } })()
    .catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
}
module.exports = { migrateInventoryControls, tables };
