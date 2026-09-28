const router = require('express').Router();
const Joi = require('joi');
const { pool } = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const { resolveInventoryScope } = require('../../utils/inventoryAccess');
const { syncInventoryAlerts, branchFilter, MANAGED_TYPES } = require('../../services/inventoryAlerts');

const id = Joi.number().integer().min(1).max(Number.MAX_SAFE_INTEGER).required();
const listSchema = Joi.object({ sucursal_id: id.optional(), q: Joi.string().trim().max(180).allow('').default(''),
  tipo: Joi.string().valid(...MANAGED_TYPES).optional(), activa: Joi.number().valid(0, 1).default(1),
  estado: Joi.string().valid('NORMAL', ...MANAGED_TYPES).optional(), dias: Joi.number().integer().min(1).max(3650).default(90),
  orden: Joi.string().valid('mas','menos').default('mas'), limit: Joi.number().integer().min(1).max(100).default(50), offset: Joi.number().integer().min(0).max(1000000).default(0) });

function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function validate(schema, value) {
  const result = schema.validate(value, { abortEarly: false, allowUnknown: false });
  if (result.error) fail('Revisa los filtros: ' + result.error.details.map(item => item.path.join('.')).join(', '));
  return result.value;
}
async function scopeFor(req, requestedId) { return resolveInventoryScope(req.user, requestedId, pool); }
const stockBase = `SELECT pa.producto_id,pa.almacen_id,pa.sucursal_id,pa.minimo,pa.maximo,pa.punto_reorden,
    p.sku,p.nombre_comercial,a.nombre almacen_nombre,s.nombre sucursal_nombre,COALESCE(SUM(e.cantidad),0) cantidad,
    MAX(e.ultimo_movimiento_at) ultimo_movimiento_at,COALESCE(c.costo_promedio,0) costo_promedio
  FROM inv_producto_almacen pa JOIN inv_producto p ON p.id=pa.producto_id AND p.activo=1
  JOIN inv_almacen a ON a.id=pa.almacen_id AND a.sucursal_id=pa.sucursal_id AND a.activo=1
  JOIN cat_sucursal s ON s.id=pa.sucursal_id LEFT JOIN inv_existencia e ON e.producto_id=pa.producto_id AND e.almacen_id=pa.almacen_id AND e.sucursal_id=pa.sucursal_id
  LEFT JOIN inv_costo_sucursal c ON c.producto_id=pa.producto_id AND c.sucursal_id=pa.sucursal_id`;
const stockGroup = `GROUP BY pa.producto_id,pa.almacen_id,pa.sucursal_id,pa.minimo,pa.maximo,pa.punto_reorden,
  p.sku,p.nombre_comercial,a.nombre,s.nombre,c.costo_promedio`;
const statusSql = `CASE WHEN cantidad=0 AND (minimo>0 OR punto_reorden>0) THEN 'AGOTADO'
  WHEN minimo>0 AND cantidad<=minimo THEN 'BAJO_MINIMO' WHEN punto_reorden>0 AND cantidad<=punto_reorden THEN 'PUNTO_REORDEN'
  WHEN maximo>0 AND cantidad>maximo THEN 'SOBRE_MAXIMO' ELSE 'NORMAL' END`;

