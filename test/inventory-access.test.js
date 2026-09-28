const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAccessProfile } = require('../src/utils/userAccess');
const { inventoryScope, resolveInventoryScope, inventoryScopeSql, inventoryOnly } = require('../src/utils/inventoryAccess');
const branches = [{ id: 11 }, { id: 22 }];
const mappings = [{ rol_id: 2, sucursal_id: 11 }, { rol_id: 3, sucursal_id: 22 }, { rol_id: 4, sucursal_id: 11 }, { rol_id: 5, sucursal_id: 22 }];
const profile = (...ids) => buildAccessProfile(ids.map(id => ({ id })), branches, mappings);

test('inventory excludes agents, mixed roles and invalid branch mappings', () => {
  for (const ids of [[], [2], [3], [2,3], [1,4], [4,5], [4,3]]) {
    const user = profile(...ids);
    assert.equal(user.can_manage_inventory, false);
    assert.throws(() => inventoryScope(user), { status: 403 });
  }
  assert.throws(() => inventoryScope({ ...profile(4), allowed_sucursal_ids: [11, 22] }), { status: 403 });
  assert.throws(() => inventoryScope(buildAccessProfile([{ id: 4 }], branches, [])), { status: 403 });
});

test('only the global administrator can manage inventory', () => {
  assert.equal(inventoryScope(profile(1)), null);
  assert.equal(profile(1).can_manage_inventory_catalog, true);
  assert.equal(profile(1).can_authorize_inventory_adjustments, true);
  for (const role of [4, 5]) {
    assert.equal(profile(role).can_manage_inventory, false);
    assert.throws(() => inventoryScope(profile(role)), { status: 403 });
    assert.equal(profile(role).can_manage_inventory_catalog, false);
    assert.equal(profile(role).can_authorize_inventory_adjustments, false);
  }
});

test('scope validates explicit branch selections before database access', async () => {
  let calls = 0;
  const db = { query: async (sql, { id }) => { calls++; return [branches.filter(b => b.id === id)]; } };
  await assert.rejects(resolveInventoryScope(profile(4), undefined, db), { status: 403 });
  await assert.rejects(resolveInventoryScope(profile(4), 22, db), { status: 403 });
  for (const id of [null, '', true, [], [11], {}, 'all', '11 OR 1=1', 1.5, 0, -1, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(resolveInventoryScope(profile(1), id, db), { status: 400 });
  }
  assert.equal(calls, 0);
  assert.deepEqual(await resolveInventoryScope(profile(1), '22', db), { sucursalId: 22, sucursalIds: [22] });
  await assert.rejects(resolveInventoryScope(profile(1), 99, db), { status: 400 });
  assert.deepEqual(inventoryScopeSql([11]), { sql: 'i.sucursal_id IN (:inv_branch_0)', params: { inv_branch_0: 11 } });
  assert.equal(inventoryScopeSql([]).sql, '1 = 0');
  assert.equal(inventoryScopeSql(null).sql, '1 = 1');
  assert.throws(() => inventoryScopeSql(['11 OR 1=1']));
});

test('middleware denies agents even with all-order access', () => {
  let error;
  inventoryOnly({ user: profile(2, 3) }, {}, e => { error = e; });
  assert.equal(error.status, 403);
  inventoryOnly({ user: profile(4) }, {}, e => { error = e; });
  assert.equal(error.status, 403);
  error = undefined;
  inventoryOnly({ user: profile(1) }, {}, e => { error = e; });
  assert.equal(error, undefined);
});
