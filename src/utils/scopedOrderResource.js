const { buildUpdateSet, buildInsert } = require('./sql');
const { getOrderScope, buildOrderScopeSql } = require('./sucursalAccess');

// Child records inherit access from their order, including direct API requests.
function createScopedOrderResource({ pool, table, selectFields, insertFields, updateFields }) {
  const columns = selectFields.map((field) => `record.\`${field}\``).join(', ');

  function scope(user, orderIdExpression = 'record.orden_id') {
    return buildOrderScopeSql(getOrderScope(user), orderIdExpression);
  }

  async function list({ limit = 50, offset = 0 }, user) {
    const access = scope(user);
    const [rows] = await pool.query(
      `SELECT ${columns} FROM \`${table}\` record WHERE ${access.sql}
       ORDER BY record.id ASC LIMIT :limit OFFSET :offset`,
      { ...access.params, limit, offset },
    );
    return rows;
  }

  async function getById(id, user, db = pool, lock = false) {
    const access = scope(user);
    const [rows] = await db.query(
      `SELECT ${columns} FROM \`${table}\` record
       WHERE record.id = :id AND ${access.sql} LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
      { ...access.params, id },
    );
    return rows[0] || null;
  }

  async function assertOrderAccess(db, orderId, user) {
    const access = scope(user, 'ot.id');
    const [rows] = await db.query(
      `SELECT ot.id FROM orden_trabajo ot
       WHERE ot.id = :order_id AND ${access.sql} FOR UPDATE`,
      { ...access.params, order_id: orderId },
    );
    if (!rows.length) {
      throw Object.assign(new Error('No tienes acceso a la orden indicada.'), { status: 403 });
    }
  }

  async function transaction(work) {
    const db = await pool.getConnection();
    try {
      await db.beginTransaction();
      const result = await work(db);
      await db.commit();
      return result;
    } catch (error) {
      await db.rollback();
      throw error;
    } finally {
      db.release();
    }
  }

  async function createOne(data, user) {
    return transaction(async (db) => {
      await assertOrderAccess(db, data.orden_id, user);
      const insert = buildInsert(data, insertFields);
      if (!insert) throw Object.assign(new Error('No se enviaron datos para guardar.'), { status: 400 });
      const [result] = await db.query(
        `INSERT INTO \`${table}\` (${insert.cols}) VALUES (${insert.params})`, insert.values,
      );
      return getById(result.insertId, user, db);
    });
  }

  async function updateOne(id, data, user) {
    return transaction(async (db) => {
      const current = await getById(id, user, db, true);
      if (!current) return null;
      await assertOrderAccess(db, current.orden_id, user);
      if (data.orden_id !== undefined && Number(data.orden_id) !== Number(current.orden_id)) {
        await assertOrderAccess(db, data.orden_id, user);
      }
      const update = buildUpdateSet(data, updateFields);
      if (!update) throw Object.assign(new Error('No se enviaron datos para actualizar.'), { status: 400 });
      await db.query(`UPDATE \`${table}\` SET ${update.set} WHERE id = :id`, { ...update.values, id });
      return getById(id, user, db);
    });
  }

  async function removeOne(id, user) {
    return transaction(async (db) => {
      const current = await getById(id, user, db, true);
      if (!current) return false;
      await assertOrderAccess(db, current.orden_id, user);
      const [result] = await db.query(`DELETE FROM \`${table}\` WHERE id = :id`, { id });
      return result.affectedRows > 0;
    });
  }

  return { list, getById, createOne, updateOne, removeOne };
}

module.exports = { createScopedOrderResource };
