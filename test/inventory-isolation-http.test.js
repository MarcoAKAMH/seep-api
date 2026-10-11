const test = require('node:test');
const assert = require('node:assert/strict');

test('authenticated inventory accounts are denied on every non-inventory router', async () => {
  // No workshop database connections: only authentication metadata is simulated.
  const { pool } = require('../src/config/db');
  const originalQuery = pool.query;
  let roleId = 6;
  const roles = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, nombre: String(i + 1) }));
  pool.query = async (sql, params) => {
    if (sql.includes('FROM inv_existencia i')) {
      assert.ok(!sql.includes('costo') && !sql.includes('valor') && !sql.includes('i.*'));
      if (roleId !== 6) assert.ok(Object.values(params).includes(roleId === 7 ? 11 : 22));
      if (sql.startsWith('SELECT COUNT')) return [[{ total: 1 }]];
      return [[{ producto_id: 1, sucursal_id: roleId === 8 ? 22 : 11, cantidad: '1.5', unidad_id: 1 }]];
    }
    if (sql.includes('FROM usuario WHERE')) return [[{ id: 99, activo: 1 }]];
    if (sql.includes('INNER JOIN rol r')) return [[roles[roleId - 1]]];
    if (sql.includes('FROM rol ORDER BY')) return [roles];
    if (sql.includes('FROM cat_sucursal ORDER BY')) return [[{ id: 11 }, { id: 22 }]];
    if (sql.includes('FROM rol_sucursal')) return [[{ rol_id: 7, sucursal_id: 11 }, { rol_id: 8, sucursal_id: 22 }]];
    if (sql.includes('FROM inv_categoria')) return [[{ id: 1, nombre: 'Escape' }]];
    if (sql.includes('FROM inv_unidad')) return [[{ id: 1, nombre: 'Pieza' }]];
    if (sql.includes('FROM (SELECT id, nombre, id AS sucursal_id FROM cat_sucursal)')) return [[{ id: 11, nombre: 'Alameda' }]];
    if (sql.startsWith('SELECT COUNT(*) total FROM inv_producto')) return [[{ total: 1 }]];
    if (sql.includes('FROM inv_producto i')) {
      assert.ok(sql.startsWith('SELECT i.id,i.sku,i.nombre_comercial,i.nombre_tecnico,i.categoria_id,i.unidad_id,i.tipo,i.foto_url,i.precio_publico,i.precio_mayoreo,i.activo FROM'));
      return [[{ id: 1, sku: 'TEST', nombre_comercial: 'Tubo', precio_publico: '200', precio_mayoreo: '150' }]];
    }
    throw new Error('Unexpected data access: ' + sql);
  };
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api', require('../src/routes'));
  app.use((err, req, res, next) => res.status(err.status || 500).json({ message: err.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const { signAccessToken } = require('../src/config/jwt');
    const headers = { Authorization: `Bearer ${signAccessToken({ sub: '99' })}` };
    const base = `http://127.0.0.1:${server.address().port}/api`;
    for (roleId of [6, 7, 8]) {
      const access = await fetch(`${base}/inventario/acceso`, { headers });
      assert.equal(access.status, 200);
      assert.deepEqual((await access.json()).sucursal_ids, roleId === 6 ? null : [roleId === 7 ? 11 : 22]);
      const products = await fetch(`${base}/inventario/productos`, { headers });
      assert.equal(products.status, 200);
      const catalog = await products.json();
      assert.equal(catalog.items[0].precio_publico, '200');
      assert.equal(catalog.items[0].precio_mayoreo, '150');
      const metadata = await fetch(`${base}/inventario/catalogos`, { headers });
      assert.equal(metadata.status, 200);
      const lists = await metadata.json();
      assert.deepEqual(lists.almacenes, []);
      assert.deepEqual(lists.ubicaciones, []);
      const stock = await fetch(`${base}/inventario/existencias`, { headers });
      assert.equal(stock.status, 200);
      const stockData = await stock.json();
      assert.equal(stockData.items[0].cantidad, '1.5');
      assert.equal('costo_promedio' in stockData.items[0], false);
      assert.equal('valor' in stockData.items[0], false);
      if (roleId !== 6) {
        const denied = await fetch(`${base}/inventario/existencias?sucursal_id=${roleId === 7 ? 22 : 11}`, { headers });
        assert.equal(denied.status, 403);
        await denied.arrayBuffer();
      }
      for (const route of ['productos', 'catalogos', 'productos/1', 'productos/1/limites', 'fotos', 'movimientos', 'existencias', 'kardex', 'tablero', 'almacenes', 'ubicaciones', 'proveedores', 'alertas', 'compras/ordenes', 'conteos', 'transferencias', 'ajustes', 'reportes/rotacion']) {
        for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
          if (method === 'GET' && ['productos', 'catalogos', 'existencias'].includes(route)) continue;
          const response = await fetch(`${base}/inventario/${route}`, { method, headers });
          assert.equal(response.status, 403, `${roleId} ${method} inventory/${route}`);
          await response.arrayBuffer();
        }
      }
      for (const route of ['dashboard', 'reports', 'cliente', 'vehiculo', 'orden_trabajo', 'orden_sucursal', 'orden_asignacion', 'empleado', 'usuario', 'usuario_rol', 'rol', 'permiso', 'rol_permiso', 'dia_festivo', 'meta_mensual', 'garantia', 'cat_sucursal', 'cat_tipo_cliente', 'cat_estatus_orden', 'cat_categoria_vehiculo', 'cat_tipo_reparacion', 'cat_tipo_material_suelto', 'cat_calidad']) {
        for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
          const response = await fetch(`${base}/${route}`, { method, headers });
          assert.equal(response.status, 403, `${roleId} ${method} ${route}`);
          await response.arrayBuffer();
        }
      }
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    pool.query = originalQuery;
    await pool.end();
  }
});
