const { pool } = require('../../config/db');
const { buildUpdateSet, buildInsert } = require('../../utils/sql');

const TABLE = 'orden_sucursal';
const PK = ["id"];
const SELECT_FIELDS = ["id", "orden_id", "sucursal_id", "created_at"];
const INSERT_FIELDS = ["orden_id", "sucursal_id"];
const UPDATE_FIELDS = ["orden_id", "sucursal_id"];

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
