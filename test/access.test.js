const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAccessProfile, validateRoleCombination, canManageRoleIds, buildUserScopeSql } = require('../src/utils/userAccess');
const { getOrderScope, resolveSucursalScope, buildOrderScopeSql } = require('../src/utils/sucursalAccess');

const roles = [1, 2, 3, 4, 5].map((id) => ({ id, nombre: String(id) }));
const branches = [{ id: 11 }, { id: 22 }];
const mappings = [{ rol_id: 2, sucursal_id: 11 }, { rol_id: 3, sucursal_id: 22 }, { rol_id: 4, sucursal_id: 11 }, { rol_id: 5, sucursal_id: 22 }];
const profile = (...ids) => buildAccessProfile(roles.filter((role) => ids.includes(role.id)), branches, mappings);

test('global, branch admins and multi-branch agents have separate capabilities', () => {
  assert.equal(profile(1).is_admin, true);
  assert.deepEqual(getOrderScope(profile(1)), null);
  for (const [admin, agent, branch] of [[4, 2, 11], [5, 3, 22]]) {
    assert.equal(profile(admin).is_admin, false);
    assert.equal(profile(admin).can_view_reports, true);
    assert.equal(profile(admin).can_manage_users, true);
    assert.deepEqual(getOrderScope(profile(admin)), [branch]);
    assert.deepEqual(getOrderScope({ ...profile(admin), can_view_all_orders: true }), [branch]);
    assert.equal(profile(agent).can_view_reports, false);
    assert.equal(profile(agent).can_manage_users, false);
  }
  assert.equal(profile(2, 3).can_view_all_orders, true);
  assert.equal(profile(2, 3).can_view_reports, false);
});

test('invalid branch combinations and missing mappings fail closed', () => {
  for (const ids of [[4, 3], [4, 5], [1, 4], [1, 2]]) {
    assert.throws(() => validateRoleCombination(ids, roles, branches, mappings), { status: 400 });
    const user = profile(...ids);
    assert.deepEqual(user.allowed_sucursal_ids, []);
    assert.equal(user.can_view_reports, false);
    assert.equal(user.can_manage_users, false);
  }
  assert.deepEqual(validateRoleCombination([4, 2], roles, branches, mappings), [4, 2]);
  assert.equal(buildAccessProfile([roles[3]], branches, mappings.slice(0, 2)).can_manage_users, false);
  assert.throws(() => getOrderScope({ is_branch_admin: true, allowed_sucursal_ids: [] }), { status: 403 });
});

test('branch user management checks every role of the target', () => {
  const local = profile(4);
  for (const ids of [[2], [4], [2, 4]]) assert.equal(canManageRoleIds(local, ids), true);
  for (const ids of [[], [1], [3], [5], [2, 3], [4, 5]]) assert.equal(canManageRoleIds(local, ids), false);
  assert.equal(canManageRoleIds(profile(1), [5]), true);
  const scope = buildUserScopeSql(local);
  assert.match(scope.sql, /NOT EXISTS/);
  assert.deepEqual(Object.values(scope.params), [2, 4]);
});

test('report scope defaults securely and rejects other or invalid branches', async () => {
  const db = { query: async (sql, params) => [[...(params.scope_selected_sucursal === 11 ? [{ id: 11 }] : [])]] };
  assert.deepEqual(await resolveSucursalScope(profile(1), undefined, db), { sucursalId: null, sucursalIds: null });
  assert.deepEqual(await resolveSucursalScope(profile(4), undefined, db), { sucursalId: 11, sucursalIds: [11] });
  assert.deepEqual(await resolveSucursalScope(profile(1), 11, db), { sucursalId: 11, sucursalIds: [11] });
  await assert.rejects(resolveSucursalScope(profile(4), 22, db), { status: 403 });
  for (const id of [null, '', 0, -1, 'all', '11 OR 1=1', 1.5, 99]) {
    await assert.rejects(resolveSucursalScope(profile(1), id, db), { status: 400 });
  }
  assert.equal(buildOrderScopeSql([]).sql, '1 = 0');
  assert.match(buildOrderScopeSql([11]).sql, /EXISTS/);
});
