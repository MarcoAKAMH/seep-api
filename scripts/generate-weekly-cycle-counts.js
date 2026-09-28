const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local'), override: true });
const { pool } = require('../src/config/db');
const { createCycle } = require('../src/services/inventoryCycleCounts');

function monday() {
  const date = new Date();
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function generateWeeklyCycleCounts({ apply = false } = {}) {
  const week = monday();
  const zone = String(process.env.INVENTORY_WEEKLY_COUNT_ZONE || 'TODAS').trim().toUpperCase();
  const size = Math.max(1, Math.min(100, Number(process.env.INVENTORY_WEEKLY_COUNT_SIZE || 10)));
  const [admins] = await pool.query('SELECT u.id FROM usuario u JOIN usuario_rol ur ON ur.usuario_id=u.id WHERE ur.rol_id=1 AND u.activo=1 ORDER BY u.id LIMIT 1');
  if (!admins.length) throw new Error('No existe un administrador global activo para registrar la programación.');
  const [warehouses] = await pool.query(`SELECT a.id almacen_id,a.sucursal_id,a.nombre almacen_nombre,s.nombre sucursal_nombre,COUNT(e.producto_id) candidatos
    FROM inv_almacen a JOIN cat_sucursal s ON s.id=a.sucursal_id JOIN inv_existencia e ON e.almacen_id=a.id AND e.sucursal_id=a.sucursal_id
    JOIN inv_ubicacion u ON u.id=e.ubicacion_id AND u.activo=1 JOIN inv_producto p ON p.id=e.producto_id AND p.activo=1
    WHERE a.activo=1 AND (?='TODAS' OR u.codigo LIKE CONCAT(?,'%'))
    GROUP BY a.id,a.sucursal_id,a.nombre,s.nombre ORDER BY s.nombre,a.nombre`, [zone, zone]);
  const results = [];
  for (const warehouse of warehouses) {
    const [existing] = await pool.query('SELECT id,folio,estado FROM inv_conteo_ciclico WHERE almacen_id=? AND semana=? AND zona=?', [warehouse.almacen_id, week, zone]);
    if (existing.length) { results.push({ sucursal: warehouse.sucursal_nombre, almacen: warehouse.almacen_nombre, status: 'existing', folio: existing[0].folio }); continue; }
    if (!apply) { results.push({ sucursal: warehouse.sucursal_nombre, almacen: warehouse.almacen_nombre, status: 'pending', partidas: Math.min(size, Number(warehouse.candidatos)) }); continue; }
    const created = await createCycle({ sucursal_id: Number(warehouse.sucursal_id), almacen_id: Number(warehouse.almacen_id), semana: week, zona: zone, cantidad_productos: size }, Number(admins[0].id));
    results.push({ sucursal: warehouse.sucursal_nombre, almacen: warehouse.almacen_nombre, status: 'created', ...created });
  }
  return { week, zone, size, apply, warehouses: results.length, results };
}

if (require.main === module) generateWeeklyCycleCounts({ apply: process.argv.includes('--apply') })
  .then(result => console.log(JSON.stringify(result, null, 2)))
  .catch(error => { console.error(error.message); process.exitCode = 1; })
  .finally(() => pool.end());

module.exports = { generateWeeklyCycleCounts, monday };
