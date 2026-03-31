const bcrypt = require('bcryptjs');
const { pool } = require('../../config/db');
const { ROLE_IDS } = require('../../config/roles');
const { buildUpdateSet, buildInsert } = require('../../utils/sql');

const TABLE = 'usuario';
const USUARIO_ROL_TABLE = 'usuario_rol';
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

async function normalizeRoleIds(connection, roleIds) {
  const uniqueRoleIds = Array.from(new Set((roleIds || []).map((id) => Number(id)).filter(Boolean)));
  if (uniqueRoleIds.length === 0) {
    throw Object.assign(new Error('Selecciona al menos un rol.'), { status: 400 });
  }

  const [rows] = await connection.query(
    `SELECT \`id\`, \`nombre\`
       FROM \`${ROL_TABLE}\`
      WHERE \`id\` IN (?)`,
    [uniqueRoleIds],
  );

  if (rows.length !== uniqueRoleIds.length) {
    throw Object.assign(new Error('Uno o más roles seleccionados no existen.'), { status: 400 });
  }

  const hasAdmin = rows.some((row) => Number(row.id) === ROLE_IDS.ADMINISTRADOR);
  if (hasAdmin && rows.length > 1) {
    throw Object.assign(new Error('El rol Admin no se puede combinar con otros roles.'), { status: 400 });
  }

  return rows.map((row) => row.id);
}

async function replaceUserRoles(connection, userId, roleIds) {
  await connection.query(
    `DELETE FROM \`${USUARIO_ROL_TABLE}\` WHERE \`usuario_id\` = :usuario_id`,
    { usuario_id: userId },
  );

  if (!roleIds?.length) return;

  const values = roleIds.map((roleId) => [userId, roleId]);
  await connection.query(
    `INSERT INTO \`${USUARIO_ROL_TABLE}\` (\`usuario_id\`, \`rol_id\`) VALUES ?`,
    [values],
  );
}

async function list({ limit = 50, offset = 0 }) {
  const cols = columnList(SELECT_FIELDS);
  const sql = `SELECT ${cols} FROM \`${TABLE}\` LIMIT :limit OFFSET :offset`;
  const [rows] = await pool.query(sql, { limit, offset });
  return hydrateRoles(rows);
}

async function getById(id) {
  const cols = columnList(SELECT_FIELDS);
  const sql = `SELECT ${cols} FROM \`${TABLE}\` WHERE id = :id LIMIT 1`;
  const [rows] = await pool.query(sql, { id });
  const hydratedRows = await hydrateRoles(rows);
  return hydratedRows[0] || null;
}

async function createOne(data) {
  const { password, role_ids, ...rest } = data;
  const password_hash = await bcrypt.hash(password, 10);
  const payload = { ...rest, password_hash };

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const normalizedRoleIds = await normalizeRoleIds(connection, role_ids);
    const insert = buildInsert(payload, [...INSERT_FIELDS, 'password_hash']);
    if (!insert) throw Object.assign(new Error('No se enviaron datos para guardar.'), { status: 400 });
    const sql = `INSERT INTO \`${TABLE}\` (${insert.cols}) VALUES (${insert.params})`;
    const [result] = await connection.query(sql, insert.values);

    await replaceUserRoles(connection, result.insertId, normalizedRoleIds);

    await connection.commit();
    return getById(result.insertId);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function updateOne(id, data) {
  const next = { ...data };
  const roleIds = Object.prototype.hasOwnProperty.call(next, 'role_ids') ? next.role_ids : undefined;
  delete next.role_ids;
  if (next.password !== undefined) {
    next.password_hash = await bcrypt.hash(next.password, 10);
    delete next.password;
  }
  const upd = buildUpdateSet(next, [...UPDATE_FIELDS, 'password_hash']);
  const shouldReplaceRoles = roleIds !== undefined;

  if (!upd && !shouldReplaceRoles) throw Object.assign(new Error('No se enviaron datos para actualizar.'), { status: 400 });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    if (shouldReplaceRoles) {
      const normalizedRoleIds = await normalizeRoleIds(connection, roleIds);
      await replaceUserRoles(connection, id, normalizedRoleIds);
    }

    if (upd) {
      const sql = `UPDATE \`${TABLE}\` SET ${upd.set} WHERE id = :id`;
      const [result] = await connection.query(sql, { ...upd.values, id });
      if (result.affectedRows === 0) {
        await connection.rollback();
        return null;
      }
    } else {
      const [rows] = await connection.query(
        `SELECT \`id\` FROM \`${TABLE}\` WHERE \`id\` = :id LIMIT 1`,
        { id },
      );
      if (rows.length === 0) {
        await connection.rollback();
        return null;
      }
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return getById(id);
}

async function removeOne(id) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `DELETE FROM \`${USUARIO_ROL_TABLE}\` WHERE \`usuario_id\` = :usuario_id`,
      { usuario_id: id },
    );
    const [result] = await connection.query(`DELETE FROM \`${TABLE}\` WHERE id = :id`, { id });
    await connection.commit();
    return result.affectedRows > 0;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { list, getById, createOne, updateOne, removeOne };
