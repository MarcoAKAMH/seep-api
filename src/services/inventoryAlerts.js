const { pool } = require('../config/db');

const MANAGED_TYPES = ['BAJO_MINIMO', 'PUNTO_REORDEN', 'AGOTADO', 'SOBRE_MAXIMO', 'SIN_MOVIMIENTO'];
const number = value => Number(value || 0);
const keyOf = row => `${row.producto_id}:${row.almacen_id}:${row.tipo}`;
const format = value => number(value).toLocaleString('es-MX', { maximumFractionDigits: 6 });

function branchFilter(branchIds, column = 'pa.sucursal_id') {
  if (branchIds === null || branchIds === undefined) return { sql: '1=1', params: [] };
  const ids = [...new Set(branchIds.map(Number))].filter(id => Number.isSafeInteger(id) && id > 0);
  if (!ids.length) return { sql: '1=0', params: [] };
  return { sql: `${column} IN (${ids.map(() => '?').join(',')})`, params: ids };
}

function desiredAlerts(rows, now = new Date()) {
  const cutoff = now.getTime() - 90 * 24 * 60 * 60 * 1000;
  const desired = [];
  for (const row of rows) {
    const stock = number(row.cantidad);
    const minimum = number(row.minimo);
    const reorder = number(row.punto_reorden);
    const maximum = number(row.maximo);
    let type = null;
    if (stock === 0 && (minimum > 0 || reorder > 0)) type = 'AGOTADO';
    else if (minimum > 0 && stock <= minimum) type = 'BAJO_MINIMO';
    else if (reorder > 0 && stock <= reorder) type = 'PUNTO_REORDEN';
    if (type) desired.push({ ...row, tipo: type, mensaje: `${row.sku} · ${row.nombre_comercial}: existencia ${format(stock)} en ${row.almacen_nombre}.` });
    if (maximum > 0 && stock > maximum) desired.push({ ...row, tipo: 'SOBRE_MAXIMO', mensaje: `${row.sku} · ${row.nombre_comercial}: ${format(stock)} supera el máximo ${format(maximum)} en ${row.almacen_nombre}.` });
    const last = row.ultimo_movimiento_at ? new Date(row.ultimo_movimiento_at).getTime() : null;
    if (stock > 0 && last !== null && last <= cutoff) desired.push({ ...row, tipo: 'SIN_MOVIMIENTO', mensaje: `${row.sku} · ${row.nombre_comercial}: sin movimiento durante 90 días, con ${format(stock)} en existencia.` });
  }
  return desired;
}

async function syncInventoryAlerts(connection = null, branchIds = null, now = new Date()) {
  const own = !connection;
  const db = connection || await pool.getConnection();
  try {
    if (own) await db.beginTransaction();
    const filter = branchFilter(branchIds);
    const [stockRows] = await db.query(`SELECT pa.producto_id,pa.almacen_id,pa.sucursal_id,pa.minimo,pa.maximo,pa.punto_reorden,
        p.sku,p.nombre_comercial,a.nombre almacen_nombre,COALESCE(SUM(e.cantidad),0) cantidad,MAX(e.ultimo_movimiento_at) ultimo_movimiento_at
      FROM inv_producto_almacen pa JOIN inv_producto p ON p.id=pa.producto_id AND p.activo=1
      JOIN inv_almacen a ON a.id=pa.almacen_id AND a.sucursal_id=pa.sucursal_id AND a.activo=1
      LEFT JOIN inv_existencia e ON e.producto_id=pa.producto_id AND e.almacen_id=pa.almacen_id AND e.sucursal_id=pa.sucursal_id
      WHERE ${filter.sql} GROUP BY pa.producto_id,pa.almacen_id,pa.sucursal_id,pa.minimo,pa.maximo,pa.punto_reorden,p.sku,p.nombre_comercial,a.nombre`, filter.params);
    const desired = desiredAlerts(stockRows, now);
    const notificationFilter = branchFilter(branchIds, 'sucursal_id');
    const [active] = await db.query(`SELECT id,producto_id,almacen_id,sucursal_id,tipo FROM inv_notificacion
      WHERE activa=1 AND tipo IN (${MANAGED_TYPES.map(() => '?').join(',')}) AND ${notificationFilter.sql} FOR UPDATE`, [...MANAGED_TYPES, ...notificationFilter.params]);
    const wanted = new Map(desired.map(row => [keyOf(row), row]));
    const existing = new Map(active.map(row => [keyOf(row), row]));
    let opened = 0;
    let resolved = 0;
    for (const [key, row] of wanted) {
      if (!existing.has(key)) {
        const [created] = await db.query('INSERT IGNORE INTO inv_notificacion(sucursal_id,producto_id,almacen_id,tipo,mensaje) VALUES (?,?,?,?,?)',
          [row.sucursal_id, row.producto_id, row.almacen_id, row.tipo, row.mensaje]);
        opened += Number(created.affectedRows);
      }
    }
    for (const [key, row] of existing) {
      if (!wanted.has(key)) {
        await db.query('UPDATE inv_notificacion SET activa=0,resuelta_at=? WHERE id=?', [now, row.id]);
        resolved += 1;
      }
    }
    if (own) await db.commit();
    return { evaluated: stockRows.length, active: desired.length, opened, resolved };
  } catch (error) { if (own) await db.rollback(); throw error; } finally { if (own) db.release(); }
}

module.exports = { syncInventoryAlerts, desiredAlerts, branchFilter, MANAGED_TYPES };