router.get('/tablero', asyncHandler(async (req, res) => {
  const q = validate(listSchema, req.query);
  const scope = await scopeFor(req, q.sucursal_id);
  await syncInventoryAlerts(null, scope.sucursalIds);
  const existenceFilter = branchFilter(scope.sucursalIds, 'e.sucursal_id');
  const stockFilter = branchFilter(scope.sucursalIds);
  const alertFilter = branchFilter(scope.sucursalIds, 'n.sucursal_id');
  const [[[valuation]], [stockRows], [[notifications]]] = await Promise.all([
    pool.query(`SELECT COALESCE(SUM(e.cantidad*COALESCE(c.costo_promedio,0)),0) valor FROM inv_existencia e
      LEFT JOIN inv_costo_sucursal c ON c.producto_id=e.producto_id AND c.sucursal_id=e.sucursal_id WHERE ${existenceFilter.sql}`, existenceFilter.params),
    pool.query(`${stockBase} WHERE ${stockFilter.sql} ${stockGroup}`, stockFilter.params),
    pool.query(`SELECT COUNT(*) alertas_activas,COALESCE(SUM(l.notificacion_id IS NULL),0) alertas_no_leidas FROM inv_notificacion n
      LEFT JOIN inv_notificacion_lectura l ON l.notificacion_id=n.id AND l.usuario_id=? WHERE n.activa=1 AND ${alertFilter.sql}`,
      [Number(req.user.sub), ...alertFilter.params]),
  ]);
  const cutoff = Date.now() - q.dias * 86400000;
  let below = 0, out = 0, stagnant = 0, stagnantValue = 0;
  for (const row of stockRows) {
    const amount = Number(row.cantidad), minimum = Number(row.minimo), reorder = Number(row.punto_reorden);
    if (minimum > 0 && amount <= minimum) below += 1;
    if (amount === 0 && (minimum > 0 || reorder > 0)) out += 1;
    if (amount > 0 && row.ultimo_movimiento_at && new Date(row.ultimo_movimiento_at).getTime() <= cutoff) {
      stagnant += 1; stagnantValue += amount * Number(row.costo_promedio);
    }
  }
  res.json({ valor_inventario: valuation.valor, productos_bajo_minimo: below, productos_agotados: out,
    alertas_activas: Number(notifications.alertas_activas), alertas_no_leidas: Number(notifications.alertas_no_leidas),
    productos_sin_movimiento: stagnant, valor_sin_movimiento: stagnantValue.toFixed(6), dias_sin_movimiento: q.dias });
}));

router.get('/alertas', asyncHandler(async (req, res) => {
  const q = validate(listSchema, req.query);
  const scope = await scopeFor(req, q.sucursal_id);
  await syncInventoryAlerts(null, scope.sucursalIds);
  const filter = branchFilter(scope.sucursalIds, 'n.sucursal_id');
  const conditions = [filter.sql, 'n.activa=?'];
  const params = [...filter.params, q.activa];
  if (q.tipo) { conditions.push('n.tipo=?'); params.push(q.tipo); }
  if (q.q) { conditions.push("(p.sku LIKE ? ESCAPE '!' OR p.nombre_comercial LIKE ? ESCAPE '!' OR n.mensaje LIKE ? ESCAPE '!')"); const search = `%${q.q.replace(/[!%_]/g, value => `!${value}`)}%`; params.push(search,search,search); }
  const where = conditions.join(' AND ');
  const [[count]] = await pool.query(`SELECT COUNT(*) total FROM inv_notificacion n JOIN inv_producto p ON p.id=n.producto_id WHERE ${where}`, params);
  const [items] = await pool.query(`SELECT n.*,p.sku,p.nombre_comercial,a.nombre almacen_nombre,s.nombre sucursal_nombre,
      (l.notificacion_id IS NOT NULL) leida,l.leida_at FROM inv_notificacion n JOIN inv_producto p ON p.id=n.producto_id
    JOIN inv_almacen a ON a.id=n.almacen_id JOIN cat_sucursal s ON s.id=n.sucursal_id
    LEFT JOIN inv_notificacion_lectura l ON l.notificacion_id=n.id AND l.usuario_id=? WHERE ${where}
    ORDER BY n.activa DESC,n.created_at DESC,n.id DESC LIMIT ? OFFSET ?`, [Number(req.user.sub), ...params, q.limit, q.offset]);
  res.json({ items, total: Number(count.total), limit: q.limit, offset: q.offset });
}));

router.post('/alertas/:id/leer', asyncHandler(async (req, res) => {
  const notificationId = validate(id, req.params.id);
  const [rows] = await pool.query('SELECT sucursal_id FROM inv_notificacion WHERE id=?', [notificationId]);
  if (!rows.length) fail('La alerta no existe.', 404);
  await scopeFor(req, rows[0].sucursal_id);
  await pool.query(`INSERT INTO inv_notificacion_lectura(notificacion_id,usuario_id,leida_at) VALUES (?,?,UTC_TIMESTAMP(6))
    ON DUPLICATE KEY UPDATE leida_at=VALUES(leida_at)`, [notificationId, Number(req.user.sub)]);
  res.json({ id: notificationId, leida: true });
}));

