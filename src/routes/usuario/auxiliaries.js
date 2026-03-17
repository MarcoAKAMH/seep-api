const bcrypt = require('bcryptjs');
const { pool } = require('../../config/db');
const { buildUpdateSet, buildInsert } = require('../../utils/sql');

const TABLE = 'usuario';
const PK = ["id"];
const SELECT_FIELDS = ["id", "correo", "nombre", "activo", "created_at", "updated_at"];
const INSERT_FIELDS = ["correo", "nombre", "activo"];
const UPDATE_FIELDS = ["correo", "nombre", "activo"];

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
  const { password, ...rest } = data;
  const password_hash = await bcrypt.hash(password, 10);
  const payload = { ...rest, password_hash };
  const insert = buildInsert(payload, [...INSERT_FIELDS, 'password_hash']);
  if (!insert) throw Object.assign(new Error('No data to insert'), { status: 400 });
  const sql = `INSERT INTO \`${TABLE}\` (${insert.cols}) VALUES (${insert.params})`;
  const [result] = await pool.query(sql, insert.values);
  return getById(result.insertId);
}

async function updateOne(id, data) {
  const next = { ...data };
  if (next.password !== undefined) {
    next.password_hash = await bcrypt.hash(next.password, 10);
    delete next.password;
  }
  const upd = buildUpdateSet(next, [...UPDATE_FIELDS, 'password_hash']);
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
