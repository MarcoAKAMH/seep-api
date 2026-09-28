const crypto = require('node:crypto');
const { pool } = require('../config/db');
const { applyDocument, toUnits, fromUnits } = require('./inventoryMovement');

function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
const token = prefix => `${prefix}:${crypto.randomUUID()}`;
const operationKey = (prefix, value) => `${prefix}:${crypto.createHash('sha256').update(String(value)).digest('hex')}`;

async function dispatchTransfer(input, userId) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    if (Number(input.sucursal_origen_id) === Number(input.sucursal_destino_id)) fail('La transferencia requiere sucursales distintas.');
    const [destination] = await db.query(`SELECT u.id FROM inv_ubicacion u JOIN inv_almacen a ON a.id=u.almacen_id AND a.sucursal_id=u.sucursal_id
      WHERE u.id=? AND u.almacen_id=? AND u.sucursal_id=? AND u.activo=1 AND a.activo=1 FOR UPDATE`,
      [input.ubicacion_destino_id, input.almacen_destino_id, input.sucursal_destino_id]);
    if (!destination.length) fail('La ubicación de destino no existe o está inactiva.');
    const output = await applyDocument({ sucursal_id: input.sucursal_origen_id, tipo: 'TRANSFERENCIA_SALIDA', internal_control: true,
      motivo: input.motivo, referencia: input.referencia, idempotencia: operationKey('transfer-out', input.idempotencia), detalles: input.detalles.map(line => ({
        producto_id: line.producto_id, almacen_id: input.almacen_origen_id, ubicacion_id: input.ubicacion_origen_id, cantidad: line.cantidad,
      })) }, userId, db);
    const [movements] = await db.query(`SELECT m.producto_id,m.cantidad_delta,m.costo_unitario FROM inv_movimiento m
      JOIN inv_documento_detalle dd ON dd.id=m.detalle_id WHERE dd.documento_id=?`, [output.id]);
    const folio = `TR-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const [transfer] = await db.query(`INSERT INTO inv_transferencia(folio,sucursal_origen_id,almacen_origen_id,ubicacion_origen_id,
      sucursal_destino_id,almacen_destino_id,ubicacion_destino_id,motivo,referencia,idempotencia,documento_salida_id,creado_por)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [folio,input.sucursal_origen_id,input.almacen_origen_id,input.ubicacion_origen_id,
      input.sucursal_destino_id,input.almacen_destino_id,input.ubicacion_destino_id,input.motivo,input.referencia || null,input.idempotencia,output.id,userId]);
    await db.query('INSERT INTO inv_transferencia_detalle(transferencia_id,producto_id,cantidad,costo_unitario) VALUES ?',
      [movements.map(row => [transfer.insertId,row.producto_id,fromUnits(toUnits(String(row.cantidad_delta).replace(/^-/, ''))),row.costo_unitario])]);
    await db.commit();
    return { id: Number(transfer.insertId), folio, estado: 'DESPACHADA' };
  } catch (error) {
    await db.rollback();
    if (error.code === 'ER_DUP_ENTRY') fail('Esta transferencia ya fue registrada.', 409);
    throw error;
  } finally { db.release(); }
}

async function receiveTransfer(transferId, userId) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [rows] = await db.query('SELECT * FROM inv_transferencia WHERE id=? FOR UPDATE', [transferId]);
    if (!rows.length) fail('La transferencia no existe.', 404);
    const transfer = rows[0];
    if (transfer.estado !== 'DESPACHADA') fail('La transferencia ya fue recibida.', 409);
    const [details] = await db.query('SELECT * FROM inv_transferencia_detalle WHERE transferencia_id=? ORDER BY id FOR UPDATE', [transferId]);
    const input = await applyDocument({ sucursal_id: transfer.sucursal_destino_id, tipo: 'TRANSFERENCIA_ENTRADA', internal_control: true,
      motivo: `Recepción ${transfer.folio}: ${transfer.motivo}`, referencia: transfer.referencia, idempotencia: operationKey('transfer-in', transfer.idempotencia),
      detalles: details.map(line => ({ producto_id: line.producto_id, almacen_id: transfer.almacen_destino_id,
        ubicacion_id: transfer.ubicacion_destino_id, cantidad: line.cantidad, costo_unitario: line.costo_unitario })) }, userId, db);
    await db.query(`UPDATE inv_transferencia SET estado='RECIBIDA',documento_entrada_id=?,recibido_por=?,recibido_at=UTC_TIMESTAMP(6) WHERE id=?`, [input.id,userId,transferId]);
    await db.commit(); return { id: Number(transferId), folio: transfer.folio, estado: 'RECIBIDA' };
  } catch (error) { await db.rollback(); throw error; } finally { db.release(); }
}

async function requestAdjustment(input, userId) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [stock] = await db.query(`SELECT cantidad FROM inv_existencia WHERE producto_id=? AND ubicacion_id=? AND almacen_id=? AND sucursal_id=? FOR UPDATE`,
      [input.producto_id,input.ubicacion_id,input.almacen_id,input.sucursal_id]);
    const current = stock[0]?.cantidad || '0.000000';
    if (toUnits(current) === toUnits(input.cantidad_contada)) fail('La cantidad contada coincide con el sistema; no se requiere ajuste.');
    const [result] = await db.query(`INSERT INTO inv_ajuste_solicitud(sucursal_id,producto_id,almacen_id,ubicacion_id,existencia_sistema,cantidad_contada,costo_unitario,motivo,solicitado_por)
      VALUES (?,?,?,?,?,?,?,?,?)`, [input.sucursal_id,input.producto_id,input.almacen_id,input.ubicacion_id,current,input.cantidad_contada,input.costo_unitario || null,input.motivo,userId]);
    await db.commit(); return { id: Number(result.insertId), estado: 'PENDIENTE', existencia_sistema: current };
  } catch (error) { await db.rollback(); throw error; } finally { db.release(); }
}

