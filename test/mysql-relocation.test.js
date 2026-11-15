const test = require('node:test');
const assert = require('node:assert/strict');

test('internal relocations: atomic balances, costs, retries and authenticated access', { skip: process.env.SEEP_MYSQL_TESTS !== '1' }, async t => {
  require('dotenv').config();
  const mysql = require('mysql2/promise');
  const dbModule = require('../src/config/db');
  const bootstrap = dbModule.pool;
  const config = bootstrap.pool.config.connectionConfig;
  const schema = `seep_test_relocation_${Date.now()}_${process.pid}`;
  let created = false, db, server;
  try {
    await bootstrap.query(`CREATE DATABASE ${mysql.escapeId(schema)}`);
    created = true;
    db = mysql.createPool({ host: config.host, port: config.port, user: config.user, password: config.password,
      ssl: config.ssl || undefined, database: schema, namedPlaceholders: true, connectionLimit: 6 });
    dbModule.pool = db;
    for (const sql of [
      'CREATE TABLE usuario (id BIGINT UNSIGNED PRIMARY KEY,nombre VARCHAR(80),activo BOOLEAN DEFAULT 1) ENGINE=InnoDB',
      'CREATE TABLE cat_sucursal (id BIGINT UNSIGNED PRIMARY KEY,nombre VARCHAR(80)) ENGINE=InnoDB',
      'CREATE TABLE rol (id BIGINT UNSIGNED PRIMARY KEY,nombre VARCHAR(80),descripcion VARCHAR(180)) ENGINE=InnoDB',
      'CREATE TABLE usuario_rol (usuario_id BIGINT UNSIGNED,rol_id BIGINT UNSIGNED) ENGINE=InnoDB',
      'CREATE TABLE rol_sucursal (rol_id BIGINT UNSIGNED,sucursal_id BIGINT UNSIGNED) ENGINE=InnoDB',
    ]) await db.query(sql);
    const connection = await db.getConnection();
    try {
      await require('../scripts/migrate-inventory').migrateInventory(connection, true);
      await require('../scripts/migrate-inventory-alerts').migrateInventoryAlerts(connection, true);
    } finally { connection.release(); }
    await db.query("INSERT INTO cat_sucursal VALUES (1,'Alameda'),(2,'Chapala')");
    await db.query("INSERT INTO usuario(id,nombre) VALUES (1,'Global'),(2,'Inventario admin'),(3,'Consulta Alameda'),(4,'Consulta global'),(5,'Taller'),(6,'Consulta Chapala')");
    await db.query("INSERT INTO rol(id,nombre) VALUES (1,'Global'),(2,'Agente'),(4,'Admin sucursal'),(6,'Inventario global'),(7,'Inventario Alameda'),(8,'Inventario Chapala'),(9,'Inventario admin')");
    await db.query('INSERT INTO usuario_rol VALUES (1,1),(2,9),(3,7),(4,6),(5,4),(6,8)');
    await db.query('INSERT INTO rol_sucursal VALUES (2,1),(4,1),(7,1),(8,2)');
    await db.query("INSERT INTO inv_categoria(id,nombre) VALUES (1,'Prueba')");
    await db.query("INSERT INTO inv_unidad(id,clave,nombre) VALUES (1,'PZA','Pieza')");
    await db.query("INSERT INTO inv_producto(id,sku,nombre_comercial,nombre_tecnico,categoria_id,unidad_id,tipo,creado_por) VALUES (1,'MOVE-TEST','Artículo de prueba','Fixture',1,1,'CONSUMIBLE',1)");
    await db.query("INSERT INTO inv_almacen(id,sucursal_id,nombre) VALUES (1,1,'Principal'),(2,1,'Anexo'),(3,2,'Chapala')");
    await db.query("INSERT INTO inv_ubicacion(id,almacen_id,sucursal_id,codigo,activo) VALUES (1,1,1,'ORIGEN',1),(2,1,1,'DESTINO',1),(3,2,1,'ANEXO',1),(4,1,1,'INACTIVA',0),(5,3,2,'CHAPALA',1)");
    await db.query('INSERT INTO inv_producto_almacen(producto_id,almacen_id,sucursal_id,minimo,maximo,punto_reorden) VALUES (1,1,1,1,100,1)');
    await db.query('INSERT INTO inv_existencia(producto_id,ubicacion_id,almacen_id,sucursal_id,cantidad) VALUES (1,1,1,1,5.000001),(1,2,1,1,0)');
    await db.query('INSERT INTO inv_costo_sucursal(producto_id,sucursal_id,costo_promedio,ultimo_costo) VALUES (1,1,17.123456,18.987654)');
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use('/api/inventario', require('../src/routes/inventario'));
    app.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.message }));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const { signAccessToken } = require('../src/config/jwt');
    const request = async (userId, path, body) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/inventario${path}`, {
        method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(userId ? { Authorization: `Bearer ${signAccessToken({ sub: String(userId) })}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() };
    };
    const payload = { sucursal_id: 1, producto_id: 1, ubicacion_origen_id: 1, ubicacion_destino_id: 2,
      cantidad: '2.500001', motivo: 'Reorganización', idempotencia: 'relocation-test-000001' };
    const move = (body, userId = 1) => request(userId, '/traslados-internos', body);
    const costs = async () => (await db.query('SELECT costo_promedio,ultimo_costo FROM inv_costo_sucursal WHERE producto_id=1 AND sucursal_id=1'))[0][0];
    const initialCost = await costs();
    let first;

    await t.test('requires authentication and excludes consultation and workshop roles', async () => {
      assert.equal((await move(payload, null)).status, 401);
      for (const user of [3,4,5,6]) assert.equal((await move(payload, user)).status, 403);
    });
    await t.test('rejects equal locations, other branches, inactive destinations and invalid amounts', async () => {
      for (const ubicacion_destino_id of [1,4,5,999]) assert.equal((await move({ ...payload, ubicacion_destino_id })).status, 400);
      for (const cantidad of ['0','-1','0.0000001','9999999999999']) assert.equal((await move({ ...payload, cantidad })).status, 400);
      assert.equal((await move({ ...payload, costo_unitario: '1' })).status, 400);
      assert.equal((await move({ ...payload, cantidad: '6' })).status, 409);
      assert.equal((await db.query('SELECT COUNT(*) n FROM inv_documento'))[0][0].n, 0);
    });
    await t.test('moves fractional stock with one folio and unchanged average and last cost', async () => {
      first = await move(payload, 2);
      assert.equal(first.status, 201, JSON.stringify(first.body));
      assert.match(first.body.folio, /^TI-/);
      assert.equal(first.body.saldo_origen, '2.500000');
      assert.equal(first.body.saldo_destino, '2.500001');
      assert.deepEqual(await costs(), initialCost);
      const [[total]] = await db.query('SELECT SUM(cantidad) cantidad FROM inv_existencia WHERE producto_id=1 AND sucursal_id=1');
      assert.equal(total.cantidad, '5.000001');
      const history = await request(2, `/kardex?q=${first.body.folio}`);
      assert.equal(history.body.total, 2);
      assert.ok(history.body.items.every(row => row.traslado_folio === first.body.folio && row.usuario_nombre === 'Inventario admin'));
      assert.deepEqual(history.body.items.map(row => row.cantidad_delta).sort(), ['-2.500001','2.500001']);
    });
    await t.test('concurrent retries return the original result; changed request is rejected', async () => {
      const retries = await Promise.all([move(payload,2), move(payload,2)]);
      for (const retry of retries) {
        assert.equal(retry.status, 200);
        assert.deepEqual(retry.body, { ...first.body, duplicated: true });
      }
      assert.equal((await move({ ...payload, cantidad: '1' },2)).status, 409);
      assert.equal((await move(payload,1)).status, 409);
      assert.equal((await db.query('SELECT COUNT(*) n FROM inv_movimiento'))[0][0].n, 2);
    });
    await t.test('moving all stock does not create a transient out-of-stock alert', async () => {
      const result = await move({ ...payload, cantidad: '2.5', idempotencia: 'relocation-test-empty' });
      assert.equal(result.status, 201, JSON.stringify(result.body));
      assert.equal(result.body.saldo_origen, '0.000000');
      const stocks = await request(1, '/existencias?q=MOVE-TEST');
      assert.equal(stocks.body.total, 1);
      assert.equal(stocks.body.items[0].ubicacion_id, 2);
      assert.equal((await db.query("SELECT COUNT(*) n FROM inv_notificacion WHERE tipo='AGOTADO'"))[0][0].n, 0);
      assert.deepEqual(await costs(), initialCost);
    });
    await t.test('supports another warehouse in the same branch', async () => {
      const result = await move({ ...payload, ubicacion_origen_id: 2, ubicacion_destino_id: 3, cantidad: '1', idempotencia: 'relocation-test-warehouse' });
      assert.equal(result.status, 201, JSON.stringify(result.body));
      assert.equal(result.body.saldo_destino, '1.000000');
      assert.deepEqual(await costs(), initialCost);
    });
    await t.test('competing exits cannot overdraw the source', async () => {
      const results = await Promise.all(['a','b'].map(key => move({ ...payload, ubicacion_origen_id: 3, ubicacion_destino_id: 1,
        cantidad: '1', idempotencia: `relocation-competing-${key}` })));
      assert.deepEqual(results.map(row => row.status).sort(), [201,409]);
      assert.deepEqual(await costs(), initialCost);
    });
    await t.test('an entry failure rolls back the exit, documents and Kardex', async () => {
      const [[before]] = await db.query('SELECT COUNT(*) n FROM inv_documento');
      // Temporary trigger exists only in the disposable test schema.
      await db.query("CREATE TRIGGER reject_test_entry BEFORE INSERT ON inv_documento_detalle FOR EACH ROW BEGIN IF NEW.ubicacion_id=3 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Simulated entry failure'; END IF; END");
      try {
        const failed = await move({ ...payload, cantidad: '0.5', ubicacion_destino_id: 3, idempotencia: 'relocation-test-rollback' });
        assert.equal(failed.status, 500);
        assert.equal((await db.query('SELECT cantidad FROM inv_existencia WHERE producto_id=1 AND ubicacion_id=1'))[0][0].cantidad, '1.000000');
        assert.equal((await db.query('SELECT COUNT(*) n FROM inv_documento'))[0][0].n, before.n);
        assert.deepEqual(await costs(), initialCost);
      } finally { await db.query('DROP TRIGGER reject_test_entry'); }
    });
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (db) await db.end();
    dbModule.pool = bootstrap;
    if (created && /^seep_test_relocation_\d+_\d+$/.test(schema) && schema !== config.database) await bootstrap.query(`DROP DATABASE ${mysql.escapeId(schema)}`);
    await bootstrap.end();
  }
});
