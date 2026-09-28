// Inventory is independent of order permissions, including multi-branch agents.
function inventoryScope(user) {
  if (!user?.can_manage_inventory) throw Object.assign(new Error('No tienes acceso al inventario.'), { status: 403 });
  if (user.is_admin) return null;
  const ids = user.allowed_sucursal_ids;
  if (!user.is_branch_admin || !Array.isArray(ids) || ids.length !== 1
      || !Number.isSafeInteger(ids[0]) || ids[0] <= 0) {
    throw Object.assign(new Error('El inventario requiere una sucursal válida.'), { status: 403 });
  }
  return [...ids];
}

async function resolveInventoryScope(user, requestedId, db) {
  const allowed = inventoryScope(user);
  if (requestedId === undefined) return { sucursalId: allowed?.[0] ?? null, sucursalIds: allowed };
  if (!['string', 'number'].includes(typeof requestedId) || !/^[1-9]\d*$/.test(String(requestedId))
      || !Number.isSafeInteger(Number(requestedId))) {
    throw Object.assign(new Error('Selecciona una sucursal válida.'), { status: 400 });
  }
  const id = Number(requestedId);
  if (allowed && !allowed.includes(id)) throw Object.assign(new Error('No tienes acceso al inventario de esta sucursal.'), { status: 403 });
  const [rows] = await db.query('SELECT id FROM cat_sucursal WHERE id = :id', { id });
  if (!rows.length) throw Object.assign(new Error('La sucursal no existe.'), { status: 400 });
  return { sucursalId: id, sucursalIds: [id] };
}

function inventoryScopeSql(ids) {
  // All inventory branch queries use the fixed alias i; never accept client SQL identifiers.
  if (ids === null) return { sql: '1 = 1', params: {} };
  if (!Array.isArray(ids) || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new TypeError('Alcance inválido.');
  if (!ids.length) return { sql: '1 = 0', params: {} };
  const params = Object.fromEntries(ids.map((id, n) => [`inv_branch_${n}`, id]));
  return { sql: `i.sucursal_id IN (${Object.keys(params).map(key => `:${key}`).join(', ')})`, params };
}

function inventoryOnly(req, res, next) {
  try { inventoryScope(req.user); next(); } catch (error) { next(error); }
}

module.exports = { inventoryScope, resolveInventoryScope, inventoryScopeSql, inventoryOnly };
