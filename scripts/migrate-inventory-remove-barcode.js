const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const version = '2026_09_inventory_remove_barcode';
const source = fs.readFileSync(path.join(__dirname, '../sql', `${version}.sql`), 'utf8').replace(/\r\n/g, '\n');
const checksum = crypto.createHash('sha256').update(source).digest('hex');

async function migrateInventoryRemoveBarcode(db, apply = false) {
  let locked = false;
  const [[server]] = await db.query('SELECT DATABASE() AS db');
  const lockName = `inv_remove_barcode_${crypto.createHash('sha256').update(server.db).digest('hex').slice(0, 36)}`;
  try {
    const [columns] = await db.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inv_producto' AND COLUMN_NAME='codigo_barras'`);
    const [indexes] = await db.query(`SELECT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inv_producto' AND INDEX_NAME='uq_inv_producto_barcode'`);
    const pending = columns.length > 0 || indexes.length > 0;
    if (!apply) return { version, status: pending ? 'pending' : 'already_applied', column_present: columns.length > 0, index_present: indexes.length > 0 };

    const [[lock]] = await db.query('SELECT GET_LOCK(?, 10) AS acquired', [lockName]);
    if (Number(lock.acquired) !== 1) throw new Error('Otra migración de inventario está en curso.');
    locked = true;
    if (indexes.length) await db.query('ALTER TABLE inv_producto DROP INDEX uq_inv_producto_barcode');
    if (columns.length) await db.query('ALTER TABLE inv_producto DROP COLUMN codigo_barras');
    await db.query(`INSERT INTO inv_migracion(version,checksum) VALUES (?,?)
      ON DUPLICATE KEY UPDATE checksum=VALUES(checksum)`, [version, checksum]);
    return { version, status: pending ? 'applied' : 'already_applied', column_present: false, index_present: false };
  } finally {
    if (locked) await db.query('SELECT RELEASE_LOCK(?)', [lockName]);
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['--check', '--apply'].includes(args[0])) {
    console.error('Uso: node scripts/migrate-inventory-remove-barcode.js --check | --apply');
    process.exitCode = 1;
  } else {
    require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
    require('dotenv').config({ path: path.resolve(__dirname, '../.env.local'), override: true });
    const { pool } = require('../src/config/db');
    (async () => {
      const db = await pool.getConnection();
      try { console.log(JSON.stringify(await migrateInventoryRemoveBarcode(db, args[0] === '--apply'), null, 2)); }
      finally { db.release(); }
    })().catch(error => { console.error(error.code ? `Error de base de datos: ${error.code}` : error.message); process.exitCode = 1; }).finally(() => pool.end());
  }
}

module.exports = { migrateInventoryRemoveBarcode };
