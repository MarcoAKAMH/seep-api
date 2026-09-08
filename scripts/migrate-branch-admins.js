// Run from seep-api: node scripts/migrate-branch-admins.js --check | --apply
const { ROLE_IDS, BRANCH_ADMIN_AGENT_ROLES } = require('../src/config/roles');

async function migrateBranchAdmins(db, apply = false) {
  await db.beginTransaction();
  try {
    const [roles] = await db.query('SELECT id, nombre FROM rol ORDER BY id FOR UPDATE');
    const [branches] = await db.query('SELECT id, nombre FROM cat_sucursal ORDER BY id');
    const [mappings] = await db.query('SELECT rol_id, sucursal_id FROM rol_sucursal');
    if (!roles.some((role) => Number(role.id) === ROLE_IDS.ADMINISTRADOR)) throw new Error('Falta el rol de administrador global.');
    const planned = [];
    for (const [adminIdText, agentId] of Object.entries(BRANCH_ADMIN_AGENT_ROLES)) {
      const adminId = Number(adminIdText);
      const agentMappings = mappings.filter((row) => Number(row.rol_id) === agentId);
      if (!roles.some((role) => Number(role.id) === agentId) || agentMappings.length !== 1) {
        throw new Error(`El rol agente ${agentId} debe existir y tener exactamente una sucursal.`);
      }
      const branch = branches.find((row) => Number(row.id) === Number(agentMappings[0].sucursal_id));
      if (!branch) throw new Error(`La sucursal del rol ${agentId} no existe.`);
      const name = `Administrador ${branch.nombre}`;
      if (name.length > 60) throw new Error('El nombre del rol excede 60 caracteres.');
      const existing = roles.find((role) => Number(role.id) === adminId);
      if (existing && existing.nombre !== name) throw new Error(`El ID ${adminId} ya pertenece a otro rol. No se realizaron cambios.`);
      if (roles.some((role) => role.nombre === name && Number(role.id) !== adminId)) throw new Error(`El rol ${name} ya existe con otro ID.`);
      if (mappings.some((row) => Number(row.rol_id) === adminId && Number(row.sucursal_id) !== Number(branch.id))) {
        throw new Error(`El rol ${adminId} ya tiene otra sucursal. No se realizaron cambios.`);
      }
      planned.push({ id: adminId, nombre: name, sucursal_id: Number(branch.id), exists: Boolean(existing) });
    }
    if (new Set(planned.map((row) => row.sucursal_id)).size !== planned.length) throw new Error('Los administradores deben corresponder a sucursales distintas.');
    if (apply) {
      for (const role of planned) {
        if (!role.exists) await db.query('INSERT INTO rol (id, nombre, descripcion) VALUES (?, ?, ?)',
          [role.id, role.nombre, 'Operación, reportes y administración de usuarios de su sucursal.']);
        if (!mappings.some((row) => Number(row.rol_id) === role.id && Number(row.sucursal_id) === role.sucursal_id)) {
          await db.query('INSERT INTO rol_sucursal (rol_id, sucursal_id) VALUES (?, ?)', [role.id, role.sucursal_id]);
        }
      }
      await db.commit();
    } else await db.rollback();
    return planned;
  } catch (error) {
    await db.rollback();
    throw error;
  }
}

if (require.main === module) {
  const path = require('path');
  const dotenv = require('dotenv');
  dotenv.config({ path: path.resolve(__dirname, '../.env') });
  dotenv.config({ path: path.resolve(__dirname, '../.env.local'), override: true });
  const { pool } = require('../src/config/db');
  (async () => {
    const db = await pool.getConnection();
    try {
      const apply = process.argv.includes('--apply');
      const roles = await migrateBranchAdmins(db, apply);
      console.log(JSON.stringify({ applied: apply, roles }, null, 2));
    } finally { db.release(); }
  })().catch((error) => {
    console.error(error.code ? `Error de base de datos: ${error.code}` : error.message);
    process.exitCode = 1;
  }).finally(() => pool.end());
}

module.exports = { migrateBranchAdmins };
