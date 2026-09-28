const crypto = require('node:crypto');
const { pool } = require('../config/db');
const { syncInventoryAlerts } = require('./inventoryAlerts');

const SCALE = 1000000n;
const INBOUND = new Set(['INICIAL', 'ENTRADA', 'DEVOLUCION', 'TRANSFERENCIA_ENTRADA']);
const OUTBOUND = new Set(['SALIDA', 'TRANSFERENCIA_SALIDA']);

function inventoryError(message, status = 400) { return Object.assign(new Error(message), { status }); }
function toUnits(value, label = 'valor') {
  const text = String(value);
  if (!/^(0|[1-9]\d{0,11})(\.\d{1,6})?$/.test(text)) throw inventoryError(`${label} debe ser un decimal positivo con máximo 6 decimales.`);
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, '0'));
}
function fromUnits(value) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const fraction = String(absolute % SCALE).padStart(6, '0');
  return `${negative ? '-' : ''}${absolute / SCALE}.${fraction}`;
}
function weightedAverage(oldQty, oldCost, inQty, inCost) {
  const total = oldQty + inQty;
  if (total === 0n) return 0n;
  // Values are fixed-point; divide only once and round to nearest millionth.
  return ((oldQty * oldCost) + (inQty * inCost) + total / 2n) / total;
}

