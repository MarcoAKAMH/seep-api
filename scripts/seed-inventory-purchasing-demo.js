const path=require('node:path');
require('dotenv').config({path:path.resolve(__dirname,'../.env')});
require('dotenv').config({path:path.resolve(__dirname,'../.env.local'),override:true});
const {pool}=require('../src/config/db');

async function seed(){const db=await pool.getConnection();try{await db.beginTransaction();const [admins]=await db.query('SELECT u.id FROM usuario u JOIN usuario_rol ur ON ur.usuario_id=u.id WHERE ur.rol_id=1 AND u.activo=1 ORDER BY u.id LIMIT 1');if(!admins.length)throw new Error('No existe un administrador global activo.');
  const [branches]=await db.query('SELECT id,nombre FROM cat_sucursal ORDER BY id');if(!branches.length)throw new Error('No existen sucursales.');
  let [providers]=await db.query("SELECT * FROM inv_proveedor WHERE rfc='DEMO-SEEP-2026' FOR UPDATE");if(!providers.length){const [created]=await db.query(`INSERT INTO inv_proveedor(razon_social,nombre_comercial,rfc,contacto,telefono,email,condiciones_pago,dias_entrega,calificacion,notas,creado_por) VALUES ('Proveedor de prueba SEEP','Proveedor de prueba SEEP','DEMO-SEEP-2026','Contacto de prueba','3300000000','prueba@seep.local','Contado',2,5,'Registro de demostración; no representa un proveedor real.',?)`,[admins[0].id]);providers=[{id:created.insertId,nombre_comercial:'Proveedor de prueba SEEP'}];await db.query(`INSERT INTO inv_auditoria(usuario_id,accion,entidad,entidad_id,despues) VALUES (?,'CREAR','inv_proveedor',?,?)`,[admins[0].id,created.insertId,JSON.stringify(providers[0])]);}
  await db.query('INSERT IGNORE INTO inv_proveedor_sucursal(proveedor_id,sucursal_id) VALUES ?',[branches.map(branch=>[providers[0].id,branch.id])]);await db.commit();return{proveedor:providers[0].nombre_comercial,sucursales:branches.map(branch=>branch.nombre)};
}catch(error){await db.rollback();throw error;}finally{db.release();}}
seed().then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>pool.end());
