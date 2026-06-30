const { pool } = require('../../config/db');
const { buildUpdateSet, buildInsert } = require('../../utils/sql');

const TABLE = 'empleado';
const ASIGNACION_TABLE = 'orden_asignacion';
const PK = ["id"];
const SELECT_FIELDS = ["id", "nombre", "activo", "comision_pct", "clave_unica", "created_at", "updated_at"];
const INSERT_FIELDS = ["nombre", "activo", "comision_pct", "clave_unica"];
const UPDATE_FIELDS = ["nombre", "activo", "comision_pct"];

function columnList(fields) {
  return fields.map(f => `\`${f}\``).join(', ');
}

function createClaveUnica() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `EMP-${timestamp}-${random}`;
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
  const insert = buildInsert({ ...data, clave_unica: data.clave_unica || createClaveUnica() }, INSERT_FIELDS);
  if (!insert) throw Object.assign(new Error('No se enviaron datos para guardar.'), { status: 400 });
  const sql = `INSERT INTO \`${TABLE}\` (${insert.cols}) VALUES (${insert.params})`;
  const [result] = await pool.query(sql, insert.values);
  return getById(result.insertId);
}

async function updateOne(id, data) {
  const upd = buildUpdateSet(data, UPDATE_FIELDS);
  if (!upd) throw Object.assign(new Error('No se enviaron datos para actualizar.'), { status: 400 });
  const sql = `UPDATE \`${TABLE}\` SET ${upd.set} WHERE id = :id`;
  const [result] = await pool.query(sql, { ...upd.values, id });
  if (result.affectedRows === 0) return null;
  return getById(id);
}

async function removeOne(id) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(`DELETE FROM \`${ASIGNACION_TABLE}\` WHERE empleado_id = :empleado_id`, { empleado_id: id });
    const [result] = await connection.query(`DELETE FROM \`${TABLE}\` WHERE id = :id`, { id });
    await connection.commit();
    return result.affectedRows > 0;
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

module.exports = { list, getById, createOne, updateOne, removeOne };
