const { pool } = require('../../config/db');
const { buildUpdateSet, buildInsert } = require('../../utils/sql');

const TABLE = 'orden_trabajo';
const PK = ["id"];
const SELECT_FIELDS = ["id", "folio", "cliente_id", "vehiculo_id", "estatus_id", "fecha_ingreso", "fecha_entrega_estimada", "servicio", "inicio_reparacion_at", "entrega_at", "horas_permanencia", "reproceso", "a_tiempo", "valor_mano_obra", "valor_repuestos", "valor_reparacion", "facturado", "horas_reparacion", "dias_reparacion", "tipo_reparacion_id", "orden_texto", "causa", "total", "created_at", "updated_at"];
const INSERT_FIELDS = ["folio", "cliente_id", "vehiculo_id", "estatus_id", "fecha_ingreso", "fecha_entrega_estimada", "servicio", "inicio_reparacion_at", "entrega_at", "horas_permanencia", "reproceso", "a_tiempo", "valor_mano_obra", "valor_repuestos", "valor_reparacion", "facturado", "horas_reparacion", "dias_reparacion", "tipo_reparacion_id", "orden_texto", "causa", "total"];
const UPDATE_FIELDS = ["folio", "cliente_id", "vehiculo_id", "estatus_id", "fecha_ingreso", "fecha_entrega_estimada", "servicio", "inicio_reparacion_at", "entrega_at", "horas_permanencia", "reproceso", "a_tiempo", "valor_mano_obra", "valor_repuestos", "valor_reparacion", "facturado", "horas_reparacion", "dias_reparacion", "tipo_reparacion_id", "orden_texto", "causa", "total"];

function columnList(fields) {
  return fields.map(f => `\`${f}\``).join(', ');
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
  const insert = buildInsert(data, INSERT_FIELDS);
  if (!insert) throw Object.assign(new Error('No data to insert'), { status: 400 });
  const sql = `INSERT INTO \`${TABLE}\` (${insert.cols}) VALUES (${insert.params})`;
  const [result] = await pool.query(sql, insert.values);
  return getById(result.insertId);
}

async function updateOne(id, data) {
  const upd = buildUpdateSet(data, UPDATE_FIELDS);
  if (!upd) throw Object.assign(new Error('No data to update'), { status: 400 });
  const sql = `UPDATE \`${TABLE}\` SET ${upd.set} WHERE id = :id`;
  const [result] = await pool.query(sql, { ...upd.values, id });
  if (result.affectedRows === 0) return null;
  return getById(id);
}

async function removeOne(id) {
  const [result] = await pool.query(`DELETE FROM \`${TABLE}\` WHERE id = :id`, { id });
  return result.affectedRows > 0;
}

module.exports = { list, getById, createOne, updateOne, removeOne };