async function applyDocument(input, userId, externalConnection = null) {
  const ownConnection = !externalConnection;
  const db = externalConnection || await pool.getConnection();
  try {
    if (ownConnection) await db.beginTransaction();
    const type = String(input.tipo || '');
    const internalType = input.internal_control === true && ['AJUSTE', 'REVERSA'].includes(type);
    if (!INBOUND.has(type) && !OUTBOUND.has(type) && !internalType) throw inventoryError('Tipo de movimiento no permitido.');
    if (!Array.isArray(input.detalles) || input.detalles.length < 1 || input.detalles.length > 200) throw inventoryError('Agrega entre 1 y 200 partidas.');
    const branchId = Number(input.sucursal_id);
    if (!Number.isSafeInteger(branchId) || branchId <= 0) throw inventoryError('Sucursal inválida.');
    const reason = String(input.motivo || '').trim();
    if (!reason || reason.length > 500) throw inventoryError('Escribe un motivo de hasta 500 caracteres.');
    const reference = String(input.referencia || '').trim() || null;
    if (reference && reference.length > 180) throw inventoryError('La referencia excede 180 caracteres.');
    const idempotency = String(input.idempotencia || '').trim();
    if (!/^[A-Za-z0-9_.:-]{16,80}$/.test(idempotency)) throw inventoryError('Identificador de operación inválido.');
    const [existing] = await db.query('SELECT id,folio FROM inv_documento WHERE idempotencia=?', [idempotency]);
    if (existing.length) {
      if (ownConnection) await db.commit();
      return { id: Number(existing[0].id), folio: existing[0].folio, duplicated: true };
    }
    const prepared = input.detalles.map((line, index) => {
      const productId = Number(line.producto_id), warehouseId = Number(line.almacen_id), locationId = Number(line.ubicacion_id);
      if (![productId, warehouseId, locationId].every(n => Number.isSafeInteger(n) && n > 0)) throw inventoryError(`Partida ${index + 1}: referencias inválidas.`);
      const quantity = toUnits(line.cantidad, `Partida ${index + 1}: cantidad`);
      if (quantity <= 0n) throw inventoryError(`Partida ${index + 1}: la cantidad debe ser mayor a cero.`);
      const inboundLine = INBOUND.has(type) || (internalType && input.direccion === 'ENTRADA');
      const suppliedCost = inboundLine ? toUnits(line.costo_unitario, `Partida ${index + 1}: costo`) : null;
      return { productId, warehouseId, locationId, quantity, suppliedCost };
    });
    const keys = new Set();
    for (const line of prepared) {
      const key = `${line.productId}:${line.locationId}`;
      if (keys.has(key)) throw inventoryError('Un artículo y ubicación no pueden repetirse en el mismo documento.');
      keys.add(key);
    }
    const [branches] = await db.query('SELECT id FROM cat_sucursal WHERE id=? FOR UPDATE', [branchId]);
    if (!branches.length) throw inventoryError('La sucursal no existe.');
    const folio = `${type.slice(0, 3)}-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const now = new Date();
    const authorized = type === 'AJUSTE' ? userId : null;
    const [document] = await db.query(`INSERT INTO inv_documento
      (sucursal_id,folio,tipo,estado,motivo,referencia,documento_origen_id,idempotencia,creado_por,autorizado_por,aplicado_por,fecha_operacion,autorizado_at,aplicado_at)
      VALUES (?,?,?,'APLICADO',?,?,?,?,?,?,?,?,?,?)`, [branchId, folio, type, reason, reference, input.documento_origen_id || null,
      idempotency, userId, authorized, userId, input.fecha_operacion ? new Date(input.fecha_operacion) : now, authorized ? now : null, now]);
    const documentId = document.insertId;
    for (const line of prepared) {
      const [valid] = await db.query(`SELECT p.id producto_id,p.activo producto_activo,a.activo almacen_activo,u.activo ubicacion_activa
        FROM inv_producto p JOIN inv_almacen a ON a.id=? AND a.sucursal_id=?
        JOIN inv_ubicacion u ON u.id=? AND u.almacen_id=a.id AND u.sucursal_id=a.sucursal_id
        WHERE p.id=? FOR UPDATE`, [line.warehouseId, branchId, line.locationId, line.productId]);
      if (!valid.length || !valid[0].producto_activo || !valid[0].almacen_activo || !valid[0].ubicacion_activa) throw inventoryError('Una partida usa un artículo, almacén o ubicación inexistente/inactivo.');
      await db.query(`INSERT INTO inv_producto_almacen(producto_id,almacen_id,sucursal_id,minimo,maximo,punto_reorden)
        VALUES (?,?,?,0,0,0) ON DUPLICATE KEY UPDATE producto_id=VALUES(producto_id)`, [line.productId, line.warehouseId, branchId]);
      const [allStocks] = await db.query('SELECT cantidad FROM inv_existencia WHERE producto_id=? AND sucursal_id=? FOR UPDATE', [line.productId, branchId]);
      const branchQty = allStocks.reduce((sum, row) => sum + toUnits(row.cantidad), 0n);
      const [costRows] = await db.query('SELECT costo_promedio,ultimo_costo FROM inv_costo_sucursal WHERE producto_id=? AND sucursal_id=? FOR UPDATE', [line.productId, branchId]);
      const oldAverage = costRows.length ? toUnits(costRows[0].costo_promedio) : 0n;
      const [stockRows] = await db.query('SELECT cantidad FROM inv_existencia WHERE producto_id=? AND ubicacion_id=? FOR UPDATE', [line.productId, line.locationId]);
      const locationQty = stockRows.length ? toUnits(stockRows[0].cantidad) : 0n;
      const inbound = INBOUND.has(type) || (internalType && input.direccion === 'ENTRADA');
      const newLocationQty = inbound ? locationQty + line.quantity : locationQty - line.quantity;
      if (newLocationQty < 0n) throw inventoryError(`Stock insuficiente para el artículo ${line.productId} en la ubicación seleccionada.`, 409);
      const movementCost = inbound ? line.suppliedCost : oldAverage;
      const newAverage = inbound ? weightedAverage(branchQty, oldAverage, line.quantity, movementCost) : oldAverage;
      await db.query(`INSERT INTO inv_existencia(producto_id,ubicacion_id,almacen_id,sucursal_id,cantidad,ultimo_movimiento_at)
        VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE cantidad=VALUES(cantidad),ultimo_movimiento_at=VALUES(ultimo_movimiento_at)`,
        [line.productId, line.locationId, line.warehouseId, branchId, fromUnits(newLocationQty), now]);
      await db.query(`INSERT INTO inv_costo_sucursal(producto_id,sucursal_id,costo_promedio,ultimo_costo)
        VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE costo_promedio=VALUES(costo_promedio),ultimo_costo=VALUES(ultimo_costo)`,
        [line.productId, branchId, fromUnits(newAverage), fromUnits(inbound ? movementCost : (costRows.length ? toUnits(costRows[0].ultimo_costo) : 0n))]);
      const [detail] = await db.query(`INSERT INTO inv_documento_detalle(documento_id,sucursal_id,producto_id,almacen_id,ubicacion_id,cantidad,costo_unitario)
        VALUES (?,?,?,?,?,?,?)`, [documentId, branchId, line.productId, line.warehouseId, line.locationId, fromUnits(line.quantity), fromUnits(movementCost)]);
      await db.query(`INSERT INTO inv_movimiento(detalle_id,sucursal_id,producto_id,ubicacion_id,almacen_id,cantidad_delta,costo_unitario,saldo_posterior,costo_promedio_posterior,usuario_id)
        VALUES (?,?,?,?,?,?,?,?,?,?)`, [detail.insertId, branchId, line.productId, line.locationId, line.warehouseId,
        fromUnits(inbound ? line.quantity : -line.quantity), fromUnits(movementCost), fromUnits(newLocationQty), fromUnits(newAverage), userId]);
    }
    await syncInventoryAlerts(db, [branchId], now);
    if (ownConnection) await db.commit();
    return { id: Number(documentId), folio, duplicated: false };
  } catch (error) {
    if (ownConnection) await db.rollback();
    if (error.code === 'ER_DUP_ENTRY' && /idempotencia/.test(error.message)) throw inventoryError('La operación ya fue procesada.', 409);
    throw error;
  } finally { if (ownConnection) db.release(); }
}

module.exports = { applyDocument, toUnits, fromUnits, weightedAverage, INBOUND, OUTBOUND };
