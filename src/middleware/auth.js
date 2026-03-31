const { pool } = require('../config/db');
const { verifyToken } = require('../config/jwt');

const ADMIN_ROLE_NAME = 'admin';

function normalizeRoleName(value) {
  return String(value || '').trim().toLowerCase();
}

async function loadUserAccessProfile(userId) {
  const [roleRows] = await pool.query(
    `SELECT r.\`id\`, r.\`nombre\`, r.\`descripcion\`
       FROM usuario_rol ur
       INNER JOIN rol r ON r.\`id\` = ur.\`rol_id\`
      WHERE ur.\`usuario_id\` = :usuario_id`,
    { usuario_id: userId },
  );

  const roles = roleRows.map((row) => ({
    id: Number(row.id),
    nombre: row.nombre,
    descripcion: row.descripcion ?? null,
  }));

  const [sucursalRows] = await pool.query(
    'SELECT id, nombre FROM cat_sucursal ORDER BY id ASC',
  );

  const sucursales = sucursalRows.map((row) => ({
    id: Number(row.id),
    nombre: row.nombre,
  }));

  const normalizedRoleNames = roles.map((role) => normalizeRoleName(role.nombre));
  const isAdmin = normalizedRoleNames.includes(ADMIN_ROLE_NAME);
  let allowedSucursalIds = [];

  if (isAdmin) {
    allowedSucursalIds = sucursales.map((sucursal) => sucursal.id);
  } else if (roles.length > 0) {
    const roleIds = roles.map((role) => role.id);
    const [rolSucursalRows] = await pool.query(
      `SELECT DISTINCT rs.\`sucursal_id\`
         FROM \`rol_sucursal\` rs
        WHERE rs.\`rol_id\` IN (?)`,
      [roleIds],
    );
    allowedSucursalIds = rolSucursalRows.map((row) => Number(row.sucursal_id)).filter(Boolean);
  }

  const canViewAllOrders = isAdmin || (sucursales.length > 0 && allowedSucursalIds.length === sucursales.length);

  return {
    roles,
    is_admin: isAdmin,
    allowed_sucursal_ids: allowedSucursalIds,
    can_view_all_orders: canViewAllOrders,
  };
}

async function required(req, res, next) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ message: 'Falta el token Bearer.' });

  try {
    const payload = verifyToken(match[1]);
    const accessProfile = await loadUserAccessProfile(Number(payload.sub));
    req.user = { ...payload, ...accessProfile };
    return next();
  } catch (err) {
    return res.status(401).json({ message: 'El token es inválido o ya expiró.' });
  }
}

function adminOnly(req, res, next) {
  if (!req.user?.is_admin) {
    return res.status(403).json({ message: 'No tienes permisos para acceder a este recurso.' });
  }
  return next();
}

module.exports = { required, adminOnly, loadUserAccessProfile, normalizeRoleName };
