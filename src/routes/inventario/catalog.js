const router = require('express').Router();
const Joi = require('joi');
const { pool } = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const { resolveInventoryScope, inventoryScopeSql } = require('../../utils/inventoryAccess');
const { syncInventoryAlerts } = require('../../services/inventoryAlerts');

const id = Joi.number().integer().min(1).max(Number.MAX_SAFE_INTEGER).required();
const text = max => Joi.string().trim().max(max).required();
const decimal = Joi.string().pattern(/^(0|[1-9]\d{0,11})(\.\d{1,6})?$/).default('0');
const active = Joi.boolean().truthy(1).falsy(0).default(true);
const optionalText = max => Joi.string().trim().max(max).allow('', null).empty('').default(null);
const definitions = {
  productos: { table: 'inv_producto', global: true, search: ['sku', 'nombre_comercial', 'nombre_tecnico'], schema: Joi.object({
    sku: text(80), nombre_comercial: text(180), nombre_tecnico: text(255), categoria_id: id, unidad_id: id,
    tipo: Joi.string().valid('MATERIA_PRIMA', 'PRODUCTO_TERMINADO', 'CONSUMIBLE').required(),
    foto_url: Joi.alternatives().try(Joi.string().uri({ scheme: ['https'] }).max(1024), Joi.string().pattern(/^\/inventario\/fotos\/[0-9a-f-]{36}\.(jpg|png|webp)$/)).allow('', null).empty('').default(null),
    precio_publico: decimal, precio_mayoreo: decimal, activo: active,
  }) },
  categorias: { table: 'inv_categoria', global: true, search: ['nombre'], schema: Joi.object({ nombre: text(120), activo: active }) },
  unidades: { table: 'inv_unidad', global: true, search: ['nombre', 'clave'], schema: Joi.object({ nombre: text(80), clave: text(20), decimales: Joi.number().integer().min(0).max(6).required() }) },
  almacenes: { table: 'inv_almacen', search: ['nombre'], schema: Joi.object({ nombre: text(120), sucursal_id: id, activo: active }) },
  ubicaciones: { table: 'inv_ubicacion', search: ['codigo', 'descripcion'], schema: Joi.object({ codigo: text(60), descripcion: optionalText(180), almacen_id: id, sucursal_id: id, activo: active }) },
};

