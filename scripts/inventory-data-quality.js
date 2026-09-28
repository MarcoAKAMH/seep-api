const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local'), override: true });
const { pool } = require('../src/config/db');

async function inventoryDataQuality() {
  const [[products], [branches], [warehouses]] = await Promise.all([
    pool.query(`SELECT COUNT(*) productos,
      COALESCE(SUM(foto_url IS NULL OR TRIM(foto_url)=''),0) sin_foto,COALESCE(SUM(nombre_tecnico IS NULL OR TRIM(nombre_tecnico)=''),0) sin_nombre_tecnico
      FROM inv_producto WHERE activo=1`),
    pool.query(`SELECT s.id,s.nombre,
      (SELECT COUNT(DISTINCT e.producto_id) FROM inv_existencia e WHERE e.sucursal_id=s.id) productos_con_existencia,
      (SELECT COUNT(DISTINCT pa.producto_id) FROM inv_producto_almacen pa WHERE pa.sucursal_id=s.id) productos_con_limites,
      (SELECT COUNT(DISTINCT pa.producto_id) FROM inv_producto_almacen pa WHERE pa.sucursal_id=s.id AND (pa.maximo>0 OR pa.minimo>0 OR pa.punto_reorden>0)) limites_configurados,
      (SELECT COUNT(DISTINCT pp.producto_id) FROM inv_producto_proveedor pp WHERE pp.sucursal_id=s.id AND pp.preferido=1) proveedor_preferido,
      (SELECT COUNT(DISTINCT e.ubicacion_id) FROM inv_existencia e WHERE e.sucursal_id=s.id) ubicaciones_usadas,
      (SELECT COALESCE(SUM(e.cantidad),0) FROM inv_existencia e WHERE e.sucursal_id=s.id) unidades
      FROM cat_sucursal s ORDER BY s.nombre`),
    pool.query(`SELECT s.nombre sucursal,a.nombre almacen,COUNT(DISTINCT u.id) ubicaciones,COUNT(DISTINCT e.producto_id) productos,
      COALESCE(SUM(e.cantidad),0) unidades FROM inv_almacen a JOIN cat_sucursal s ON s.id=a.sucursal_id
      LEFT JOIN inv_ubicacion u ON u.almacen_id=a.id LEFT JOIN inv_existencia e ON e.almacen_id=a.id WHERE a.activo=1 GROUP BY a.id,s.nombre,a.nombre ORDER BY s.nombre,a.nombre`),
  ]);
  return { generated_at: new Date().toISOString(), products, branches, warehouses };
}

if (require.main === module) inventoryDataQuality().then(result => console.log(JSON.stringify(result, null, 2)))
  .catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
module.exports = { inventoryDataQuality };
