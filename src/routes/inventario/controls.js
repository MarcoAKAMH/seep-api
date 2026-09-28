const router = require('express').Router();
const Joi = require('joi');
const bcrypt = require('bcryptjs');
const { pool } = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const { resolveInventoryScope, inventoryScope } = require('../../utils/inventoryAccess');
const { dispatchTransfer, receiveTransfer, requestAdjustment, decideAdjustment, reverseDocument } = require('../../services/inventoryControls');

const id = Joi.number().integer().min(1).max(Number.MAX_SAFE_INTEGER).required();
const decimal = Joi.string().pattern(/^(0|[1-9]\d{0,11})(\.\d{1,6})?$/).required();
const positiveDecimal = Joi.string().pattern(/^(?!0(?:\.0{1,6})?$)(0|[1-9]\d{0,11})(\.\d{1,6})?$/).required();
const optionalText = max => Joi.string().trim().max(max).allow('', null).empty('').default(null);
const list = Joi.object({ sucursal_id: id.optional(), estado: Joi.string().valid('DESPACHADA','RECIBIDA','PENDIENTE','APROBADO','RECHAZADO').optional(),
  limit: Joi.number().integer().min(1).max(100).default(50), offset: Joi.number().integer().min(0).max(1000000).default(0) });
const transfer = Joi.object({ sucursal_origen_id: id, almacen_origen_id: id, ubicacion_origen_id: id, sucursal_destino_id: id,
  almacen_destino_id: id, ubicacion_destino_id: id, motivo: Joi.string().trim().min(1).max(500).required(), referencia: optionalText(180),
  idempotencia: Joi.string().pattern(/^[A-Za-z0-9_.:-]{16,80}$/).required(),
  detalles: Joi.array().min(1).max(200).items(Joi.object({ producto_id: id, cantidad: positiveDecimal })).required() });
const adjustment = Joi.object({ sucursal_id: id, producto_id: id, almacen_id: id, ubicacion_id: id, cantidad_contada: decimal,
  costo_unitario: decimal.optional(), motivo: Joi.string().trim().min(1).max(500).required() });
const decision = Joi.object({ aprobar: Joi.boolean().required(), motivo: Joi.string().trim().min(1).max(500).required(), password: Joi.string().min(1).max(200).required() });
const reversal = Joi.object({ motivo: Joi.string().trim().min(1).max(500).required(), password: Joi.string().min(1).max(200).required() });

function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function validate(schema, value) {
  const result = schema.validate(value, { abortEarly: false, allowUnknown: false });
  if (result.error) fail('Revisa los campos: ' + result.error.details.map(item => item.path.join('.')).join(', '));
  return result.value;
}
async function verifyPassword(userId, password) {
  const [rows] = await pool.query('SELECT password_hash FROM usuario WHERE id=? AND activo=1', [userId]);
  if (!rows.length || !await bcrypt.compare(password, rows[0].password_hash)) fail('La contraseña es incorrecta.', 403);
}
function branchPredicate(user, origin = 'i.sucursal_origen_id', destination = 'i.sucursal_destino_id') {
  const allowed = inventoryScope(user);
  if (allowed === null) return { sql: '1=1', params: {} };
  return { sql: `(${origin}=:scope_branch OR ${destination}=:scope_branch)`, params: { scope_branch: allowed[0] } };
}

router.get('/destinos-transferencia', asyncHandler(async (req, res) => {
  const [sucursales] = await pool.query('SELECT id,nombre FROM cat_sucursal ORDER BY nombre');
  const [almacenes] = await pool.query('SELECT id,sucursal_id,nombre FROM inv_almacen WHERE activo=1 ORDER BY nombre');
  const [ubicaciones] = await pool.query('SELECT id,almacen_id,sucursal_id,codigo,descripcion FROM inv_ubicacion WHERE activo=1 ORDER BY codigo');
  res.json({ sucursales, almacenes, ubicaciones });
}));

router.get('/transferencias', asyncHandler(async (req, res) => {
  const q = validate(list, req.query);
  if (q.sucursal_id) await resolveInventoryScope(req.user, q.sucursal_id, pool);
  const scope = branchPredicate(req.user);
  const conditions = [scope.sql];
  const params = { ...scope.params, limit: q.limit, offset: q.offset };
  if (q.sucursal_id) { conditions.push('(i.sucursal_origen_id=:branch OR i.sucursal_destino_id=:branch)'); params.branch = q.sucursal_id; }
  if (q.estado) { conditions.push('i.estado=:state'); params.state = q.estado; }
  const where = conditions.join(' AND ');
  const [[count]] = await pool.query(`SELECT COUNT(*) total FROM inv_transferencia i WHERE ${where}`, params);
  const [items] = await pool.query(`SELECT i.*,so.nombre sucursal_origen_nombre,sd.nombre sucursal_destino_nombre,
      uo.codigo ubicacion_origen_codigo,ud.codigo ubicacion_destino_codigo,usr.nombre creado_por_nombre,rec.nombre recibido_por_nombre,
      (SELECT COUNT(*) FROM inv_transferencia_detalle d WHERE d.transferencia_id=i.id) partidas
    FROM inv_transferencia i JOIN cat_sucursal so ON so.id=i.sucursal_origen_id JOIN cat_sucursal sd ON sd.id=i.sucursal_destino_id
    JOIN inv_ubicacion uo ON uo.id=i.ubicacion_origen_id JOIN inv_ubicacion ud ON ud.id=i.ubicacion_destino_id
    JOIN usuario usr ON usr.id=i.creado_por LEFT JOIN usuario rec ON rec.id=i.recibido_por
    WHERE ${where} ORDER BY i.created_at DESC LIMIT :limit OFFSET :offset`, params);
  res.json({ items, total: Number(count.total), limit: q.limit, offset: q.offset });
}));

