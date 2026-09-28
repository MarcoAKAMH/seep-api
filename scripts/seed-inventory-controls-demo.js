const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local'), override: true });
const { pool } = require('../src/config/db');

async function seed() {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [branches] = await db.query("SELECT id,nombre FROM cat_sucursal WHERE LOWER(nombre) LIKE '%chapala%' LIMIT 1 FOR UPDATE");
    if (!branches.length) throw new Error('No se encontró la sucursal Chapala.');
    const [admins] = await db.query('SELECT u.id FROM usuario u JOIN usuario_rol ur ON ur.usuario_id=u.id WHERE ur.rol_id=1 AND u.activo=1 ORDER BY u.id LIMIT 1');
    if (!admins.length) throw new Error('No existe un administrador global activo para auditar el alta.');
    const branch = branches[0];
    let [warehouses] = await db.query("SELECT * FROM inv_almacen WHERE sucursal_id=? AND nombre='Almacén de prueba' FOR UPDATE", [branch.id]);
    if (!warehouses.length) {
      const [created] = await db.query("INSERT INTO inv_almacen(sucursal_id,nombre) VALUES (?,'Almacén de prueba')", [branch.id]);
      warehouses = [{ id: created.insertId, sucursal_id: branch.id, nombre: 'Almacén de prueba', activo: 1 }];
      await db.query("INSERT INTO inv_auditoria(sucursal_id,usuario_id,accion,entidad,entidad_id,despues) VALUES (?,?,'CREAR','inv_almacen',?,?)",
        [branch.id, admins[0].id, created.insertId, JSON.stringify(warehouses[0])]);
    }
    const warehouse = warehouses[0];
    let [locations] = await db.query("SELECT * FROM inv_ubicacion WHERE almacen_id=? AND codigo='PRUEBA-01' FOR UPDATE", [warehouse.id]);
    if (!locations.length) {
      const location = { almacen_id: warehouse.id, sucursal_id: branch.id, codigo: 'PRUEBA-01', descripcion: 'Recepción de transferencias de prueba', activo: 1 };
      const [created] = await db.query('INSERT INTO inv_ubicacion(almacen_id,sucursal_id,codigo,descripcion) VALUES (?,?,?,?)',
        [location.almacen_id, location.sucursal_id, location.codigo, location.descripcion]);
      locations = [{ id: created.insertId, ...location }];
      await db.query("INSERT INTO inv_auditoria(sucursal_id,usuario_id,accion,entidad,entidad_id,despues) VALUES (?,?,'CREAR','inv_ubicacion',?,?)",
        [branch.id, admins[0].id, created.insertId, JSON.stringify(locations[0])]);
    }
    await db.commit();
    return { sucursal: branch.nombre, almacen: warehouses[0].nombre, ubicacion: locations[0].codigo };
  } catch (error) { await db.rollback(); throw error; } finally { db.release(); }
}

seed().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
