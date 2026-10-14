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
    proveedor_id: id.optional(),
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
  orden: Joi.string().valid('nombre').optional(),
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
  if (req.user.is_inventory_only && !req.user.is_inventory_admin) return res.json({ categorias, unidades, sucursales, almacenes: [], ubicaciones: [] });
  const [almacenes] = await pool.query(`SELECT i.* FROM inv_almacen i WHERE ${filter.sql} ORDER BY nombre`, filter.params);
  const [ubicaciones] = await pool.query(`SELECT i.* FROM inv_ubicacion i WHERE ${filter.sql} ORDER BY codigo`, filter.params);
  res.json({ categorias, unidades, sucursales, almacenes, ubicaciones });
}));

// Lean lookup for purchase selectors: one query, no catalog count or supplier enrichment.
router.get('/productos/buscar', asyncHandler(async (req, res) => {
  const q = validate(Joi.object({ q: Joi.string().trim().max(180).allow('').default(''),
    limit: Joi.number().integer().min(1).max(100).default(50),
    offset: Joi.number().integer().min(0).max(1000000).default(0) }), req.query);
  const escaped = `%${q.q.replace(/[!%_]/g, c => '!' + c)}%`;
  const [rows] = await pool.query(`SELECT id,sku,nombre_comercial FROM inv_producto
    WHERE activo=1 AND (sku LIKE ? ESCAPE '!' OR nombre_comercial LIKE ? ESCAPE '!' OR nombre_tecnico LIKE ? ESCAPE '!')
    ORDER BY nombre_comercial,sku,id LIMIT ? OFFSET ?`, [escaped,escaped,escaped,q.limit+1,q.offset]);
  res.json({ items: rows.slice(0,q.limit), has_more: rows.length>q.limit });
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
    const projection = (req.user.is_inventory_only && !req.user.is_inventory_admin) ? 'i.id,i.sku,i.nombre_comercial,i.nombre_tecnico,i.categoria_id,i.unidad_id,i.tipo,i.foto_url,i.precio_publico,i.precio_mayoreo,i.activo' : 'i.*';
    const orderBy = route === 'productos' && q.orden === 'nombre' ? 'i.nombre_comercial ASC,i.sku ASC,i.id ASC' : 'i.id DESC';
    const [items] = await pool.query(`SELECT ${projection} FROM ${def.table} i WHERE ${where} ORDER BY ${orderBy} LIMIT :limit OFFSET :offset`, params);
    if (route === 'productos' && (!req.user.is_inventory_only || req.user.is_inventory_admin) && items.length) {
      const supplierScope = inventoryScopeSql(scope.sucursalIds);
      const [suppliers] = await pool.query(`SELECT i.producto_id,
        IF(COUNT(DISTINCT i.proveedor_id)=1,MIN(i.proveedor_id),NULL) proveedor_id,
        IF(COUNT(DISTINCT i.proveedor_id)=1,MIN(p.nombre_comercial),NULL) proveedor_nombre,
        MIN(p.activo) proveedor_activo, COUNT(DISTINCT i.proveedor_id) proveedores_asignados
        FROM inv_producto_proveedor i JOIN inv_proveedor p ON p.id=i.proveedor_id
        JOIN inv_proveedor_sucursal ps ON ps.proveedor_id=i.proveedor_id AND ps.sucursal_id=i.sucursal_id
        WHERE i.preferido=1 AND i.producto_id IN (:products) AND ${supplierScope.sql}
        GROUP BY i.producto_id`, { ...supplierScope.params, products: items.map(item => item.id) });
      for (const item of items) Object.assign(item, suppliers.find(row => Number(row.producto_id) === Number(item.id)) ||
        { proveedor_id: null, proveedor_nombre: null, proveedor_activo: null, proveedores_asignados: 0 });
    }
    res.json({ items, total: Number(count.total), limit: q.limit, offset: q.offset });
  }));

  async function save(req, res) {
    if (def.global && !req.user.can_manage_inventory_catalog) fail('Solo el administrador global o de inventario puede modificar el catálogo compartido.', 403);
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
      if (route === 'productos') delete data.proveedor_id;
      if (!recordId && route === 'productos') data.creado_por = Number(req.user.sub);
      const fields = Object.keys(data); // Only schema-validated fields, never client identifiers.
      let savedId = recordId;
      if (recordId) await db.query(`UPDATE ${def.table} SET ${fields.map(c => `${c}=?`).join(',')} WHERE id=?`, [...Object.values(data), recordId]);
      else {
        const [insert] = await db.query(`INSERT INTO ${def.table} (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`, Object.values(data));
        savedId = insert.insertId;
      }
      if (route === 'productos' && body.proveedor_id !== undefined) {
        await requireActive(db, 'inv_proveedor', body.proveedor_id);
        const [branches] = await db.query('SELECT sucursal_id FROM inv_proveedor_sucursal WHERE proveedor_id=? FOR UPDATE', [body.proveedor_id]);
        if (!branches.length) fail('El proveedor no tiene sucursales asignadas.');
        const [previous] = await db.query('SELECT * FROM inv_producto_proveedor WHERE producto_id=? AND preferido=1 FOR UPDATE', [savedId]);
        await db.query('UPDATE inv_producto_proveedor SET preferido=0 WHERE producto_id=?', [savedId]);
        for (const branch of branches) {
          await db.query(`INSERT INTO inv_producto_proveedor(producto_id,proveedor_id,sucursal_id,preferido)
            VALUES (?,?,?,1) ON DUPLICATE KEY UPDATE preferido=1`, [savedId, body.proveedor_id, branch.sucursal_id]);
        }
        await audit(db, req, 'inv_producto_proveedor', savedId, previous.length ? previous : null,
          { producto_id: savedId, proveedor_id: body.proveedor_id, sucursal_ids: branches.map(branch => branch.sucursal_id) });
      }
      await audit(db, req, def.table, savedId, before, data, body.sucursal_id);
      return { id: savedId, ...body };
    });
    res.status(recordId ? 200 : 201).json(result);
  }
  router.post(`/${route}`, asyncHandler(save));
  router.put(`/${route}/:id`, asyncHandler(save));
}

