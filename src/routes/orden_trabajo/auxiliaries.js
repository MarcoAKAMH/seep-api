const { pool } = require('../../config/db');
const { buildUpdateSet, buildInsert } = require('../../utils/sql');

const TABLE = 'orden_trabajo';
const ASIGNACION_TABLE = 'orden_asignacion';
const GARANTIA_TABLE = 'garantia';
const ENCUESTA_TABLE = 'encuesta_satisfaccion';
const PK = ["id"];
const SELECT_FIELDS = ["id", "cliente_id", "vehiculo_id", "estatus_id", "fecha_ingreso", "fecha_entrega_estimada", "servicio", "inicio_reparacion_at", "entrega_at", "horas_permanencia", "reproceso", "a_tiempo", "valor_mano_obra", "valor_repuestos", "valor_reparacion", "facturado", "horas_reparacion", "dias_reparacion", "tipo_reparacion_id", "orden_texto", "causa", "total", "created_at", "updated_at"];
const INSERT_FIELDS = ["cliente_id", "vehiculo_id", "estatus_id", "fecha_ingreso", "fecha_entrega_estimada", "servicio", "inicio_reparacion_at", "entrega_at", "horas_permanencia", "reproceso", "a_tiempo", "valor_mano_obra", "valor_repuestos", "valor_reparacion", "facturado", "horas_reparacion", "dias_reparacion", "tipo_reparacion_id", "orden_texto", "causa", "total"];
const UPDATE_FIELDS = ["cliente_id", "vehiculo_id", "estatus_id", "fecha_ingreso", "fecha_entrega_estimada", "servicio", "inicio_reparacion_at", "entrega_at", "horas_permanencia", "reproceso", "a_tiempo", "valor_mano_obra", "valor_repuestos", "valor_reparacion", "facturado", "horas_reparacion", "dias_reparacion", "tipo_reparacion_id", "orden_texto", "causa", "total"];

function columnList(fields) {
  return fields.map(f => `\`${f}\``).join(', ');
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

async function list({ limit = 50, offset = 0 }) {
  const cols = columnList(SELECT_FIELDS);
  const sql = `SELECT ${cols} FROM \`${TABLE}\` LIMIT :limit OFFSET :offset`;
  const [rows] = await pool.query(sql, { limit, offset });
  return rows;
}

async function getById(id) {
  const cols = columnList(SELECT_FIELDS);
  const sql = `SELECT ${cols} FROM \`${TABLE}\` WHERE id = :id LIMIT 1`;
  const [rows] = await pool.query(sql, { id });
  return rows[0] || null;
}

async function createOne(data) {
  const { tecnicos_reparadores_ids, tecnicos_desmonte_ids, ...ordenData } = data;
  const insert = buildInsert(ordenData, INSERT_FIELDS);
  if (!insert) throw Object.assign(new Error('No se enviaron datos para guardar.'), { status: 400 });
  const sql = `INSERT INTO \`${TABLE}\` (${insert.cols}) VALUES (${insert.params})`;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(sql, insert.values);
    const ordenId = result.insertId;

    await replaceAsignaciones(connection, ordenId, tecnicos_reparadores_ids, tecnicos_desmonte_ids);

    await connection.commit();
    return getById(ordenId);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function updateOne(id, data) {
  const {
    tecnicos_reparadores_ids,
    tecnicos_desmonte_ids,
    ...ordenData
  } = data;
  const shouldReplaceAsignaciones =
    tecnicos_reparadores_ids !== undefined || tecnicos_desmonte_ids !== undefined;
  const upd = buildUpdateSet(ordenData, UPDATE_FIELDS);

  if (!upd && !shouldReplaceAsignaciones) {
    throw Object.assign(new Error('No se enviaron datos para actualizar.'), { status: 400 });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    if (upd) {
      const sql = `UPDATE \`${TABLE}\` SET ${upd.set} WHERE id = :id`;
      const [result] = await connection.query(sql, { ...upd.values, id });
      if (result.affectedRows === 0) {
        await connection.rollback();
        return null;
      }
    } else {
      const [rows] = await connection.query(
        `SELECT \`id\` FROM \`${TABLE}\` WHERE \`id\` = :id LIMIT 1`,
        { id },
      );
      if (rows.length === 0) {
        await connection.rollback();
        return null;
      }
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

  return getById(id);
}

async function removeOne(id) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

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