function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function validate(schema, value) {
  const result = schema.validate(value, { abortEarly: false, allowUnknown: false });
  if (result.error) fail('Revisa los campos enviados: ' + result.error.details.map(d => d.path.join('.')).join(', '));
  return result.value;
}
function units(value) { const [whole, fraction = ''] = value.split('.'); return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0')); }
const querySchema = Joi.object({ q: Joi.string().trim().max(180).allow('').default(''), sucursal_id: id.optional(),
  limit: Joi.number().integer().min(1).max(100).default(20), offset: Joi.number().integer().min(0).max(1000000).default(0),
  activo: Joi.number().valid(0, 1).optional(), categoria_id: id.optional(),
  tipo: Joi.string().valid('MATERIA_PRIMA','PRODUCTO_TERMINADO','CONSUMIBLE').optional(),
});

async function audit(db, req, table, entityId, before, after, branch) {
  await db.query(`INSERT INTO inv_auditoria (sucursal_id,usuario_id,accion,entidad,entidad_id,antes,despues)
    VALUES (?,?,?,?,?,?,?)`, [branch ?? null, Number(req.user.sub), before ? 'ACTUALIZAR' : 'CREAR', table, entityId,
    before ? JSON.stringify(before) : null, JSON.stringify(after)]);
}
async function transaction(fn) {
  const db = await pool.getConnection();
  try { await db.beginTransaction(); const result = await fn(db); await db.commit(); return result; }
  catch (error) {
    await db.rollback();
    if (error.code === 'ER_DUP_ENTRY') fail('El código o nombre ya existe. Revisa el registro antes de guardar.', 409);
    if (error.code === 'ER_NO_REFERENCED_ROW_2') fail('Una de las referencias seleccionadas no existe.');
    throw error;
  } finally { db.release(); }
}
async function requireActive(db, table, key, activeColumn = true) {
  const [rows] = await db.query(`SELECT * FROM ${table} WHERE id=? FOR UPDATE`, [key]);
  if (!rows.length || (activeColumn && !rows[0].activo)) fail('Selecciona un registro existente y activo.');
  return rows[0];
}

router.get('/catalogos', asyncHandler(async (req, res) => {
  const q = validate(Joi.object({ sucursal_id: id.optional() }), req.query);
  const scope = await resolveInventoryScope(req.user, q.sucursal_id, pool);
  const filter = inventoryScopeSql(scope.sucursalIds);
  const [categorias] = await pool.query('SELECT * FROM inv_categoria ORDER BY nombre');
  const [unidades] = await pool.query('SELECT * FROM inv_unidad ORDER BY nombre');
  const [sucursales] = await pool.query(`SELECT i.id, i.nombre FROM (SELECT id, nombre, id AS sucursal_id FROM cat_sucursal) i WHERE ${filter.sql} ORDER BY nombre`, filter.params);
  const [almacenes] = await pool.query(`SELECT i.* FROM inv_almacen i WHERE ${filter.sql} ORDER BY nombre`, filter.params);
  const [ubicaciones] = await pool.query(`SELECT i.* FROM inv_ubicacion i WHERE ${filter.sql} ORDER BY codigo`, filter.params);
  res.json({ categorias, unidades, sucursales, almacenes, ubicaciones });
}));

for (const [route, def] of Object.entries(definitions)) {
  router.get(`/${route}`, asyncHandler(async (req, res) => {
    const q = validate(querySchema, req.query);
    const scope = await resolveInventoryScope(req.user, q.sucursal_id, pool);
    const filter = def.global ? { sql: '1=1', params: {} } : inventoryScopeSql(scope.sucursalIds);
    const conditions = [filter.sql];
    const params = { ...filter.params, limit: q.limit, offset: q.offset };
    if (q.q) {
      // Escape LIKE wildcards; ! is the explicit escape character.
      params.search = `%${q.q.replace(/[!%_]/g, c => '!' + c)}%`;
      conditions.push(`(${def.search.map(c => `i.${c} LIKE :search ESCAPE '!'`).join(' OR ')})`);
    }
    if (q.activo !== undefined && route !== 'unidades') { conditions.push('i.activo=:active'); params.active = q.activo; }
    if (route === 'productos') {
      if (q.categoria_id) { conditions.push('i.categoria_id=:category'); params.category = q.categoria_id; }
      if (q.tipo) { conditions.push('i.tipo=:type'); params.type = q.tipo; }
    }
    const where = conditions.join(' AND ');
    const [[count]] = await pool.query(`SELECT COUNT(*) total FROM ${def.table} i WHERE ${where}`, params);
    const [items] = await pool.query(`SELECT i.* FROM ${def.table} i WHERE ${where} ORDER BY i.id DESC LIMIT :limit OFFSET :offset`, params);
    res.json({ items, total: Number(count.total), limit: q.limit, offset: q.offset });
  }));

  async function save(req, res) {
    if (def.global && !req.user.can_manage_inventory_catalog) fail('Solo el administrador global puede modificar el catálogo compartido.', 403);
    const body = validate(def.schema, req.body);
    const recordId = req.params.id === undefined ? null : validate(id, req.params.id);
    const result = await transaction(async db => {
      let before = null;
      if (recordId) {
        const [rows] = await db.query(`SELECT * FROM ${def.table} WHERE id=? FOR UPDATE`, [recordId]);
        if (!rows.length) fail('El registro no existe.', 404);
        before = rows[0];
        if (!def.global) await resolveInventoryScope(req.user, before.sucursal_id, db);
      }
      if (!def.global) {
        await resolveInventoryScope(req.user, body.sucursal_id, db);
        if (before && Number(before.sucursal_id) !== body.sucursal_id) fail('No se puede cambiar la sucursal de un registro existente.');
      }
      if (route === 'productos') {
        const [categories] = await db.query('SELECT * FROM inv_categoria WHERE id=? FOR UPDATE', [body.categoria_id]);
        if (!categories.length || (!categories[0].activo && Number(before?.categoria_id) !== body.categoria_id)) fail('Selecciona una categoría activa.');
        await requireActive(db, 'inv_unidad', body.unidad_id, false);
        if (before && Number(before.unidad_id) !== body.unidad_id) {
          const [used] = await db.query('SELECT producto_id FROM inv_producto_almacen WHERE producto_id=? LIMIT 1', [recordId]);
          if (used.length) fail('No se puede cambiar la unidad de un artículo configurado en un almacén.', 409);
        }
      }
      if (route === 'unidades' && before && (before.clave !== body.clave || Number(before.decimales) !== body.decimales)) {
        const [used] = await db.query('SELECT id FROM inv_producto WHERE unidad_id=? LIMIT 1', [recordId]);
        if (used.length) fail('La clave y precisión de una unidad utilizada no se pueden modificar.', 409);
      }
      if (route === 'ubicaciones') {
        if (before && Number(before.almacen_id) !== body.almacen_id) fail('No se puede mover una ubicación a otro almacén.');
        const warehouse = await requireActive(db, 'inv_almacen', body.almacen_id);
        if (Number(warehouse.sucursal_id) !== body.sucursal_id) fail('El almacén no pertenece a la sucursal seleccionada.');
      }
      if (before && body.activo === false && before.activo && ['productos','almacenes','ubicaciones'].includes(route)) {
        const key = { productos: 'producto_id', almacenes: 'almacen_id', ubicaciones: 'ubicacion_id' }[route];
        const [stock] = await db.query(`SELECT producto_id FROM inv_existencia WHERE ${key}=? AND cantidad>0 LIMIT 1 FOR UPDATE`, [recordId]);
        if (stock.length) fail('No se puede desactivar un registro con existencias. Primero registra su salida o transferencia.', 409);
      }
      const data = { ...body };
      if (!recordId && route === 'productos') data.creado_por = Number(req.user.sub);
      const fields = Object.keys(data); // Only schema-validated fields, never client identifiers.
      let savedId = recordId;
      if (recordId) await db.query(`UPDATE ${def.table} SET ${fields.map(c => `${c}=?`).join(',')} WHERE id=?`, [...Object.values(data), recordId]);
      else {
        const [insert] = await db.query(`INSERT INTO ${def.table} (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`, Object.values(data));
        savedId = insert.insertId;
      }
      await audit(db, req, def.table, savedId, before, data, body.sucursal_id);
      return { id: savedId, ...body };
    });
    res.status(recordId ? 200 : 201).json(result);
  }
  router.post(`/${route}`, asyncHandler(save));
  router.put(`/${route}/:id`, asyncHandler(save));
}

router.get('/productos/:id/limites', asyncHandler(async (req, res) => {
  const productId = validate(id, req.params.id);
  const q = validate(Joi.object({ sucursal_id: id.optional() }), req.query);
  const scope = await resolveInventoryScope(req.user, q.sucursal_id, pool);
  const filter = inventoryScopeSql(scope.sucursalIds);
  const [items] = await pool.query(`SELECT i.*, a.nombre AS almacen_nombre FROM inv_producto_almacen i JOIN inv_almacen a ON a.id=i.almacen_id
    WHERE i.producto_id=:product AND ${filter.sql} ORDER BY i.almacen_id`, { ...filter.params, product: productId });
  res.json(items);
}));
router.put('/productos/:id/limites', asyncHandler(async (req, res) => {
  const productId = validate(id, req.params.id);
  const body = validate(Joi.object({ almacen_id: id, sucursal_id: id, minimo: decimal, maximo: decimal, punto_reorden: decimal }), req.body);
  if (units(body.minimo) > units(body.punto_reorden) || units(body.punto_reorden) > units(body.maximo)) fail('Los límites deben cumplir: mínimo ≤ punto de reorden ≤ máximo.');
  await transaction(async db => {
    await resolveInventoryScope(req.user, body.sucursal_id, db);
    await requireActive(db, 'inv_producto', productId);
    const warehouse = await requireActive(db, 'inv_almacen', body.almacen_id);
    if (Number(warehouse.sucursal_id) !== body.sucursal_id) fail('El almacén no pertenece a la sucursal seleccionada.');
    const [rows] = await db.query('SELECT * FROM inv_producto_almacen WHERE producto_id=? AND almacen_id=? FOR UPDATE', [productId, body.almacen_id]);
    await db.query(`INSERT INTO inv_producto_almacen (producto_id,almacen_id,sucursal_id,minimo,maximo,punto_reorden) VALUES (?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE minimo=?,maximo=?,punto_reorden=?`, [productId, body.almacen_id, body.sucursal_id, body.minimo, body.maximo, body.punto_reorden, body.minimo, body.maximo, body.punto_reorden]);
    await audit(db, req, 'inv_producto_almacen', productId, rows[0], { producto_id: productId, ...body }, body.sucursal_id);
    await syncInventoryAlerts(db, [body.sucursal_id]);
  });
  res.json({ producto_id: productId, ...body });
}));

module.exports = router;
