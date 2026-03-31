const { pool } = require('../../config/db');
const { buildUpdateSet, buildInsert } = require('../../utils/sql');

const TABLE = 'cliente';
const SELECT_FIELDS = ["id", "tipo_cliente_id", "nombre", "nombre_encargado", "telefono", "correo", "created_at", "updated_at"];
const INSERT_FIELDS = ["tipo_cliente_id", "nombre", "nombre_encargado", "telefono", "correo"];
const UPDATE_FIELDS = ["tipo_cliente_id", "nombre", "nombre_encargado", "telefono", "correo"];
const VEHICULO_TABLE = 'vehiculo';
const VEHICULO_SELECT_FIELDS = ["id", "cliente_id", "marca", "modelo_marca", "placas", "unidad_vin", "anio", "categoria_id", "created_at", "updated_at"];
const VEHICULO_INSERT_FIELDS = ["cliente_id", "marca", "modelo_marca", "placas", "unidad_vin", "anio", "categoria_id"];
const VEHICULO_UPDATE_FIELDS = ["marca", "modelo_marca", "placas", "unidad_vin", "anio", "categoria_id"];

function columnList(fields) {
  return fields.map(f => `\`${f}\``).join(', ');
}

function sanitizeClienteData(data) {
  const next = {};
  if (Object.prototype.hasOwnProperty.call(data, 'tipo_cliente_id')) next.tipo_cliente_id = data.tipo_cliente_id;
  if (Object.prototype.hasOwnProperty.call(data, 'nombre')) next.nombre = data.nombre;
  if (Object.prototype.hasOwnProperty.call(data, 'nombre_encargado')) next.nombre_encargado = data.nombre_encargado;
  if (Object.prototype.hasOwnProperty.call(data, 'telefono')) next.telefono = data.telefono;
  if (Object.prototype.hasOwnProperty.call(data, 'correo')) next.correo = data.correo || null;
  return next;
}

function sanitizeVehiculoData(data) {
  return {
    marca: data.marca,
    modelo_marca: data.modelo_marca,
    placas: data.placas,
    unidad_vin: data.unidad_vin,
    anio: data.anio,
    categoria_id: data.categoria_id,
  };
}

async function listVehiculosByClienteId(clienteId, db = pool) {
  const cols = columnList(VEHICULO_SELECT_FIELDS);
  const sql = `SELECT ${cols} FROM \`${VEHICULO_TABLE}\` WHERE cliente_id = :cliente_id ORDER BY id ASC`;
  const [rows] = await db.query(sql, { cliente_id: clienteId });
  return rows;
}

async function list({ limit = 50, offset = 0 }) {
  const cols = columnList(SELECT_FIELDS);
  const sql = `SELECT ${cols} FROM \`${TABLE}\` LIMIT :limit OFFSET :offset`;
  const [rows] = await pool.query(sql, { limit, offset });
  return rows;
}

async function getById(id, db = pool) {
  const cols = columnList(SELECT_FIELDS);
  const sql = `SELECT ${cols} FROM \`${TABLE}\` WHERE id = :id LIMIT 1`;
  const [rows] = await db.query(sql, { id });
  const row = rows[0] || null;
  if (!row) return null;
  const vehiculos = await listVehiculosByClienteId(id, db);
  return { ...row, vehiculos };
}

async function createVehiculo(db, clienteId, vehiculo) {
  const insert = buildInsert(
    { cliente_id: clienteId, ...sanitizeVehiculoData(vehiculo) },
    VEHICULO_INSERT_FIELDS
  );
  if (!insert) return;
  const sql = `INSERT INTO \`${VEHICULO_TABLE}\` (${insert.cols}) VALUES (${insert.params})`;
  await db.query(sql, insert.values);
}

async function updateVehiculo(db, clienteId, vehiculo) {
  const upd = buildUpdateSet(sanitizeVehiculoData(vehiculo), VEHICULO_UPDATE_FIELDS);
  if (!upd || !vehiculo.id) return;
  const sql = `UPDATE \`${VEHICULO_TABLE}\` SET ${upd.set} WHERE id = :id AND cliente_id = :cliente_id`;
  const [result] = await db.query(sql, { ...upd.values, id: vehiculo.id, cliente_id: clienteId });
  if (result.affectedRows === 0) {
    throw Object.assign(new Error('No se encontró el vehículo solicitado para este cliente.'), { status: 400 });
  }
}

async function syncVehiculos(db, clienteId, vehiculos) {
  const [existingRows] = await db.query(`SELECT id FROM \`${VEHICULO_TABLE}\` WHERE cliente_id = :cliente_id`, { cliente_id: clienteId });
  const existingIds = new Set(existingRows.map((row) => Number(row.id)));
  const retainedIds = new Set();

  for (const vehiculo of vehiculos) {
    if (vehiculo.id) {
      retainedIds.add(Number(vehiculo.id));
      if (!existingIds.has(Number(vehiculo.id))) {
        throw Object.assign(new Error('No se encontró el vehículo solicitado para este cliente.'), { status: 400 });
      }
      await updateVehiculo(db, clienteId, vehiculo);
    } else {
      await createVehiculo(db, clienteId, vehiculo);
    }
  }

  for (const existingId of existingIds) {
    if (retainedIds.has(existingId)) continue;
    await db.query(`DELETE FROM \`${VEHICULO_TABLE}\` WHERE id = :id AND cliente_id = :cliente_id`, {
      id: existingId,
      cliente_id: clienteId,
    });
  }
}

async function createOne(data) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const insert = buildInsert(sanitizeClienteData(data), INSERT_FIELDS);
    if (!insert) throw Object.assign(new Error('No se enviaron datos para guardar.'), { status: 400 });
    const sql = `INSERT INTO \`${TABLE}\` (${insert.cols}) VALUES (${insert.params})`;
    const [result] = await db.query(sql, insert.values);
    await syncVehiculos(db, result.insertId, data.vehiculos || []);
    await db.commit();
    return getById(result.insertId);
  } catch (err) {
    await db.rollback();
    throw err;
  } finally {
    db.release();
  }
}

async function updateOne(id, data) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const upd = buildUpdateSet(sanitizeClienteData(data), UPDATE_FIELDS);
    if (!upd && data.vehiculos === undefined) {
      throw Object.assign(new Error('No se enviaron datos para actualizar.'), { status: 400 });
    }
    if (upd) {
      const sql = `UPDATE \`${TABLE}\` SET ${upd.set} WHERE id = :id`;
      const [result] = await db.query(sql, { ...upd.values, id });
      if (result.affectedRows === 0) {
        const current = await getById(id, db);
        if (!current) {
          await db.rollback();
          return null;
        }
      }
    } else {
      const current = await getById(id, db);
      if (!current) {
        await db.rollback();
        return null;
      }
    }
    if (data.vehiculos !== undefined) {
      await syncVehiculos(db, id, data.vehiculos);
    }
    await db.commit();
    return getById(id);
  } catch (err) {
    await db.rollback();
    throw err;
  } finally {
    db.release();
  }
}

async function removeOne(id) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    await db.query(`DELETE FROM \`${VEHICULO_TABLE}\` WHERE cliente_id = :cliente_id`, { cliente_id: id });
    const [result] = await db.query(`DELETE FROM \`${TABLE}\` WHERE id = :id`, { id });
    if (!result.affectedRows) {
      await db.rollback();
      return false;
    }
    await db.commit();
    return true;
  } catch (err) {
    await db.rollback();
    throw err;
  } finally {
    db.release();
  }
}

module.exports = { list, getById, createOne, updateOne, removeOne };