router.delete('/productos/:id', asyncHandler(async (req, res) => {
  if ((!req.user.is_admin && !req.user.is_inventory_admin) || !req.user.can_manage_inventory_catalog) {
    fail('Solo el administrador global o de inventario puede eliminar artículos.', 403);
  }
  const productId = validate(id, req.params.id);
  await transaction(async db => {
    const [products] = await db.query('SELECT * FROM inv_producto WHERE id=? FOR UPDATE', [productId]);
    if (!products.length) fail('El artículo no existe.', 404);

    const relatedChecks = [
      ['inv_movimiento', 'producto_id'],
      ['inv_documento_detalle', 'producto_id'],
      ['inv_transferencia_detalle', 'producto_id'],
      ['inv_ajuste_solicitud', 'producto_id'],
      ['inv_orden_compra_detalle', 'producto_id'],
      ['inv_recepcion_compra_detalle', 'producto_id'],
      ['inv_conteo_ciclico_detalle', 'producto_id'],
    ];
    for (const [table, column] of relatedChecks) {
      const [related] = await db.query(`SELECT 1 FROM ${table} WHERE ${column}=? LIMIT 1`, [productId]);
      if (related.length) {
        fail('No se puede eliminar el artículo porque tiene movimientos o registros operativos relacionados. Puedes desactivarlo para conservar el historial.', 409);
      }
    }

    await db.query(`DELETE l FROM inv_notificacion_lectura l
      JOIN inv_notificacion n ON n.id=l.notificacion_id WHERE n.producto_id=?`, [productId]);
    await db.query('DELETE FROM inv_notificacion WHERE producto_id=?', [productId]);
    await db.query('DELETE FROM inv_existencia WHERE producto_id=?', [productId]);
    await db.query('DELETE FROM inv_costo_sucursal WHERE producto_id=?', [productId]);
    await db.query('DELETE FROM inv_producto_proveedor WHERE producto_id=?', [productId]);
    await db.query('DELETE FROM inv_producto_almacen WHERE producto_id=?', [productId]);
    await db.query(`INSERT INTO inv_auditoria (sucursal_id,usuario_id,accion,entidad,entidad_id,antes,despues)
      VALUES (NULL,?,'ELIMINAR','inv_producto',?,?,NULL)`, [Number(req.user.sub), productId, JSON.stringify(products[0])]);
    await db.query('DELETE FROM inv_producto WHERE id=?', [productId]);
  });
  res.status(204).end();
}));

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
