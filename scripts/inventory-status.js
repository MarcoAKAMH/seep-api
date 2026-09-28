const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local'), override: true });
const { pool } = require('../src/config/db');
(async () => {
  const [[status]] = await pool.query(`SELECT
    (SELECT COUNT(*) FROM inv_producto) productos,
    (SELECT COUNT(*) FROM inv_existencia) existencias,
    (SELECT COALESCE(SUM(cantidad),0) FROM inv_existencia) unidades,
    (SELECT COALESCE(SUM(e.cantidad*COALESCE(c.costo_promedio,0)),0) FROM inv_existencia e LEFT JOIN inv_costo_sucursal c ON c.producto_id=e.producto_id AND c.sucursal_id=e.sucursal_id) valor,
    (SELECT COUNT(*) FROM inv_conteo_ciclico) conteos,
    (SELECT COUNT(*) FROM inv_orden_compra) ordenes`);
  console.log(JSON.stringify(status, null, 2));
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
