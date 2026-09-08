const { pool } = require('../../config/db');
const { loadRoleCatalog, validateRoleCombination } = require('../../utils/userAccess');

async function list({ limit = 50, offset = 0 }) {
  const [rows] = await pool.query('SELECT usuario_id, rol_id FROM usuario_rol ORDER BY usuario_id, rol_id LIMIT :limit OFFSET :offset', { limit, offset });
  return rows;
}

async function getByKey(keys, db = pool) {
  const [rows] = await db.query('SELECT usuario_id, rol_id FROM usuario_rol WHERE usuario_id = :usuario_id AND rol_id = :rol_id LIMIT 1', keys);
  return rows[0] || null;
}

async function mutate(action, keys, data) {
  const next = { ...keys, ...data };
  const userIds = [...new Set([keys?.usuario_id, next.usuario_id].filter(Boolean).map(Number))].sort((a, b) => a - b);
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [users] = await db.query('SELECT id FROM usuario WHERE id IN (?) ORDER BY id FOR UPDATE', [userIds]);
    if (users.length !== userIds.length) throw Object.assign(new Error('No se encontro el usuario.'), { status: 404 });
    if (action !== 'create' && !(await getByKey(keys, db))) { await db.rollback(); return null; }
    const [current] = await db.query('SELECT usuario_id, rol_id FROM usuario_rol WHERE usuario_id IN (?)', [userIds]);
    const projected = current.filter((row) => action === 'create' || Number(row.usuario_id) !== Number(keys.usuario_id) || Number(row.rol_id) !== Number(keys.rol_id));
    if (action !== 'delete') projected.push(next);
    const catalog = await loadRoleCatalog(db);
    for (const userId of userIds) {
      validateRoleCombination(projected.filter((row) => Number(row.usuario_id) === userId).map((row) => Number(row.rol_id)),
        catalog.roles, catalog.sucursales, catalog.mappings, { allowEmpty: true });
    }
    if (action !== 'create') await db.query('DELETE FROM usuario_rol WHERE usuario_id = :usuario_id AND rol_id = :rol_id', keys);
    if (action !== 'delete') await db.query('INSERT INTO usuario_rol (usuario_id, rol_id) VALUES (:usuario_id, :rol_id)', next);
    await db.query('UPDATE auth_refresh_token SET revoked_at = COALESCE(revoked_at, NOW()) WHERE usuario_id IN (?)', [userIds]);
    await db.commit();
    return action === 'delete' ? true : next;
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    db.release();
  }
}

const createOne = (data) => mutate('create', null, data);
const updateOne = (keys, data) => mutate('update', keys, data);
const removeOne = (keys) => mutate('delete', keys, {});
module.exports = { list, getByKey, createOne, updateOne, removeOne };
