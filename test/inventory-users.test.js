const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAccessProfile, validateRoleCombination, canManageRoleIds } = require('../src/utils/userAccess');
const { inventoryScope, resolveInventoryScope } = require('../src/utils/inventoryAccess');
const { getOrderScope } = require('../src/utils/sucursalAccess');
const isolate = require('../src/middleware/inventoryIsolation');
const roles = Array.from({ length: 8 }, (_, i) => ({ id: i + 1 }));
const branches = [{ id: 11 }, { id: 22 }];
const mappings = [{ rol_id: 7, sucursal_id: 11 }, { rol_id: 8, sucursal_id: 22 }, { rol_id: 4, sucursal_id: 11 }, { rol_id: 2, sucursal_id: 11 }];
const profile = (...ids) => buildAccessProfile(ids.map(id => ({ id })), branches, mappings);

test('inventory users cannot reach workshop modules or authorize adjustments', () => {
  for (const id of [6, 7, 8]) {
    const user = profile(id);
    assert.equal(user.is_inventory_only, true);
    assert.equal(user.can_manage_inventory, true);
    for (const flag of ['is_admin', 'can_manage_users', 'can_view_reports', 'can_view_all_orders', 'can_authorize_inventory_adjustments']) assert.equal(user[flag], false);
    assert.throws(() => getOrderScope(user), { status: 403 });
    let status;
    isolate({ user }, { status(code) { status = code; return this; }, json() {} }, () => assert.fail('Access leaked'));
    assert.equal(status, 403);
    assert.equal(canManageRoleIds(profile(4), [id]), false);
    assert.equal(canManageRoleIds(profile(1), [id]), true);
  }
});

test('inventory branch scope rejects another branch and shared catalog writes', async () => {
  assert.equal(inventoryScope(profile(6)), null);
  assert.deepEqual(inventoryScope(profile(7)), [11]);
  assert.deepEqual(inventoryScope(profile(8)), [22]);
  assert.equal(profile(6).can_manage_inventory_catalog, false);
  assert.equal(profile(7).can_manage_inventory_catalog, false);
  await assert.rejects(resolveInventoryScope(profile(7), 22, { query() { assert.fail('Query outside scope'); } }), { status: 403 });
});

test('mixed inventory roles fail closed even for existing invalid assignments', () => {
  for (const ids of [[6,1], [6,2], [7,4], [7,8], [7,6]]) {
    assert.throws(() => validateRoleCombination(ids, roles, branches, mappings), { status: 400 });
    assert.equal(profile(...ids).can_manage_inventory, false);
    assert.equal(profile(...ids).is_inventory_only, true);
    assert.equal(profile(...ids).can_manage_users, false);
  }
  assert.equal(buildAccessProfile([{ id: 7 }], branches, []).can_manage_inventory, false);
  assert.equal(buildAccessProfile([{ id: 7 }], branches, [...mappings, { rol_id: 7, sucursal_id: 999 }]).can_manage_inventory, false);
  assert.deepEqual(validateRoleCombination([7], roles, branches, mappings), [7]);
});

test('role migration previews, repeats safely and refuses occupied IDs', async () => {
  const { migrateInventoryUsers } = require('../scripts/migrate-inventory-users');
  const storedRoles = [{ id: 1, nombre: 'Administrador' }, { id: 2, nombre: 'Agente Alameda' }, { id: 3, nombre: 'Agente Chapala' }];
  const links = [{ rol_id: 2, sucursal_id: 11 }, { rol_id: 3, sucursal_id: 22 }];
  let inserts = 0;
  const db = {
    async beginTransaction() {}, async commit() {}, async rollback() {},
    async query(sql, args) {
      if (sql.startsWith('SELECT id,nombre FROM rol ')) return [storedRoles];
      if (sql.includes('FROM cat_sucursal')) return [[{ id: 11, nombre: 'Alameda' }, { id: 22, nombre: 'Chapala' }]];
      if (sql.includes('FROM rol_sucursal')) return [links];
      if (sql.startsWith('INSERT INTO rol(')) { storedRoles.push({ id: args[0], nombre: args[1] }); inserts++; return [{}]; }
      if (sql.startsWith('INSERT INTO rol_sucursal')) { links.push({ rol_id: args[0], sucursal_id: args[1] }); inserts++; return [{}]; }
      throw Error(sql);
    },
  };
  await migrateInventoryUsers(db, false);
  assert.equal(inserts, 0);
  await migrateInventoryUsers(db, true);
  assert.equal(inserts, 5);
  await migrateInventoryUsers(db, true);
  assert.equal(inserts, 5);
  storedRoles.find(role => role.id === 6).nombre = 'Otro rol existente';
  await assert.rejects(migrateInventoryUsers(db, true), /Conflicto de rol/);
  assert.equal(inserts, 5);
});
