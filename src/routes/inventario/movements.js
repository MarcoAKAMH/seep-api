const router = require('express').Router();
const Joi = require('joi');
const { pool } = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const { resolveInventoryScope, inventoryScopeSql } = require('../../utils/inventoryAccess');
const { applyDocument } = require('../../services/inventoryMovement');

const id = Joi.number().integer().min(1).max(Number.MAX_SAFE_INTEGER).required();
const decimal = Joi.string().pattern(/^(0|[1-9]\d{0,11})(\.\d{1,6})?$/).required();
const documentSchema = Joi.object({
  sucursal_id: id,
  tipo: Joi.string().valid('INICIAL', 'ENTRADA', 'SALIDA', 'DEVOLUCION').required(),
  motivo: Joi.string().trim().min(1).max(500).required(),
  referencia: Joi.string().trim().max(180).allow('', null).optional(),
  idempotencia: Joi.string().pattern(/^[A-Za-z0-9_.:-]{16,80}$/).required(),
  fecha_operacion: Joi.date().iso().max('now').optional(),
  detalles: Joi.array().min(1).max(200).items(Joi.object({
    producto_id: id, almacen_id: id, ubicacion_id: id, cantidad: decimal,
    costo_unitario: decimal.optional(),
  })).required(),
});
const listSchema = Joi.object({ sucursal_id: id.optional(), producto_id: id.optional(), q: Joi.string().trim().max(180).allow('').default(''),
  tipo: Joi.string().valid('INICIAL','ENTRADA','SALIDA','DEVOLUCION').optional(), limit: Joi.number().integer().min(1).max(100).default(30), offset: Joi.number().integer().min(0).max(1000000).default(0) });
function validate(schema, value) {
  const { error, value: clean } = schema.validate(value, { abortEarly: false, allowUnknown: false });
  if (error) throw Object.assign(new Error('Revisa los campos: ' + error.details.map(d => d.path.join('.')).join(', ')), { status: 400 });
  return clean;
}

router.get('/existencias', asyncHandler(async (req, res) => {
  const query = validate(listSchema, req.query);
  const scope = await resolveInventoryScope(req.user, query.sucursal_id, pool);
  const filter = inventoryScopeSql(scope.sucursalIds);
  const conditions = [filter.sql];
  const params = { ...filter.params, limit: query.limit, offset: query.offset };
  if (query.producto_id) { conditions.push('i.producto_id=:product'); params.product = query.producto_id; }
  if (query.q) { params.search = `%${query.q.replace(/[!%_]/g, c => `!${c}`)}%`; conditions.push("(p.sku LIKE :search ESCAPE '!' OR p.nombre_comercial LIKE :search ESCAPE '!' OR u.codigo LIKE :search ESCAPE '!')"); }
  const where = conditions.join(' AND ');
  const [[count]] = await pool.query(`SELECT COUNT(*) total FROM inv_existencia i JOIN inv_producto p ON p.id=i.producto_id JOIN inv_ubicacion u ON u.id=i.ubicacion_id WHERE ${where}`, params);
  const [items] = await pool.query(`SELECT i.*,p.sku,p.nombre_comercial,p.unidad_id,u.codigo ubicacion_codigo,a.nombre almacen_nombre,
      COALESCE(c.costo_promedio,0) costo_promedio,(i.cantidad*COALESCE(c.costo_promedio,0)) valor
    FROM inv_existencia i JOIN inv_producto p ON p.id=i.producto_id JOIN inv_ubicacion u ON u.id=i.ubicacion_id
    JOIN inv_almacen a ON a.id=i.almacen_id LEFT JOIN inv_costo_sucursal c ON c.producto_id=i.producto_id AND c.sucursal_id=i.sucursal_id
    WHERE ${where} ORDER BY p.nombre_comercial,u.codigo LIMIT :limit OFFSET :offset`, params);
  res.json({ items, total: Number(count.total), limit: query.limit, offset: query.offset });
}));

router.get('/kardex', asyncHandler(async (req, res) => {
  const query = validate(listSchema, req.query);
  const scope = await resolveInventoryScope(req.user, query.sucursal_id, pool);
  const filter = inventoryScopeSql(scope.sucursalIds);
  const conditions = [filter.sql];
  const params = { ...filter.params, limit: query.limit, offset: query.offset };
  if (query.producto_id) { conditions.push('i.producto_id=:product'); params.product = query.producto_id; }
  if (query.tipo) { conditions.push('d.tipo=:type'); params.type = query.tipo; }
  if (query.q) { params.search = `%${query.q.replace(/[!%_]/g, c => `!${c}`)}%`; conditions.push("(p.sku LIKE :search ESCAPE '!' OR p.nombre_comercial LIKE :search ESCAPE '!' OR d.folio LIKE :search ESCAPE '!' OR d.referencia LIKE :search ESCAPE '!')"); }
  const where = conditions.join(' AND ');
  const [[count]] = await pool.query(`SELECT COUNT(*) total FROM inv_movimiento i JOIN inv_documento_detalle dd ON dd.id=i.detalle_id JOIN inv_documento d ON d.id=dd.documento_id JOIN inv_producto p ON p.id=i.producto_id WHERE ${where}`, params);
  const [items] = await pool.query(`SELECT i.id,i.sucursal_id,i.producto_id,i.cantidad_delta,i.costo_unitario,i.saldo_posterior,i.costo_promedio_posterior,i.created_at,
      p.sku,p.nombre_comercial,d.folio,d.tipo,d.motivo,d.referencia,d.fecha_operacion,u.codigo ubicacion_codigo,a.nombre almacen_nombre,usr.nombre usuario_nombre
    FROM inv_movimiento i JOIN inv_documento_detalle dd ON dd.id=i.detalle_id JOIN inv_documento d ON d.id=dd.documento_id
    JOIN inv_producto p ON p.id=i.producto_id JOIN inv_ubicacion u ON u.id=i.ubicacion_id JOIN inv_almacen a ON a.id=i.almacen_id JOIN usuario usr ON usr.id=i.usuario_id
    WHERE ${where} ORDER BY d.fecha_operacion DESC,i.id DESC LIMIT :limit OFFSET :offset`, params);
  res.json({ items, total: Number(count.total), limit: query.limit, offset: query.offset });
}));

router.post('/movimientos', asyncHandler(async (req, res) => {
  const body = validate(documentSchema, req.body);
  await resolveInventoryScope(req.user, body.sucursal_id, pool);
  if (body.tipo === 'INICIAL' && !req.user.is_admin) throw Object.assign(new Error('Solo el administrador global puede registrar inventario inicial.'), { status: 403 });
  const result = await applyDocument(body, Number(req.user.sub));
  res.status(result.duplicated ? 200 : 201).json(result);
}));

module.exports = router;
