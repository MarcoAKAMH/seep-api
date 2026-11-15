const crypto = require('node:crypto');
const { pool } = require('../config/db');
const { applyDocument, toUnits, fromUnits } = require('./inventoryMovement');
const { syncInventoryAlerts } = require('./inventoryAlerts');

function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }

async function relocateStock(input, userId) {
  if (input.ubicacion_origen_id === input.ubicacion_destino_id) fail('Selecciona una ubicación de destino distinta al origen.');
  const quantity = fromUnits(toUnits(input.cantidad));
  if (toUnits(quantity) === 0n) fail('La cantidad debe ser mayor a cero.');
  const key = crypto.createHash('sha256').update(`${input.sucursal_id}:${input.idempotencia}`).digest('hex');
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    // Same lock order as the movement engine; serialize retries and competing exits.
    const [branches] = await db.query('SELECT id FROM cat_sucursal WHERE id=? FOR UPDATE', [input.sucursal_id]);
    if (!branches.length) fail('La sucursal no existe.');
    const [previous] = await db.query(`SELECT d.id,d.referencia,d.motivo,d.creado_por,dd.producto_id,dd.ubicacion_id origen,dd.cantidad,
        e.id entrada_id,ed.ubicacion_id destino,mo.saldo_posterior saldo_origen,mi.saldo_posterior saldo_destino
      FROM inv_documento d JOIN inv_documento_detalle dd ON dd.documento_id=d.id
      JOIN inv_documento e ON e.documento_origen_id=d.id AND e.tipo='TRANSFERENCIA_ENTRADA' AND e.sucursal_id=d.sucursal_id
      JOIN inv_documento_detalle ed ON ed.documento_id=e.id
      JOIN inv_movimiento mo ON mo.detalle_id=dd.id JOIN inv_movimiento mi ON mi.detalle_id=ed.id
      WHERE d.idempotencia=? AND d.sucursal_id=? FOR UPDATE`, [`relocation-out:${key}`, input.sucursal_id]);
    if (previous.length) {
      const row = previous[0];
      if (Number(row.creado_por) !== userId || Number(row.producto_id) !== input.producto_id
        || Number(row.origen) !== input.ubicacion_origen_id || Number(row.destino) !== input.ubicacion_destino_id
        || row.cantidad !== quantity || row.motivo !== input.motivo) fail('Esta solicitud ya se utilizó para otro traslado.', 409);
      await db.commit();
      return { folio: row.referencia, documento_salida_id: Number(row.id), documento_entrada_id: Number(row.entrada_id),
        saldo_origen: row.saldo_origen, saldo_destino: row.saldo_destino, duplicated: true };
    }
    const [locations] = await db.query(`SELECT u.id,u.almacen_id FROM inv_ubicacion u
      JOIN inv_almacen a ON a.id=u.almacen_id AND a.sucursal_id=u.sucursal_id
      WHERE u.id IN (?,?) AND u.sucursal_id=? AND u.activo=1 AND a.activo=1 ORDER BY u.id FOR UPDATE`,
    [input.ubicacion_origen_id, input.ubicacion_destino_id, input.sucursal_id]);
    if (locations.length !== 2) fail('Origen y destino deben estar activos y pertenecer a la misma sucursal.');
    const origin = locations.find(row => Number(row.id) === input.ubicacion_origen_id);
    const destination = locations.find(row => Number(row.id) === input.ubicacion_destino_id);
    const folio = `TI-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const common = { sucursal_id: input.sucursal_id, motivo: input.motivo, referencia: folio, fecha_operacion: new Date() };
    const line = { producto_id: input.producto_id, cantidad: quantity };
    const output = await applyDocument({ ...common, tipo: 'TRANSFERENCIA_SALIDA', idempotencia: `relocation-out:${key}`,
      detalles: [{ ...line, almacen_id: origin.almacen_id, ubicacion_id: origin.id }] }, userId, db, { internalRelocation: true });
    const entry = await applyDocument({ ...common, tipo: 'TRANSFERENCIA_ENTRADA', idempotencia: `relocation-in:${key}`,
      documento_origen_id: output.id, detalles: [{ ...line, almacen_id: destination.almacen_id, ubicacion_id: destination.id }] },
    userId, db, { internalRelocation: true });
    // Evaluate only final balances, never the temporary balance between both legs.
    await syncInventoryAlerts(db, [input.sucursal_id]);
    const [stocks] = await db.query('SELECT ubicacion_id,cantidad FROM inv_existencia WHERE producto_id=? AND ubicacion_id IN (?,?)',
      [input.producto_id, origin.id, destination.id]);
    await db.commit();
    return { folio, documento_salida_id: output.id, documento_entrada_id: entry.id,
      saldo_origen: stocks.find(row => Number(row.ubicacion_id) === input.ubicacion_origen_id).cantidad,
      saldo_destino: stocks.find(row => Number(row.ubicacion_id) === input.ubicacion_destino_id).cantidad, duplicated: false };
  } catch (error) {
    await db.rollback();
    throw error;
  } finally { db.release(); }
}

module.exports = { relocateStock };
