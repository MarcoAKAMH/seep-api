const { pool } = require('../../config/db');
const { buildUpdateSet, buildInsert } = require('../../utils/sql');

const TABLE = 'orden_trabajo';
const ASIGNACION_TABLE = 'orden_asignacion';
const ORDEN_SUCURSAL_TABLE = 'orden_sucursal';
const GARANTIA_TABLE = 'garantia';
const ENCUESTA_TABLE = 'encuesta_satisfaccion';
const VEHICULO_TABLE = 'vehiculo';
const CATEGORIA_TABLE = 'cat_categoria_vehiculo';
const SUCURSAL_TABLE = 'cat_sucursal';
const PK = ["id"];
const SELECT_FIELDS = ["id", "cliente_id", "vehiculo_id", "estatus_id", "fecha_ingreso", "fecha_entrega_estimada", "servicio", "inicio_reparacion_at", "entrega_at", "reproceso", "a_tiempo", "valor_mano_obra", "valor_repuestos", "facturado", "horas_reparacion", "dias_reparacion", "tipo_reparacion_id", "orden_texto", "causa", "total", "created_at", "updated_at"];
const INSERT_FIELDS = ["cliente_id", "vehiculo_id", "estatus_id", "fecha_ingreso", "fecha_entrega_estimada", "servicio", "inicio_reparacion_at", "entrega_at", "reproceso", "a_tiempo", "valor_mano_obra", "valor_repuestos", "facturado", "horas_reparacion", "dias_reparacion", "tipo_reparacion_id", "orden_texto", "causa", "total"];
const UPDATE_FIELDS = ["cliente_id", "vehiculo_id", "estatus_id", "fecha_ingreso", "fecha_entrega_estimada", "servicio", "inicio_reparacion_at", "entrega_at", "reproceso", "a_tiempo", "valor_mano_obra", "valor_repuestos", "facturado", "horas_reparacion", "dias_reparacion", "tipo_reparacion_id", "orden_texto", "causa", "total"];

function columnList(fields, tableAlias = null) {
  if (!tableAlias) return fields.map(f => `\`${f}\``).join(', ');
  return fields.map((f) => `${tableAlias}.\`${f}\``).join(', ');
}

function getAllowedSucursalIds(user) {
  return Array.isArray(user?.allowed_sucursal_ids)
    ? user.allowed_sucursal_ids.map((id) => Number(id)).filter(Boolean)
    : [];
}

function canViewAllOrders(user) {
  return Boolean(user?.is_admin || user?.can_view_all_orders);
}

function assertSucursalAccess(user, sucursalId) {
  if (canViewAllOrders(user)) return;

  const allowedSucursalIds = getAllowedSucursalIds(user);
  if (!allowedSucursalIds.includes(Number(sucursalId))) {
    throw Object.assign(new Error('No tienes permisos para operar órdenes de esta sucursal.'), { status: 403 });
  }
}

async function getVehiculoWithCategoria(connection, vehiculoId) {
  const [rows] = await connection.query(
    `SELECT v.\`id\`, v.\`cliente_id\`, v.\`categoria_id\`, c.\`nombre\` AS categoria_nombre
       FROM \`${VEHICULO_TABLE}\` v
       LEFT JOIN \`${CATEGORIA_TABLE}\` c ON c.\`id\` = v.\`categoria_id\`
      WHERE v.\`id\` = :id
      LIMIT 1`,
    { id: vehiculoId },
  );

  return rows[0] || null;
}

async function sucursalExists(connection, sucursalId) {
  const [rows] = await connection.query(
    `SELECT \`id\`
       FROM \`${SUCURSAL_TABLE}\`
      WHERE \`id\` = :id
      LIMIT 1`,
    { id: sucursalId },
  );
  return rows.length > 0;
}

