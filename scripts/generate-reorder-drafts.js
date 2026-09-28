const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local'), override: true });
const { pool } = require('../src/config/db');
const { saveDraftOrder } = require('../src/services/inventoryPurchasing');

async function generateReorderDrafts({ apply = false } = {}) {
  const db = await pool.getConnection(); let locked = false;
  try {
    if (apply) { const [[lock]] = await db.query("SELECT GET_LOCK('seep_inventory_reorder_drafts',10) acquired"); if (Number(lock.acquired) !== 1) throw new Error('Otra generación de borradores está en curso.'); locked = true; }
    const [admins] = await db.query('SELECT u.id FROM usuario u JOIN usuario_rol ur ON ur.usuario_id=u.id WHERE ur.rol_id=1 AND u.activo=1 ORDER BY u.id LIMIT 1');
    if (!admins.length) throw new Error('No existe un administrador global activo.');
    const [rows] = await db.query(`SELECT pa.sucursal_id,pa.almacen_id,pa.producto_id,p.sku,p.nombre_comercial,pp.proveedor_id,pr.nombre_comercial proveedor_nombre,
      GREATEST(pa.maximo-COALESCE(SUM(e.cantidad),0),0) cantidad,COALESCE(pp.costo_referencia,c.costo_promedio,0) costo
      FROM inv_producto_almacen pa JOIN inv_producto p ON p.id=pa.producto_id AND p.activo=1
      JOIN inv_producto_proveedor pp ON pp.producto_id=pa.producto_id AND pp.sucursal_id=pa.sucursal_id AND pp.preferido=1
      JOIN inv_proveedor pr ON pr.id=pp.proveedor_id AND pr.activo=1 LEFT JOIN inv_existencia e ON e.producto_id=pa.producto_id AND e.almacen_id=pa.almacen_id AND e.sucursal_id=pa.sucursal_id
      LEFT JOIN inv_costo_sucursal c ON c.producto_id=pa.producto_id AND c.sucursal_id=pa.sucursal_id
      WHERE pa.punto_reorden>0 AND pa.maximo>0 AND NOT EXISTS (SELECT 1 FROM inv_orden_compra_detalle od JOIN inv_orden_compra o ON o.id=od.orden_compra_id
        WHERE od.producto_id=pa.producto_id AND o.almacen_id=pa.almacen_id AND o.sucursal_id=pa.sucursal_id AND o.estado IN ('BORRADOR','PENDIENTE_AUTORIZACION','AUTORIZADA','ENVIADA','PARCIAL'))
      GROUP BY pa.sucursal_id,pa.almacen_id,pa.producto_id,p.sku,p.nombre_comercial,pp.proveedor_id,pr.nombre_comercial,pa.punto_reorden,pa.maximo,pp.costo_referencia,c.costo_promedio
      HAVING COALESCE(SUM(e.cantidad),0)<=pa.punto_reorden AND cantidad>0 ORDER BY pa.sucursal_id,pa.almacen_id,pp.proveedor_id,p.nombre_comercial`);
    const groups = new Map();
    for (const row of rows) { const key = `${row.sucursal_id}:${row.almacen_id}:${row.proveedor_id}`; if (!groups.has(key)) groups.set(key, { sucursal_id:Number(row.sucursal_id), almacen_id:Number(row.almacen_id), proveedor_id:Number(row.proveedor_id), proveedor:row.proveedor_nombre, detalles:[] }); groups.get(key).detalles.push({ producto_id:Number(row.producto_id), sku:row.sku, cantidad:String(row.cantidad), costo_esperado:String(row.costo) }); }
    const orders = [];
    for (const group of groups.values()) {
      if (!apply) { orders.push({ ...group, status:'pending' }); continue; }
      const result = await saveDraftOrder({ sucursal_id:group.sucursal_id, almacen_id:group.almacen_id, proveedor_id:group.proveedor_id, fecha_estimada:null, condiciones_pago:null, notas:'Borrador automático por punto de reorden. Requiere revisión y autorización.', detalles:group.detalles.map(({producto_id,cantidad,costo_esperado})=>({producto_id,cantidad,costo_esperado})) }, Number(admins[0].id));
      orders.push({ proveedor:group.proveedor, partidas:group.detalles.length, status:'created', ...result });
    }
    return { apply, groups:orders.length, products:rows.length, orders };
  } finally { if (locked) await db.query("SELECT RELEASE_LOCK('seep_inventory_reorder_drafts')"); db.release(); }
}
if (require.main === module) generateReorderDrafts({ apply:process.argv.includes('--apply') }).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>pool.end());
module.exports={generateReorderDrafts};
