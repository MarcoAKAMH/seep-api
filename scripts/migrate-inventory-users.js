// Preview by default; --apply creates roles without creating accounts or passwords.
const { ROLE_IDS, INVENTORY_BRANCH_AGENT_ROLES } = require('../src/config/roles');

async function migrateInventoryUsers(db, apply = false) {
  await db.beginTransaction();
  try {
    const [roles] = await db.query('SELECT id,nombre FROM rol FOR UPDATE');
    const [branches] = await db.query('SELECT id,nombre FROM cat_sucursal');
    const [mappings] = await db.query('SELECT rol_id,sucursal_id FROM rol_sucursal');
    const planned = [
      { id: ROLE_IDS.INVENTARIO_GLOBAL, nombre: 'Inventario - todas las sucursales', sucursal_id: null },
      { id: ROLE_IDS.INVENTARIO_ADMINISTRADOR, nombre: 'Inventario administrador', sucursal_id: null },
    ];
    for (const [id, agentId] of Object.entries(INVENTORY_BRANCH_AGENT_ROLES)) {
      const links = mappings.filter(row => Number(row.rol_id) === agentId);
      const branch = links.length === 1 && branches.find(row => Number(row.id) === Number(links[0].sucursal_id));
      if (!branch) throw new Error(`El rol agente ${agentId} debe tener una sucursal válida.`);
      planned.push({ id: Number(id), nombre: `Inventario - ${branch.nombre}`, sucursal_id: Number(branch.id) });
    }
    for (const role of planned) {
      if (role.nombre.length > 60 || roles.some(row => (Number(row.id) === role.id && row.nombre !== role.nombre) || (row.nombre === role.nombre && Number(row.id) !== role.id))) {
        throw new Error(`Conflicto de rol ${role.id}; no se realizaron cambios.`);
      }
      if (mappings.some(row => Number(row.rol_id) === role.id && Number(row.sucursal_id) !== role.sucursal_id)) throw new Error(`El rol ${role.id} tiene otra sucursal.`);
      if (apply) {
        if (!roles.some(row => Number(row.id) === role.id)) await db.query('INSERT INTO rol(id,nombre,descripcion) VALUES (?,?,?)',
          [role.id, role.nombre, role.id === ROLE_IDS.INVENTARIO_ADMINISTRADOR
            ? 'Administra todas las secciones de inventario en todas las sucursales. Acceso exclusivo a inventario.'
            : 'Solo consulta del catalogo, fotografias y precios publico y mayoreo. Sin movimientos ni administracion.']);
        if (role.sucursal_id && !mappings.some(row => Number(row.rol_id) === role.id)) await db.query('INSERT INTO rol_sucursal(rol_id,sucursal_id) VALUES (?,?)', [role.id, role.sucursal_id]);
      }
    }
    if (apply) await db.commit(); else await db.rollback();
    return planned;
  } catch (error) { await db.rollback(); throw error; }
}

if (require.main === module) {
  const path = require('path');
  require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
  require('dotenv').config({ path: path.resolve(__dirname, '../.env.local'), override: true });
  const { pool } = require('../src/config/db');
  (async () => {
    const db = await pool.getConnection();
    try { console.log(JSON.stringify({ applied: process.argv.includes('--apply'), roles: await migrateInventoryUsers(db, process.argv.includes('--apply')) }, null, 2)); }
    finally { db.release(); }
  })().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
}
module.exports = { migrateInventoryUsers };
