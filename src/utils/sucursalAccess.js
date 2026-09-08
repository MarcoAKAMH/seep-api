function accessError(message, status = 403) {
  return Object.assign(new Error(message), { status });
}

function getAllowedSucursalIds(user) {
  const ids = Array.isArray(user?.allowed_sucursal_ids) ? user.allowed_sucursal_ids : [];
  return [...new Set(ids.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
}

function canViewAllOrders(user) {
  return Boolean(user?.is_admin || (!user?.is_branch_admin && user?.can_view_all_orders));
}

// null means unrestricted; an empty array deliberately means no access.
function getOrderScope(user) {
  if (user?.is_admin) return null;
  const ids = getAllowedSucursalIds(user);
  if (user?.is_branch_admin) {
    if (ids.length !== 1) {
      throw accessError('El administrador de sucursal debe tener una sola sucursal asignada.');
    }
    return ids;
  }
  return canViewAllOrders(user) ? null : ids;
}

function assertSucursalAccess(user, sucursalId) {
  const scope = getOrderScope(user);
  if (scope !== null && !scope.includes(Number(sucursalId))) {
    throw accessError('No tienes permisos para operar órdenes de esta sucursal.');
  }
}

async function resolveSucursalScope(user, requestedId, db) {
  const allowed = getOrderScope(user);
  const hasSelection = requestedId !== undefined;
  if (!hasSelection) {
    return {
      sucursalId: allowed?.length === 1 ? allowed[0] : null,
      sucursalIds: allowed,
    };
  }

  const id = Number(requestedId);
  if (!Number.isSafeInteger(id) || id <= 0 || requestedId === null || requestedId === '') {
    throw accessError('Selecciona una sucursal válida.', 400);
  }
  assertSucursalAccess(user, id);
  const [rows] = await db.query(
    'SELECT id FROM cat_sucursal WHERE id = :scope_selected_sucursal LIMIT 1',
    { scope_selected_sucursal: id },
  );
  if (rows.length === 0) throw accessError('La sucursal seleccionada no existe.', 400);
  return { sucursalId: id, sucursalIds: [id] };
}

function buildOrderScopeSql(sucursalIds, orderIdExpression = 'ot.id', prefix = 'scope_sucursal') {
  if (sucursalIds === null) return { sql: '1 = 1', params: {} };
  if (!Array.isArray(sucursalIds)) throw new TypeError('Se requiere un alcance de sucursal válido.');
  if (sucursalIds.length === 0) return { sql: '1 = 0', params: {} };
  // Identifiers come from source code, never from a query string or request body.
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*$/.test(orderIdExpression)
    || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(prefix)) {
    throw new TypeError('Identificador SQL inválido.');
  }
  const params = {};
  const placeholders = sucursalIds.map((id, index) => {
    if (!Number.isSafeInteger(id) || id <= 0) throw new TypeError('Sucursal inválida.');
    const key = `${prefix}_${index}`;
    params[key] = id;
    return `:${key}`;
  });
  return {
    sql: `EXISTS (SELECT 1 FROM orden_sucursal scope_os WHERE scope_os.orden_id = ${orderIdExpression} AND scope_os.sucursal_id IN (${placeholders.join(', ')}))`,
    params,
  };
}

module.exports = {
  getAllowedSucursalIds,
  canViewAllOrders,
  getOrderScope,
  assertSucursalAccess,
  resolveSucursalScope,
  buildOrderScopeSql,
};
