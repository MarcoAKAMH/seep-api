const { pool } = require('../../config/db');
const { buildUpdateSet, buildInsert } = require('../../utils/sql');
const {
  assertVehiclePlateIsUnique,
  normalizeVehiclePlate,
  rethrowDuplicateVehiclePlateError,
} = require('../../utils/vehiclePlates');

const TABLE = 'vehiculo';
const PK = ["id"];
const SELECT_FIELDS = ["id", "cliente_id", "marca", "modelo_marca", "placas", "unidad_vin", "anio", "categoria_id", "created_at", "updated_at"];
const INSERT_FIELDS = ["cliente_id", "marca", "modelo_marca", "placas", "unidad_vin", "anio", "categoria_id"];
const UPDATE_FIELDS = ["cliente_id", "marca", "modelo_marca", "placas", "unidad_vin", "anio", "categoria_id"];

function columnList(fields) {
  return fields.map(f => `\`${f}\``).join(', ');
}

function normalizeVehicleData(data) {
  if (!Object.prototype.hasOwnProperty.call(data, 'placas')) return data;
  return { ...data, placas: normalizeVehiclePlate(data.placas) };
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
  const normalizedData = normalizeVehicleData(data);
  if (normalizedData.placas) await assertVehiclePlateIsUnique(pool, normalizedData.placas);
  const insert = buildInsert(normalizedData, INSERT_FIELDS);
  if (!insert) throw Object.assign(new Error('No se enviaron datos para guardar.'), { status: 400 });
  const sql = `INSERT INTO \`${TABLE}\` (${insert.cols}) VALUES (${insert.params})`;
  let result;
  try {
    [result] = await pool.query(sql, insert.values);
  } catch (err) {
    await rethrowDuplicateVehiclePlateError(pool, err, normalizedData.placas);
  }
  return getById(result.insertId);
}

async function updateOne(id, data) {
  const normalizedData = normalizeVehicleData(data);
  if (normalizedData.placas) await assertVehiclePlateIsUnique(pool, normalizedData.placas, id);
  const upd = buildUpdateSet(normalizedData, UPDATE_FIELDS);
  if (!upd) throw Object.assign(new Error('No se enviaron datos para actualizar.'), { status: 400 });
  const sql = `UPDATE \`${TABLE}\` SET ${upd.set} WHERE id = :id`;
  let result;
  try {
    [result] = await pool.query(sql, { ...upd.values, id });
  } catch (err) {
    await rethrowDuplicateVehiclePlateError(pool, err, normalizedData.placas, id);
  }
  if (result.affectedRows === 0) return null;
  return getById(id);
}

async function removeOne(id) {
  const [result] = await pool.query(`DELETE FROM \`${TABLE}\` WHERE id = :id`, { id });
  return result.affectedRows > 0;
}

module.exports = { list, getById, createOne, updateOne, removeOne };