async function normalizeOrdenData(connection, data, currentOrder = null) {
  const normalized = { ...data };
  const clienteId = normalized.cliente_id ?? currentOrder?.cliente_id ?? null;
  const vehiculoId =
    Object.prototype.hasOwnProperty.call(normalized, 'vehiculo_id')
      ? normalized.vehiculo_id
      : (currentOrder?.vehiculo_id ?? null);

  if (vehiculoId) {
    const vehiculo = await getVehiculoWithCategoria(connection, vehiculoId);
    if (!vehiculo) {
      throw Object.assign(new Error('El vehículo seleccionado no existe.'), { status: 400 });
    }

    if (clienteId && Number(vehiculo.cliente_id) !== Number(clienteId)) {
      throw Object.assign(new Error('El vehículo seleccionado no pertenece al cliente indicado.'), { status: 400 });
    }

    if (!vehiculo.categoria_nombre) {
      throw Object.assign(new Error('El vehículo seleccionado no tiene una categoría válida.'), { status: 400 });
    }

    normalized.tipo_reparacion_id = vehiculo.categoria_id;
    return normalized;
  }

  const tipoReparacionId =
    Object.prototype.hasOwnProperty.call(normalized, 'tipo_reparacion_id')
      ? normalized.tipo_reparacion_id
      : (currentOrder?.tipo_reparacion_id ?? null);

  if (!tipoReparacionId) {
    throw Object.assign(new Error('Selecciona un vehículo o el tipo de reparación "Material suelto".'), { status: 400 });
  }

  const [rows] = await connection.query(
    `SELECT \`id\`, \`nombre\`
       FROM \`${CATEGORIA_TABLE}\`
      WHERE \`id\` = :id
      LIMIT 1`,
    { id: tipoReparacionId },
  );

  if (rows.length === 0) {
    throw Object.assign(new Error('El tipo de reparación seleccionado no existe.'), { status: 400 });
  }

  if (String(rows[0].nombre || '').trim().toLowerCase() !== 'material suelto') {
    throw Object.assign(new Error('Solo se puede omitir el vehículo cuando la orden es de tipo "Material suelto".'), { status: 400 });
  }

  return normalized;
}

async function replaceSucursal(connection, ordenId, sucursalId) {
  await connection.query(
    `DELETE FROM \`${ORDEN_SUCURSAL_TABLE}\` WHERE \`orden_id\` = :orden_id`,
    { orden_id: ordenId },
  );

  if (!sucursalId) return;

  await connection.query(
    `INSERT INTO \`${ORDEN_SUCURSAL_TABLE}\` (\`orden_id\`, \`sucursal_id\`) VALUES (:orden_id, :sucursal_id)`,
    { orden_id: ordenId, sucursal_id: sucursalId },
  );
}

async function hydrateSucursales(rows) {
  if (!rows.length) return rows;

  const ordenIds = rows.map((row) => row.id);
  const [sucursales] = await pool.query(
    `SELECT \`orden_id\`, \`sucursal_id\`
       FROM \`${ORDEN_SUCURSAL_TABLE}\`
      WHERE \`orden_id\` IN (?)`,
    [ordenIds],
  );

  const sucursalIdByOrdenId = new Map();
  sucursales.forEach((row) => {
    sucursalIdByOrdenId.set(row.orden_id, row.sucursal_id);
  });

  return rows.map((row) => ({
    ...row,
    sucursal_id: sucursalIdByOrdenId.get(row.id) ?? null,
  }));
}

function buildAsignaciones(reparadores = [], desmontes = []) {
  const rows = [];

  for (const empleadoId of [...new Set(reparadores)]) {
    rows.push({ empleado_id: empleadoId, rol_en_orden: 'reparador' });
  }

  for (const empleadoId of [...new Set(desmontes)]) {
    rows.push({ empleado_id: empleadoId, rol_en_orden: 'desmonte' });
  }

  return rows;
}

async function replaceAsignaciones(connection, ordenId, reparadores = [], desmontes = []) {
  await connection.query(
    `DELETE FROM \`${ASIGNACION_TABLE}\` WHERE \`orden_id\` = :orden_id`,
    { orden_id: ordenId },
  );

  const asignaciones = buildAsignaciones(reparadores, desmontes);
  if (asignaciones.length === 0) return;

  const values = asignaciones.map(({ empleado_id, rol_en_orden }) => [ordenId, empleado_id, rol_en_orden]);
  await connection.query(
    `INSERT INTO \`${ASIGNACION_TABLE}\` (\`orden_id\`, \`empleado_id\`, \`rol_en_orden\`) VALUES ?`,
    [values],
  );
}

async function list({ limit = 50, offset = 0 }, user) {
  const cols = columnList(SELECT_FIELDS, 'ot');
  let sql = `SELECT ${cols} FROM \`${TABLE}\` ot`;
  const queryParams = [];

  if (!canViewAllOrders(user)) {
    const allowedSucursalIds = getAllowedSucursalIds(user);
    if (allowedSucursalIds.length === 0) return [];
    sql += ` INNER JOIN \`${ORDEN_SUCURSAL_TABLE}\` os ON os.\`orden_id\` = ot.\`id\`
             WHERE os.\`sucursal_id\` IN (?)`;
    queryParams.push(allowedSucursalIds);
  }

  sql += ` LIMIT ? OFFSET ?`;
  queryParams.push(limit, offset);
  const [rows] = await pool.query(sql, queryParams);
  return hydrateSucursales(rows);
}

