const { pool } = require('../config/db');
const { verifyToken } = require('../config/jwt');
const { buildAccessProfile, loadRoleCatalog } = require('../utils/userAccess');

async function loadUserAccessProfile(userId) {
  const [users] = await pool.query('SELECT id, activo FROM usuario WHERE id = :id LIMIT 1', { id: userId });
  if (!users.length || Number(users[0].activo) !== 1) {
    throw Object.assign(new Error('El usuario no existe o está desactivado.'), { status: 401 });
  }
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

  const { sucursales, mappings } = await loadRoleCatalog(pool);
  return buildAccessProfile(roles, sucursales, mappings);
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

function requireCapability(capability) {
  return (req, res, next) => {
    if (!req.user?.[capability]) {
      return res.status(403).json({ message: 'No tienes permisos para acceder a este recurso.' });
    }
    return next();
  };
}

const adminOnly = requireCapability('is_admin');
const reportsOnly = requireCapability('can_view_reports');
const userManagersOnly = requireCapability('can_manage_users');

module.exports = { required, adminOnly, reportsOnly, userManagersOnly, loadUserAccessProfile };
