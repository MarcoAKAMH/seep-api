const path = require('node:path');
const crypto = require('node:crypto');
const version = '2026_11_inventory_product_photos';
const sql = 'ALTER TABLE inv_producto ADD COLUMN fotos JSON NULL';

async function migrateInventoryPhotos(db, apply = false) {
  const [[database]] = await db.query('SELECT DATABASE() AS name');
  const lockName = 'inv_photos_' + crypto.createHash('sha256').update(database.name).digest('hex').slice(0, 40);
  let locked = false;
  try {
    if (apply) {
      const [[lock]] = await db.query('SELECT GET_LOCK(?, 10) AS acquired', [lockName]);
      if (Number(lock.acquired) !== 1) throw new Error('Otra migración de fotografías está en curso.');
      locked = true;
    }
    const [columns] = await db.query("SELECT DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inv_producto' AND COLUMN_NAME='fotos'");
    if (columns.length && columns[0].DATA_TYPE !== 'json') throw new Error('La columna fotos existe con un tipo incompatible.');
    if (!columns.length && apply) await db.query(sql);
    if (apply) await db.query('INSERT INTO inv_migracion(version,checksum) VALUES (?,?) ON DUPLICATE KEY UPDATE checksum=VALUES(checksum)', [version, crypto.createHash('sha256').update(sql).digest('hex')]);
    return { version, status: columns.length ? 'already_applied' : apply ? 'applied' : 'pending' };
  } finally { if (locked) await db.query('SELECT RELEASE_LOCK(?)', [lockName]); }
}

if (require.main === module) {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
  require('dotenv').config({ path: path.resolve(__dirname, '../.env.local'), override: true });
  const { pool } = require('../src/config/db');
  (async () => {
    const db = await pool.getConnection();
    try { console.log(JSON.stringify(await migrateInventoryPhotos(db, process.argv.includes('--apply')), null, 2)); }
    finally { db.release(); }
  })().catch(error => { console.error(error.code || error.message); process.exitCode = 1; }).finally(() => pool.end());
}
module.exports = { migrateInventoryPhotos };
