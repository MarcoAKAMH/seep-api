const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local'), override: true });
const { pool } = require('../src/config/db');

const countTables = [
  'inv_producto', 'inv_producto_almacen', 'inv_costo_sucursal', 'inv_existencia',
  'inv_documento', 'inv_documento_detalle', 'inv_movimiento', 'inv_notificacion',
  'inv_notificacion_lectura', 'inv_transferencia', 'inv_transferencia_detalle',
  'inv_ajuste_solicitud', 'inv_producto_proveedor', 'inv_orden_compra',
  'inv_orden_compra_detalle', 'inv_recepcion_compra', 'inv_recepcion_compra_detalle',
  'inv_conteo_ciclico', 'inv_conteo_ciclico_detalle', 'inv_auditoria',
];

async function counts(db) {
  const result = {};
  for (const table of countTables) {
    const [[row]] = await db.query(`SELECT COUNT(*) total FROM ${table}`);
    result[table] = Number(row.total);
  }
  return result;
}

async function resetInventoryProducts(apply = false) {
  const db = await pool.getConnection();
  let locked = false;
  try {
    const [[database]] = await db.query('SELECT DATABASE() nombre');
    const before = await counts(db);
    if (!apply) return { database: database.nombre, mode: 'preview', before };

    const [[lock]] = await db.query("SELECT GET_LOCK('seep_inventory_product_reset', 10) acquired");
    if (Number(lock.acquired) !== 1) throw new Error('Otra operación de inventario está en curso.');
    locked = true;
    await db.beginTransaction();

    await db.query('DELETE FROM inv_conteo_ciclico_detalle');
    await db.query('DELETE FROM inv_conteo_ciclico');
    await db.query('DELETE FROM inv_recepcion_compra_detalle');
    await db.query('DELETE FROM inv_recepcion_compra');
    await db.query('DELETE FROM inv_orden_compra_detalle');
    await db.query('DELETE FROM inv_orden_compra');
    await db.query('DELETE FROM inv_producto_proveedor');
    await db.query('DELETE FROM inv_transferencia_detalle');
    await db.query('DELETE FROM inv_transferencia');
    await db.query('DELETE FROM inv_ajuste_solicitud');
    await db.query('DELETE FROM inv_notificacion_lectura');
    await db.query('DELETE FROM inv_notificacion');
    await db.query('DELETE FROM inv_movimiento WHERE reversa_de_id IS NOT NULL');
    await db.query('DELETE FROM inv_movimiento');
    await db.query('DELETE FROM inv_documento_detalle');
    await db.query('DELETE FROM inv_documento WHERE documento_origen_id IS NOT NULL');
    await db.query('DELETE FROM inv_documento');
    await db.query('DELETE FROM inv_existencia');
    await db.query('DELETE FROM inv_costo_sucursal');
    await db.query('DELETE FROM inv_producto_almacen');
    await db.query('DELETE FROM inv_producto');
    await db.query('DELETE FROM inv_auditoria');

    const after = await counts(db);
    const remaining = Object.values(after).reduce((sum, value) => sum + value, 0);
    if (remaining !== 0) throw new Error(`El reinicio dejó ${remaining} registros dependientes.`);
    await db.commit();
    return { database: database.nombre, mode: 'applied', before, after };
  } catch (error) {
    try { await db.rollback(); } catch {}
    throw error;
  } finally {
    if (locked) await db.query("SELECT RELEASE_LOCK('seep_inventory_product_reset')");
    db.release();
  }
}

if (require.main === module) {
  const apply = process.argv.includes('--apply');
  if (process.argv.some(arg => arg.startsWith('--') && arg !== '--apply')) {
    console.error('Uso: node scripts/reset-inventory-products.js [--apply]');
    process.exitCode = 1;
  } else {
    resetInventoryProducts(apply).then(result => console.log(JSON.stringify(result, null, 2)))
      .catch(error => { console.error(error.message); process.exitCode = 1; })
      .finally(() => pool.end());
  }
}

module.exports = { resetInventoryProducts };