router.post('/transferencias', asyncHandler(async (req, res) => {
  const body = validate(transfer, req.body);
  await resolveInventoryScope(req.user, body.sucursal_origen_id, pool);
  const [destinations] = await pool.query('SELECT id FROM cat_sucursal WHERE id=?', [body.sucursal_destino_id]);
  if (!destinations.length) fail('La sucursal de destino no existe.');
  const result = await dispatchTransfer(body, Number(req.user.sub));
  res.status(201).json(result);
}));

router.post('/transferencias/:id/recibir', asyncHandler(async (req, res) => {
  const transferId = validate(id, req.params.id);
  const [rows] = await pool.query('SELECT sucursal_destino_id FROM inv_transferencia WHERE id=?', [transferId]);
  if (!rows.length) fail('La transferencia no existe.', 404);
  await resolveInventoryScope(req.user, rows[0].sucursal_destino_id, pool);
  res.json(await receiveTransfer(transferId, Number(req.user.sub)));
}));

router.get('/ajustes', asyncHandler(async (req, res) => {
  const q = validate(list, req.query);
  const scope = await resolveInventoryScope(req.user, q.sucursal_id, pool);
  const conditions = [];
  const params = { limit: q.limit, offset: q.offset };
  if (scope.sucursalIds !== null) { conditions.push('i.sucursal_id=:scope_branch'); params.scope_branch = scope.sucursalIds[0]; }
  if (q.sucursal_id) { conditions.push('i.sucursal_id=:branch'); params.branch = q.sucursal_id; }
  if (q.estado) { conditions.push('i.estado=:state'); params.state = q.estado; }
  const where = conditions.length ? conditions.join(' AND ') : '1=1';
  const [[count]] = await pool.query(`SELECT COUNT(*) total FROM inv_ajuste_solicitud i WHERE ${where}`, params);
  const [items] = await pool.query(`SELECT i.*,p.sku,p.nombre_comercial,u.codigo ubicacion_codigo,s.nombre sucursal_nombre,
      sol.nombre solicitado_por_nombre,decisor.nombre decidido_por_nombre
    FROM inv_ajuste_solicitud i JOIN inv_producto p ON p.id=i.producto_id JOIN inv_ubicacion u ON u.id=i.ubicacion_id
    JOIN cat_sucursal s ON s.id=i.sucursal_id JOIN usuario sol ON sol.id=i.solicitado_por LEFT JOIN usuario decisor ON decisor.id=i.decidido_por
    WHERE ${where} ORDER BY i.created_at DESC LIMIT :limit OFFSET :offset`, params);
  res.json({ items, total: Number(count.total), limit: q.limit, offset: q.offset });
}));

router.post('/ajustes', asyncHandler(async (req, res) => {
  const body = validate(adjustment, req.body);
  await resolveInventoryScope(req.user, body.sucursal_id, pool);
  res.status(201).json(await requestAdjustment(body, Number(req.user.sub)));
}));

router.put('/ajustes/:id/decision', asyncHandler(async (req, res) => {
  if (!req.user.can_authorize_inventory_adjustments) fail('Solo el administrador global puede autorizar ajustes.', 403);
  const adjustmentId = validate(id, req.params.id);
  const body = validate(decision, req.body);
  await verifyPassword(Number(req.user.sub), body.password);
  res.json(await decideAdjustment(adjustmentId, body.aprobar, Number(req.user.sub), body.motivo));
}));

router.get('/documentos', asyncHandler(async (req, res) => {
  const q = validate(list, req.query);
  const scope = await resolveInventoryScope(req.user, q.sucursal_id, pool);
  const conditions = ["i.tipo IN ('INICIAL','ENTRADA','SALIDA','DEVOLUCION')", "i.estado='APLICADO'"];
  const params = { limit: q.limit, offset: q.offset };
  if (scope.sucursalIds !== null) { conditions.push('i.sucursal_id=:scope_branch'); params.scope_branch = scope.sucursalIds[0]; }
  if (q.sucursal_id) { conditions.push('i.sucursal_id=:branch'); params.branch = q.sucursal_id; }
  const where = conditions.join(' AND ');
  const [[count]] = await pool.query(`SELECT COUNT(*) total FROM inv_documento i WHERE ${where}`, params);
  const [items] = await pool.query(`SELECT i.id,i.sucursal_id,i.folio,i.tipo,i.motivo,i.referencia,i.fecha_operacion,u.nombre usuario_nombre,
      EXISTS(SELECT 1 FROM inv_documento r WHERE r.documento_origen_id=i.id AND r.tipo='REVERSA') reversado
    FROM inv_documento i JOIN usuario u ON u.id=i.creado_por WHERE ${where} ORDER BY i.fecha_operacion DESC,i.id DESC LIMIT :limit OFFSET :offset`, params);
  res.json({ items, total: Number(count.total), limit: q.limit, offset: q.offset });
}));

router.post('/documentos/:id/reversa', asyncHandler(async (req, res) => {
  if (!req.user.can_authorize_inventory_adjustments) fail('Solo el administrador global puede autorizar reversas.', 403);
  const documentId = validate(id, req.params.id);
  const body = validate(reversal, req.body);
  const [rows] = await pool.query('SELECT sucursal_id FROM inv_documento WHERE id=?', [documentId]);
  if (!rows.length) fail('El documento no existe.', 404);
  await resolveInventoryScope(req.user, rows[0].sucursal_id, pool);
  await verifyPassword(Number(req.user.sub), body.password);
  res.status(201).json(await reverseDocument(documentId, Number(req.user.sub), body.motivo));
}));

module.exports = router;