async function decideAdjustment(adjustmentId, approve, userId, reason) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [rows] = await db.query('SELECT * FROM inv_ajuste_solicitud WHERE id=? FOR UPDATE', [adjustmentId]);
    if (!rows.length) fail('La solicitud no existe.', 404);
    const adjustment = rows[0];
    if (adjustment.estado !== 'PENDIENTE') fail('La solicitud ya fue decidida.', 409);
    if (!approve) {
      await db.query(`UPDATE inv_ajuste_solicitud SET estado='RECHAZADO',decidido_por=?,decidido_at=UTC_TIMESTAMP(6),motivo=CONCAT(motivo,' | Rechazo: ',?) WHERE id=?`, [userId,reason,adjustmentId]);
      await db.commit(); return { id: Number(adjustmentId), estado: 'RECHAZADO' };
    }
    const [stocks] = await db.query('SELECT cantidad FROM inv_existencia WHERE producto_id=? AND ubicacion_id=? FOR UPDATE', [adjustment.producto_id,adjustment.ubicacion_id]);
    const current = stocks[0]?.cantidad || '0.000000';
    if (toUnits(current) !== toUnits(adjustment.existencia_sistema)) fail('La existencia cambió después del conteo. Rechaza esta solicitud y realiza un conteo nuevo.', 409);
    const difference = toUnits(adjustment.cantidad_contada) - toUnits(adjustment.existencia_sistema);
    const [costs] = await db.query('SELECT costo_promedio FROM inv_costo_sucursal WHERE producto_id=? AND sucursal_id=? FOR UPDATE', [adjustment.producto_id,adjustment.sucursal_id]);
    const average = costs[0]?.costo_promedio || '0.000000';
    const cost = difference > 0n ? (toUnits(average) > 0n ? average : adjustment.costo_unitario) : undefined;
    if (difference > 0n && (cost === null || cost === undefined)) fail('Indica el costo unitario para aprobar una diferencia positiva sin costo promedio.');
    const document = await applyDocument({ sucursal_id: adjustment.sucursal_id, tipo: 'AJUSTE', internal_control: true,
      direccion: difference > 0n ? 'ENTRADA' : 'SALIDA', motivo: `Ajuste autorizado: ${adjustment.motivo}`,
      referencia: `AJUSTE-${adjustmentId}`, idempotencia: token(`adjustment:${adjustmentId}`), detalles: [{ producto_id: adjustment.producto_id,
        almacen_id: adjustment.almacen_id, ubicacion_id: adjustment.ubicacion_id, cantidad: fromUnits(difference > 0n ? difference : -difference),
        ...(difference > 0n ? { costo_unitario: cost } : {}) }] }, userId, db);
    await db.query(`UPDATE inv_ajuste_solicitud SET estado='APROBADO',decidido_por=?,decidido_at=UTC_TIMESTAMP(6),documento_id=? WHERE id=?`, [userId,document.id,adjustmentId]);
    await db.commit(); return { id: Number(adjustmentId), estado: 'APROBADO', documento_id: document.id };
  } catch (error) { await db.rollback(); throw error; } finally { db.release(); }
}

async function reverseDocument(documentId, userId, reason) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [documents] = await db.query('SELECT * FROM inv_documento WHERE id=? FOR UPDATE', [documentId]);
    if (!documents.length) fail('El documento no existe.', 404);
    const original = documents[0];
    if (!['INICIAL','ENTRADA','SALIDA','DEVOLUCION'].includes(original.tipo) || original.estado !== 'APLICADO') fail('Este documento no admite reversa.');
    const [prior] = await db.query("SELECT id FROM inv_documento WHERE documento_origen_id=? AND tipo='REVERSA'", [documentId]);
    if (prior.length) fail('El documento ya fue reversado.', 409);
    const [details] = await db.query(`SELECT dd.*,m.cantidad_delta,m.costo_unitario movimiento_costo FROM inv_documento_detalle dd
      JOIN inv_movimiento m ON m.detalle_id=dd.id WHERE dd.documento_id=? ORDER BY dd.id FOR UPDATE`, [documentId]);
    const originalInbound = toUnits(details[0].cantidad_delta) > 0n;
    const reversal = await applyDocument({ sucursal_id: original.sucursal_id, tipo: 'REVERSA', internal_control: true,
      direccion: originalInbound ? 'SALIDA' : 'ENTRADA', documento_origen_id: documentId, motivo: `Reversa: ${reason}`,
      referencia: original.folio, idempotencia: token(`reversal:${documentId}`), detalles: details.map(line => ({ producto_id: line.producto_id,
        almacen_id: line.almacen_id, ubicacion_id: line.ubicacion_id, cantidad: line.cantidad,
        ...(!originalInbound ? { costo_unitario: line.movimiento_costo } : {}) })) }, userId, db);
    await db.commit(); return reversal;
  } catch (error) {
    await db.rollback();
    if (error.code === 'ER_DUP_ENTRY') fail('El documento ya fue reversado.', 409);
    throw error;
  } finally { db.release(); }
}

module.exports = { dispatchTransfer, receiveTransfer, requestAdjustment, decideAdjustment, reverseDocument };
