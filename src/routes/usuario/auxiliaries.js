const bcrypt = require('bcryptjs');
const { pool } = require('../../config/db');
const { normalizeRoleIds, buildUserScopeSql } = require('../../utils/userAccess');
const { buildUpdateSet, buildInsert } = require('../../utils/sql');

const TABLE = 'usuario';
const USUARIO_ROL_TABLE = 'usuario_rol';
const AUTH_REFRESH_TOKEN_TABLE = 'auth_refresh_token';
const ROL_TABLE = 'rol';
const PK = ["id"];
const SELECT_FIELDS = ["id", "correo", "nombre", "activo", "created_at", "updated_at"];
const INSERT_FIELDS = ["correo", "nombre", "activo"];
const UPDATE_FIELDS = ["correo", "nombre", "activo"];
function columnList(fields) {
  return fields.map(f => `\`${f}\``).join(', ');
}

async function hydrateRoles(rows, connection = pool) {
  if (!rows.length) return rows;

  const userIds = rows.map((row) => row.id);
  const [roleRows] = await connection.query(
    `SELECT ur.\`usuario_id\`, r.\`id\`, r.\`nombre\`, r.\`descripcion\`
       FROM \`${USUARIO_ROL_TABLE}\` ur
       INNER JOIN \`${ROL_TABLE}\` r ON r.\`id\` = ur.\`rol_id\`
      WHERE ur.\`usuario_id\` IN (?)`,
    [userIds],
  );

  const rolesByUserId = new Map();
  roleRows.forEach((row) => {
    const current = rolesByUserId.get(row.usuario_id) ?? [];
    current.push({
      id: row.id,
      nombre: row.nombre,
      descripcion: row.descripcion ?? null,
    });
    rolesByUserId.set(row.usuario_id, current);
  });

  return rows.map((row) => ({
    ...row,
    roles: rolesByUserId.get(row.id) ?? [],
  }));
}

async function replaceUserRoles(connection, userId, roleIds) {
  await connection.query('DELETE FROM usuario_rol WHERE usuario_id = :id', { id: userId });
  if (roleIds.length) await connection.query('INSERT INTO usuario_rol (usuario_id, rol_id) VALUES ?', [roleIds.map((id) => [userId, id])]);
}

async function list({ limit = 50, offset = 0 }, user) {
  const access = buildUserScopeSql(user);
  const [rows] = await pool.query(
    `SELECT ${SELECT_FIELDS.map((field) => 'u.' + field).join(', ')} FROM usuario u
     WHERE ${access.sql} ORDER BY u.id ASC LIMIT :limit OFFSET :offset`,
    { ...access.params, limit, offset },
  );
  return hydrateRoles(rows);
}

async function getById(id, user, connection = pool, lock = false) {
  const access = buildUserScopeSql(user);
  const [rows] = await connection.query(
    `SELECT ${SELECT_FIELDS.map((field) => 'u.' + field).join(', ')} FROM usuario u
     WHERE u.id = :id AND ${access.sql} LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    { ...access.params, id },
  );
  const hydrated = await hydrateRoles(rows, connection);
  return hydrated[0] || null;
}

async function transaction(work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function createOne(data, user) {
  return transaction(async (connection) => {
    const roleIds = await normalizeRoleIds(connection, data.role_ids, user);
    const password_hash = await bcrypt.hash(data.password, 10);
    const insert = buildInsert({ ...data, password_hash }, [...INSERT_FIELDS, 'password_hash']);
    const [result] = await connection.query(`INSERT INTO usuario (${insert.cols}) VALUES (${insert.params})`, insert.values);
    await replaceUserRoles(connection, result.insertId, roleIds);
    return getById(result.insertId, user, connection);
  });
}

async function updateOne(id, data, user) {
  return transaction(async (connection) => {
    // Authorize the existing account before changing its password or roles.
    const current = await getById(id, user, connection, true);
    if (!current) return null;
    const payload = { ...data };
    if (payload.role_ids !== undefined) {
      const roles = await normalizeRoleIds(connection, payload.role_ids, user);
      await replaceUserRoles(connection, id, roles);
    }
    if (payload.password !== undefined) payload.password_hash = await bcrypt.hash(payload.password, 10);
    const update = buildUpdateSet(payload, [...UPDATE_FIELDS, 'password_hash']);
    if (update) await connection.query(`UPDATE usuario SET ${update.set} WHERE id = :id`, { ...update.values, id });
    if (payload.password !== undefined || payload.role_ids !== undefined || payload.activo !== undefined) {
      await connection.query('UPDATE auth_refresh_token SET revoked_at = COALESCE(revoked_at, NOW()) WHERE usuario_id = :id', { id });
    }
    return getById(id, user, connection);
  });
}

async function removeOne(id, user) {
  return transaction(async (connection) => {
    if (!(await getById(id, user, connection, true))) return false;
    await connection.query('DELETE FROM usuario_rol WHERE usuario_id = :id', { id });
    await connection.query('DELETE FROM auth_refresh_token WHERE usuario_id = :id', { id });
    const [result] = await connection.query('DELETE FROM usuario WHERE id = :id', { id });
    return result.affectedRows > 0;
  });
}

module.exports = { list, getById, createOne, updateOne, removeOne };