async function getById(id, user) {
  const cols = columnList(SELECT_FIELDS, 'ot');
  let sql = `SELECT ${cols} FROM \`${TABLE}\` ot WHERE ot.\`id\` = ?`;
  const queryParams = [id];

  if (!canViewAllOrders(user)) {
    const allowedSucursalIds = getAllowedSucursalIds(user);
    if (allowedSucursalIds.length === 0) return null;
    sql = `SELECT ${cols}
             FROM \`${TABLE}\` ot
             INNER JOIN \`${ORDEN_SUCURSAL_TABLE}\` os ON os.\`orden_id\` = ot.\`id\`
            WHERE ot.\`id\` = ?
              AND os.\`sucursal_id\` IN (?)`;
    queryParams.push(allowedSucursalIds);
  }

  sql += ' LIMIT 1';
  const [rows] = await pool.query(sql, queryParams);
  const hydratedRows = await hydrateSucursales(rows);
  return hydratedRows[0] || null;
}

async function createOne(data, user) {
  const { sucursal_id, tecnicos_reparadores_ids, tecnicos_desmonte_ids, ...ordenData } = data;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    if (!sucursal_id || !(await sucursalExists(connection, sucursal_id))) {
      throw Object.assign(new Error('Selecciona una sucursal valida.'), { status: 400 });
    }
    assertSucursalAccess(user, sucursal_id);

    const normalizedOrdenData = await normalizeOrdenData(connection, ordenData);
    const insert = buildInsert(normalizedOrdenData, INSERT_FIELDS);
    if (!insert) throw Object.assign(new Error('No se enviaron datos para guardar.'), { status: 400 });
    const sql = `INSERT INTO \`${TABLE}\` (${insert.cols}) VALUES (${insert.params})`;

    const [result] = await connection.query(sql, insert.values);
    const ordenId = result.insertId;

    await replaceSucursal(connection, ordenId, sucursal_id);
    await replaceAsignaciones(connection, ordenId, tecnicos_reparadores_ids, tecnicos_desmonte_ids);

    await connection.commit();
    return getById(ordenId, user);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function updateOne(id, data, user) {
  const {
    sucursal_id,
    tecnicos_reparadores_ids,
    tecnicos_desmonte_ids,
    ...ordenData
  } = data;
  const shouldReplaceSucursal = Object.prototype.hasOwnProperty.call(data, 'sucursal_id');
  const shouldReplaceAsignaciones =
    tecnicos_reparadores_ids !== undefined || tecnicos_desmonte_ids !== undefined;

  if (Object.keys(ordenData).length === 0 && !shouldReplaceAsignaciones && !shouldReplaceSucursal) {
    throw Object.assign(new Error('No se enviaron datos para actualizar.'), { status: 400 });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const currentOrder = await getById(id, user);
    if (!currentOrder) {
      await connection.rollback();
      return null;
    }

    if (shouldReplaceSucursal) {
      if (!sucursal_id || !(await sucursalExists(connection, sucursal_id))) {
        throw Object.assign(new Error('Selecciona una sucursal valida.'), { status: 400 });
      }
      assertSucursalAccess(user, sucursal_id);
    }

    const normalizedOrdenData =
      Object.keys(ordenData).length > 0
        ? await normalizeOrdenData(connection, ordenData, currentOrder)
        : null;
    const upd = normalizedOrdenData ? buildUpdateSet(normalizedOrdenData, UPDATE_FIELDS) : null;

    if (upd) {
      const sql = `UPDATE \`${TABLE}\` SET ${upd.set} WHERE id = :id`;
      const [result] = await connection.query(sql, { ...upd.values, id });
      if (result.affectedRows === 0) {
        await connection.rollback();
        return null;
      }
    }

    if (shouldReplaceSucursal) {
      await replaceSucursal(connection, id, sucursal_id);
    }

    if (shouldReplaceAsignaciones) {
      await replaceAsignaciones(connection, id, tecnicos_reparadores_ids, tecnicos_desmonte_ids);
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return getById(id, user);
}

async function removeOne(id, user) {
  const currentOrder = await getById(id, user);
  if (!currentOrder) return false;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    await connection.query(
      `DELETE FROM \`${ORDEN_SUCURSAL_TABLE}\` WHERE \`orden_id\` = :orden_id`,
      { orden_id: id },
    );
    await connection.query(
      `DELETE FROM \`${ASIGNACION_TABLE}\` WHERE \`orden_id\` = :orden_id`,
      { orden_id: id },
    );
    await connection.query(
      `DELETE FROM \`${GARANTIA_TABLE}\` WHERE \`orden_id\` = :orden_id`,
      { orden_id: id },
    );
    await connection.query(
      `DELETE FROM \`${ENCUESTA_TABLE}\` WHERE \`orden_id\` = :orden_id`,
      { orden_id: id },
    );

    const [result] = await connection.query(`DELETE FROM \`${TABLE}\` WHERE id = :id`, { id });
    await connection.commit();
    return result.affectedRows > 0;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { list, getById, createOne, updateOne, removeOne };
