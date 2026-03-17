const { pool } = require('../../config/db');
const { buildUpdateSet, buildInsert } = require('../../utils/sql');

const TABLE = 'usuario_rol';
const PK = ["usuario_id", "rol_id"];
const SELECT_FIELDS = ["usuario_id", "rol_id"];
const INSERT_FIELDS = ["usuario_id", "rol_id"];
const UPDATE_FIELDS = [];

function columnList(fields) {
  return fields.map(f => `\`${f}\``).join(', ');
}

async function list({ limit = 50, offset = 0 }) {
  const cols = columnList(SELECT_FIELDS);
  const sql = `SELECT ${cols} FROM \`${TABLE}\` LIMIT :limit OFFSET :offset`;
  const [rows] = await pool.query(sql, { limit, offset });
  return rows;
}

async function getByKey(keys) {
  const cols = columnList(SELECT_FIELDS);
  const sql = `SELECT ${cols} FROM \`${TABLE}\` WHERE usuario_id = :usuario_id AND rol_id = :rol_id LIMIT 1`;
  const [rows] = await pool.query(sql, keys);
  return rows[0] || null;
}

async function createOne(data) {
  const insert = buildInsert(data, INSERT_FIELDS);
  if (!insert) throw Object.assign(new Error('No se enviaron datos para guardar.'), { status: 400 });
  const sql = `INSERT INTO \`${TABLE}\` (${insert.cols}) VALUES (${insert.params})`;
  const [result] = await pool.query(sql, insert.values);
  return getByKey({ usuario_id: insert.values['usuario_id'], rol_id: insert.values['rol_id'] });
}

async function updateOne(keys, data) {
  // composite PK table: replace row by delete + insert
  const next = { ...keys, ...data };
  await removeOne(keys);
  return createOne(next);
}

async function removeOne(keys) {
  const [result] = await pool.query(`DELETE FROM \`${TABLE}\` WHERE usuario_id = :usuario_id AND rol_id = :rol_id`, keys);
  return result.affectedRows > 0;
}

module.exports = { list, getByKey, createOne, updateOne, removeOne };