router.post('/alertas/leer-todas', asyncHandler(async (req, res) => {
  const q = validate(Joi.object({ sucursal_id: id.optional() }), req.body || {});
  const scope = await scopeFor(req, q.sucursal_id);
  const filter = branchFilter(scope.sucursalIds, 'n.sucursal_id');
  const [result] = await pool.query(`INSERT INTO inv_notificacion_lectura(notificacion_id,usuario_id,leida_at)
    SELECT n.id,?,UTC_TIMESTAMP(6) FROM inv_notificacion n WHERE n.activa=1 AND ${filter.sql}
    ON DUPLICATE KEY UPDATE leida_at=VALUES(leida_at)`, [Number(req.user.sub), ...filter.params]);
  res.json({ actualizadas: Number(result.affectedRows) });
}));

router.get('/reportes/limites', asyncHandler(async (req, res) => {
  const q = validate(listSchema, req.query);
  const scope = await scopeFor(req, q.sucursal_id);
  const filter = branchFilter(scope.sucursalIds);
  const conditions = [filter.sql];
  const params = [...filter.params];
  if (q.q) { const search = `%${q.q.replace(/[!%_]/g, value => `!${value}`)}%`; conditions.push("(p.sku LIKE ? ESCAPE '!' OR p.nombre_comercial LIKE ? ESCAPE '!' OR a.nombre LIKE ? ESCAPE '!')"); params.push(search,search,search); }
  const base = `${stockBase} WHERE ${conditions.join(' AND ')} ${stockGroup}`;
  const statusCondition = q.estado ? `WHERE estado='${q.estado}'` : '';
  const [[count]] = await pool.query(`SELECT COUNT(*) total FROM (SELECT grouped.*,${statusSql} estado FROM (${base}) grouped) report ${statusCondition}`, params);
  const [items] = await pool.query(`SELECT report.*,cantidad*costo_promedio valor FROM (SELECT grouped.*,${statusSql} estado FROM (${base}) grouped) report ${statusCondition}
    ORDER BY FIELD(estado,'AGOTADO','BAJO_MINIMO','PUNTO_REORDEN','SOBRE_MAXIMO','NORMAL'),nombre_comercial LIMIT ? OFFSET ?`, [...params,q.limit,q.offset]);
  res.json({ items, total: Number(count.total), limit: q.limit, offset: q.offset });
}));

router.get('/reportes/rotacion', asyncHandler(async (req, res) => {
  const q = validate(listSchema, req.query);
  const scope = await scopeFor(req, q.sucursal_id);
  const filter = branchFilter(scope.sucursalIds, 'pb.sucursal_id');
  const conditions = [filter.sql];
  const params = [q.dias, ...filter.params];
  if (q.q) { const search = `%${q.q.replace(/[!%_]/g, value => `!${value}`)}%`; conditions.push("(p.sku LIKE ? ESCAPE '!' OR p.nombre_comercial LIKE ? ESCAPE '!')"); params.push(search,search); }
  const from = `FROM (SELECT DISTINCT producto_id,sucursal_id FROM inv_producto_almacen) pb JOIN inv_producto p ON p.id=pb.producto_id
    JOIN cat_sucursal s ON s.id=pb.sucursal_id LEFT JOIN inv_movimiento m ON m.producto_id=pb.producto_id AND m.sucursal_id=pb.sucursal_id
      AND m.cantidad_delta<0 AND m.created_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL ? DAY)
    WHERE ${conditions.join(' AND ')}`;
  const [[count]] = await pool.query(`SELECT COUNT(*) total FROM (SELECT pb.producto_id,pb.sucursal_id ${from} GROUP BY pb.producto_id,pb.sucursal_id) totals`, params);
  const direction = q.orden === 'menos' ? 'ASC' : 'DESC';
  const [items] = await pool.query(`SELECT pb.producto_id,pb.sucursal_id,p.sku,p.nombre_comercial,s.nombre sucursal_nombre,
      COALESCE(SUM(-m.cantidad_delta),0) cantidad_salida,COALESCE(SUM(-m.cantidad_delta*m.costo_unitario),0) costo_salida,
      COUNT(m.id) movimientos_salida,MAX(m.created_at) ultima_salida ${from}
    GROUP BY pb.producto_id,pb.sucursal_id,p.sku,p.nombre_comercial,s.nombre ORDER BY cantidad_salida ${direction},p.nombre_comercial LIMIT ? OFFSET ?`, [...params,q.limit,q.offset]);
  res.json({ items, total: Number(count.total), dias: q.dias, orden: q.orden, limit: q.limit, offset: q.offset });
}));

module.exports = router;
