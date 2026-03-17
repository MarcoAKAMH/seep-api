const { pool } = require('../../config/db');
const { buildUpdateSet, buildInsert } = require('../../utils/sql');

const TABLE = 'cliente';
const PK = ["id"];
const SELECT_FIELDS = ["id", "tipo_cliente_id", "nombre", "clave_unica", "created_at", "updated_at"];
const INSERT_FIELDS = ["tipo_cliente_id", "nombre", "clave_unica"];
const UPDATE_FIELDS = ["tipo_cliente_id", "nombre", "clave_unica"];

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
  const [result] = await pool.query(`DELETE FROM \`${TABLE}\` WHERE id = :id`, { id });
  return result.affectedRows > 0;
}

module.exports = { list, getById, createOne, updateOne, removeOne };
