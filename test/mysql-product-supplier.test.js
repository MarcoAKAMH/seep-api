const test = require('node:test');
const assert = require('node:assert/strict');

test('catalog supplier assignment persists atomically and purchase orders respect it', { skip: process.env.SEEP_MYSQL_TESTS !== '1' }, async t => {
  require('dotenv').config();
  require('dotenv').config({ path: '.env.local', override: true });
  const mysql = require('mysql2/promise');
  const dbModule = require('../src/config/db');
  const source = dbModule.pool;
  const config = source.pool.config.connectionConfig;
  const schema = `seep_test_supplier_${Date.now()}_${process.pid}`;
  let created = false;
  let pool;
  let server;
  try {
    await source.query(`CREATE DATABASE ${mysql.escapeId(schema)}`);
    created = true;
    pool = mysql.createPool({ host: config.host, port: config.port, user: config.user, password: config.password,
      ssl: config.ssl || undefined, database: schema, namedPlaceholders: true, connectionLimit: 3 });
    for (const table of ['usuario', 'cat_sucursal']) {
      await pool.query(`CREATE TABLE ${mysql.escapeId(table)} LIKE ${mysql.escapeId(config.database)}.${mysql.escapeId(table)}`);
    }
    const db = await pool.getConnection();
    try {
      await require('../scripts/migrate-inventory').migrateInventory(db, true);
      await require('../scripts/migrate-inventory-controls').migrateInventoryControls(db, true);
      await require('../scripts/migrate-inventory-purchasing').migrateInventoryPurchasing(db, true);
      await require('../scripts/migrate-inventory-remove-barcode').migrateInventoryRemoveBarcode(db, true);
    } finally { db.release(); }
    await pool.query("INSERT INTO usuario(id,correo,nombre,password_hash,activo) VALUES (1,'supplier-test@example.com','Fixture','unused',1)");
    await pool.query("INSERT INTO cat_sucursal(id,nombre) VALUES (11,'Alameda'),(22,'Chapala')");
    await pool.query("INSERT INTO inv_categoria(id,nombre) VALUES (1,'Prueba')");
    await pool.query("INSERT INTO inv_unidad(id,clave,nombre) VALUES (1,'PZA','Pieza')");
    await pool.query("INSERT INTO inv_almacen(id,sucursal_id,nombre) VALUES (1,11,'Principal')");

    // Exercise the real HTTP handlers and MySQL transactions with a fixed authorized
    // principal. Authentication and role restrictions have their own test suite.
    dbModule.pool = pool;
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.user = { sub: '1', is_admin: true, can_manage_inventory: true, can_manage_inventory_catalog: true };
      next();
    });
    app.use(require('../src/routes/inventario/catalog'));
    app.use(require('../src/routes/inventario/purchasing'));
    app.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.message }));
    server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    const request = async (url, method = 'GET', body) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
        method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    };
    const supplier = await request('/proveedores', 'POST', { razon_social: 'Proveedor Uno SA', nombre_comercial: 'Proveedor Uno', sucursal_ids: [11, 22] });
    const other = await request('/proveedores', 'POST', { razon_social: 'Proveedor Dos SA', nombre_comercial: 'Proveedor Dos', sucursal_ids: [11] });
    assert.equal(supplier.status, 201, JSON.stringify(supplier.body));
    assert.equal(other.status, 201, JSON.stringify(other.body));
    const productBody = { sku: 'SUP-TEST', nombre_comercial: 'Artículo prueba', nombre_tecnico: 'Artículo de prueba',
      categoria_id: 1, unidad_id: 1, tipo: 'CONSUMIBLE', precio_publico: '0', precio_mayoreo: '0', proveedor_id: supplier.body.id };
    let product;
    await t.test('new article assigns the supplier in its served branches and exposes the name', async () => {
      product = await request('/productos', 'POST', productBody);
      assert.equal(product.status, 201, JSON.stringify(product.body));
      for (const suffix of ['', '&sucursal_id=11', '&sucursal_id=22']) {
        const list = await request(`/productos?q=SUP-TEST${suffix}`);
        assert.equal(list.status, 200, JSON.stringify(list.body));
        assert.equal(list.body.items[0].proveedor_id, supplier.body.id);
        assert.equal(list.body.items[0].proveedor_nombre, 'Proveedor Uno');
      }
      const assignments = await request('/proveedores-productos?sucursal_id=11');
      assert.equal(assignments.body.items[0].preferido, 1);
      assert.equal(assignments.body.items[0].proveedor_activo, 1);
    });
    await t.test('invalid or inactive suppliers roll back article creation and edits', async () => {
      const invalid = await request('/productos', 'POST', { ...productBody, sku: 'BAD-SUPPLIER', proveedor_id: 999999 });
      assert.equal(invalid.status, 400, JSON.stringify(invalid.body));
      assert.equal((await request('/productos?q=BAD-SUPPLIER')).body.total, 0);
      await pool.query('UPDATE inv_proveedor SET activo=0 WHERE id=?', [other.body.id]);
      const inactive = await request(`/productos/${product.body.id}`, 'PUT', { ...productBody, nombre_comercial: 'Should roll back', proveedor_id: other.body.id });
      assert.equal(inactive.status, 400);
      const existing = (await request('/productos?q=SUP-TEST')).body.items[0];
      assert.equal(existing.nombre_comercial, productBody.nombre_comercial);
      assert.equal(existing.proveedor_id, supplier.body.id);
      await pool.query('UPDATE inv_proveedor SET activo=1 WHERE id=?', [other.body.id]);
    });
    await t.test('editing other fields keeps the association; changing supplier preserves historical costs', async () => {
      const { proveedor_id, ...unchanged } = productBody;
      assert.equal((await request(`/productos/${product.body.id}`, 'PUT', unchanged)).status, 200);
      assert.equal((await request('/productos?q=SUP-TEST')).body.items[0].proveedor_id, supplier.body.id);
      await pool.query('UPDATE inv_producto_proveedor SET costo_referencia=12.5 WHERE producto_id=?', [product.body.id]);
      assert.equal((await request(`/productos/${product.body.id}`, 'PUT', { ...productBody, proveedor_id: other.body.id })).status, 200);
      assert.equal((await request('/productos?q=SUP-TEST&sucursal_id=11')).body.items[0].proveedor_id, other.body.id);
      assert.equal((await request('/productos?q=SUP-TEST&sucursal_id=22')).body.items[0].proveedor_id, null);
      assert.equal((await request(`/productos/${product.body.id}`, 'PUT', productBody)).status, 200);
      const [rows] = await pool.query('SELECT costo_referencia FROM inv_producto_proveedor WHERE producto_id=? AND preferido=1', [product.body.id]);
      assert.equal(rows.length, 2);
      assert.ok(rows.every(row => row.costo_referencia === '12.500000'));
    });
    await t.test('orders accept the assigned supplier and reject a mismatch or mixed suppliers', async () => {
      const second = await request('/productos', 'POST', { ...productBody, sku: 'SUP-SECOND' });
      assert.equal(second.status, 201);
      await pool.query('INSERT INTO inv_producto_almacen(producto_id,almacen_id,sucursal_id) VALUES (?,1,11),(?,1,11)', [product.body.id, second.body.id]);
      const order = { sucursal_id: 11, almacen_id: 1, proveedor_id: supplier.body.id,
        detalles: [product.body.id, second.body.id].map(producto_id => ({ producto_id, cantidad: '2', costo_esperado: '10' })) };
      const mismatch = await request('/compras/ordenes', 'POST', { ...order, proveedor_id: other.body.id });
      assert.equal(mismatch.status, 400);
      assert.match(mismatch.body.message, /proveedor no coincide/);
      const saved = await request('/compras/ordenes', 'POST', order);
      assert.equal(saved.status, 201, JSON.stringify(saved.body));
      assert.equal(saved.body.subtotal_estimado, '40.000000');
      await request(`/productos/${second.body.id}`, 'PUT', { ...productBody, sku: 'SUP-SECOND', proveedor_id: other.body.id });
      const mixed = await request('/compras/ordenes', 'POST', order);
      assert.equal(mixed.status, 400);
      assert.match(mixed.body.message, /Partida 2/);
      const [[count]] = await pool.query('SELECT COUNT(*) total FROM inv_orden_compra');
      assert.equal(count.total, 1);
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    dbModule.pool = source;
    if (pool) await pool.end();
    if (created) await source.query(`DROP DATABASE ${mysql.escapeId(schema)}`);
    await source.end();
  }
});
