const { ROLE_IDS, BRANCH_ADMIN_AGENT_ROLES } = require('../config/roles');

const uniqueIds = (values) => [...new Set(values.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];

function branchRoleIds(roleIds) {
  return roleIds.filter((id) => Object.hasOwn(BRANCH_ADMIN_AGENT_ROLES, id));
}

function branchScope(roleIds, sucursales, mappings) {
  const admins = branchRoleIds(roleIds);
  if (admins.length !== 1) return null;
  const adminId = admins[0];
  const agentId = BRANCH_ADMIN_AGENT_ROLES[adminId];
  if (roleIds.some((id) => id !== adminId && id !== agentId)) return null;
  const existing = new Set(sucursales.map((row) => Number(row.id)));
  const mappedIds = (roleId) => uniqueIds(mappings.filter((row) => Number(row.rol_id) === roleId).map((row) => row.sucursal_id));
  const adminSucursales = mappedIds(adminId);
  const agentSucursales = mappedIds(agentId);
  if (adminSucursales.length !== 1 || agentSucursales.length !== 1) return null;
  const sucursalId = adminSucursales[0];
  if (sucursalId !== agentSucursales[0] || !existing.has(sucursalId)) return null;
  return { sucursalId, roleIds: [agentId, adminId] };
}

function buildAccessProfile(roles, sucursales, mappings) {
  const roleIds = uniqueIds(roles.map((role) => role.id));
  const hasGlobal = roleIds.includes(ROLE_IDS.ADMINISTRADOR);
  const hasBranchAdmin = branchRoleIds(roleIds).length > 0;
  const isAdmin = hasGlobal && roleIds.length === 1;
  const scope = !hasGlobal && hasBranchAdmin ? branchScope(roleIds, sucursales, mappings) : null;
  const existing = uniqueIds(sucursales.map((row) => row.id));
  let allowed = [];
  if (isAdmin) allowed = existing;
  else if (scope) allowed = [scope.sucursalId];
  else if (!hasGlobal && !hasBranchAdmin) {
    allowed = uniqueIds(mappings.filter((row) => roleIds.includes(Number(row.rol_id))).map((row) => row.sucursal_id))
      .filter((id) => existing.includes(id));
  }
  return {
    roles,
    is_admin: isAdmin,
    is_branch_admin: Boolean(scope),
    can_view_reports: isAdmin || Boolean(scope),
    can_manage_users: isAdmin || Boolean(scope),
    can_manage_inventory: isAdmin || Boolean(scope),
    can_manage_inventory_catalog: isAdmin,
    can_authorize_inventory_adjustments: isAdmin,
    allowed_sucursal_ids: allowed,
    can_view_all_orders: isAdmin || (!hasGlobal && !hasBranchAdmin && existing.length > 0 && allowed.length === existing.length),
  };
}

function getAssignableRoleIds(user) {
  if (!user?.is_branch_admin || !user?.can_manage_users || user.allowed_sucursal_ids?.length !== 1) return [];
  const admins = branchRoleIds(uniqueIds((user.roles || []).map((role) => role.id)));
  if (admins.length !== 1) return [];
  return [BRANCH_ADMIN_AGENT_ROLES[admins[0]], admins[0]];
}

function canManageRoleIds(user, targetRoleIds) {
  if (user?.is_admin) return true;
  const allowed = getAssignableRoleIds(user);
  return targetRoleIds.length > 0 && allowed.length > 0 && targetRoleIds.every((id) => allowed.includes(Number(id)));
}

function validateRoleCombination(roleIds, roles, sucursales, mappings, { allowEmpty = false } = {}) {
  const ids = uniqueIds(roleIds || []);
  const reject = (message) => { throw Object.assign(new Error(message), { status: 400 }); };
  if (ids.length === 0) {
    if (allowEmpty) return ids;
    reject('Selecciona al menos un rol.');
  }
  if (ids.some((id) => !roles.some((role) => Number(role.id) === id))) reject('Uno o más roles seleccionados no existen.');
  if (ids.includes(ROLE_IDS.ADMINISTRADOR) && ids.length !== 1) reject('El administrador global no se puede combinar con otros roles.');
  if (branchRoleIds(ids).length && !branchScope(ids, sucursales, mappings)) {
    reject('El administrador de sucursal solo puede tener roles de su misma sucursal y requiere una sucursal válida.');
  }
  return ids;
}

async function loadRoleCatalog(connection) {
  const [roles] = await connection.query('SELECT id, nombre, descripcion FROM rol ORDER BY id ASC');
  const [sucursales] = await connection.query('SELECT id, nombre FROM cat_sucursal ORDER BY id ASC');
  const [mappings] = await connection.query('SELECT rol_id, sucursal_id FROM rol_sucursal');
  return { roles, sucursales, mappings };
}

async function normalizeRoleIds(connection, roleIds, user, options) {
  const catalog = await loadRoleCatalog(connection);
  const ids = validateRoleCombination(roleIds, catalog.roles, catalog.sucursales, catalog.mappings, options);
  if (!canManageRoleIds(user, ids)) {
    throw Object.assign(new Error('No tienes permisos para asignar estos roles.'), { status: 403 });
  }
  return ids;
}

function buildUserScopeSql(user) {
  if (user?.is_admin) return { sql: '1 = 1', params: {} };
  const roles = getAssignableRoleIds(user);
  if (!roles.length) return { sql: '1 = 0', params: {} };
  const params = Object.fromEntries(roles.map((id, index) => [`manager_role_${index}`, id]));
  const placeholders = Object.keys(params).map((key) => `:${key}`).join(', ');
  return {
    sql: `EXISTS (SELECT 1 FROM usuario_rol access_role WHERE access_role.usuario_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM usuario_rol access_role WHERE access_role.usuario_id = u.id AND access_role.rol_id NOT IN (${placeholders}))`,
    params,
  };
}

module.exports = { buildAccessProfile, getAssignableRoleIds, canManageRoleIds, validateRoleCombination, loadRoleCatalog, normalizeRoleIds, buildUserScopeSql };
