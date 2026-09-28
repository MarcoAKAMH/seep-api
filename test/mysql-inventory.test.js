const test = require('node:test');
const assert = require('node:assert/strict');

test('inventory migration, constraints and authenticated HTTP access', { skip: process.env.SEEP_MYSQL_TESTS !== '1' }, async t => {
  require('dotenv').config();
  require('dotenv').config({ path: '.env.local', override: true });
  const mysql = require('mysql2/promise');
  const dbModule = require('../src/config/db');
  const source = dbModule.pool;
  const config = source.pool.config.connectionConfig;
  const schema = `seep_test_inventory_${Date.now()}_${process.pid}`;
  let created = false;
  let pool;
  let server;
  const photoDirectory = await require('node:fs/promises').mkdtemp(require('node:path').join(require('node:os').tmpdir(), 'seep-inventory-photos-'));
  const countEvidenceDirectory = await require('node:fs/promises').mkdtemp(require('node:path').join(require('node:os').tmpdir(), 'seep-count-evidence-'));
  process.env.INVENTORY_PHOTO_DIR = photoDirectory;
  process.env.INVENTORY_COUNT_EVIDENCE_DIR = countEvidenceDirectory;
  try {
    await source.query(`CREATE DATABASE ${mysql.escapeId(schema)}`);
    created = true;
    pool = mysql.createPool({ host: config.host, port: config.port, user: config.user, password: config.password,
      ssl: config.ssl || undefined, database: schema, namedPlaceholders: true, connectionLimit: 3 });
    for (const table of ['usuario', 'cat_sucursal', 'rol', 'rol_sucursal', 'usuario_rol']) {
      await pool.query(`CREATE TABLE ${mysql.escapeId(table)} LIKE ${mysql.escapeId(config.database)}.${mysql.escapeId(table)}`);
    }
    const { migrateInventory, tables } = require('../scripts/migrate-inventory');
    await t.test('check is read-only; apply is repeatable and records its checksum', async () => {
      const db = await pool.getConnection();
      try {
        assert.equal((await migrateInventory(db)).status, 'pending');
        assert.equal((await db.query("SHOW TABLES LIKE 'inv%'")).at(0).length, 0);
        assert.equal((await migrateInventory(db, true)).status, 'applied');
        assert.equal((await migrateInventory(db, true)).status, 'already_applied');
        assert.equal((await db.query("SHOW TABLES LIKE 'inv%'")).at(0).length, tables.length + 1);
        const [[row]] = await db.query('SELECT checksum FROM inv_migracion');
        await db.query("UPDATE inv_migracion SET checksum = REPEAT('0',64)");
        await assert.rejects(migrateInventory(db, true), /checksum/);
        await db.query('UPDATE inv_migracion SET checksum = ?', [row.checksum]);
      } finally { db.release(); }
    });
    const { migrateInventoryControls, tables: controlTables } = require('../scripts/migrate-inventory-controls');
    await t.test('control migration is repeatable and creates its tables', async () => {
      const db = await pool.getConnection();
      try {
        assert.equal((await migrateInventoryControls(db)).status, 'pending');
        assert.equal((await migrateInventoryControls(db, true)).status, 'applied');
        assert.equal((await migrateInventoryControls(db, true)).status, 'already_applied');
        const [createdTables] = await db.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?)", [controlTables]);
        assert.equal(createdTables.length, controlTables.length);
      } finally { db.release(); }
    });
    const { migrateInventoryAlerts } = require('../scripts/migrate-inventory-alerts');
    await t.test('alert migration is repeatable and adds reorder notifications', async () => {
      const db = await pool.getConnection();
      try {
        assert.equal((await migrateInventoryAlerts(db)).status, 'pending');
        assert.equal((await migrateInventoryAlerts(db, true)).status, 'applied');
        assert.equal((await migrateInventoryAlerts(db, true)).status, 'already_applied');
        const [[column]] = await db.query("SELECT COLUMN_TYPE tipo FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inv_notificacion' AND COLUMN_NAME='tipo'");
        assert.match(column.tipo, /PUNTO_REORDEN/);
      } finally { db.release(); }
    });
    const { migrateInventoryPurchasing, tables: purchasingTables } = require('../scripts/migrate-inventory-purchasing');
    await t.test('purchasing migration is repeatable and creates its tables', async () => {
      const db = await pool.getConnection();
      try {
        assert.equal((await migrateInventoryPurchasing(db)).status, 'pending');
        assert.equal((await migrateInventoryPurchasing(db, true)).status, 'applied');
        assert.equal((await migrateInventoryPurchasing(db, true)).status, 'already_applied');
        const [createdTables] = await db.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?)", [purchasingTables]);
        assert.equal(createdTables.length, purchasingTables.length);
      } finally { db.release(); }
    });
    const { migrateInventoryCycleCounts, tables: cycleCountTables } = require('../scripts/migrate-inventory-cycle-counts');
    await t.test('cycle-count migration is repeatable and creates its tables', async () => {
      const db = await pool.getConnection();
      try {
        assert.equal((await migrateInventoryCycleCounts(db)).status, 'pending');
        assert.equal((await migrateInventoryCycleCounts(db, true)).status, 'applied');
        assert.equal((await migrateInventoryCycleCounts(db, true)).status, 'already_applied');
        const [createdTables] = await db.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?)", [cycleCountTables]);
        assert.equal(createdTables.length, cycleCountTables.length);
      } finally { db.release(); }
    });
    const { migrateInventoryRemoveBarcode } = require('../scripts/migrate-inventory-remove-barcode');
    await t.test('barcode removal migration is repeatable and leaves the current product schema', async () => {
      const db = await pool.getConnection();
      try {
        assert.equal((await migrateInventoryRemoveBarcode(db)).status, 'pending');
        assert.equal((await migrateInventoryRemoveBarcode(db, true)).status, 'applied');
        assert.equal((await migrateInventoryRemoveBarcode(db, true)).status, 'already_applied');
        const [columns] = await db.query("SHOW COLUMNS FROM inv_producto LIKE 'codigo_barras'");
        assert.equal(columns.length, 0);
      } finally { db.release(); }
    });
    await pool.query("INSERT INTO cat_sucursal(id,nombre) VALUES (11,'Alameda'),(22,'Chapala')");
    await pool.query("INSERT INTO rol(id,nombre) VALUES (1,'Global'),(2,'Agente A'),(3,'Agente C'),(4,'Admin A'),(5,'Admin C')");
    await pool.query('INSERT INTO rol_sucursal(rol_id,sucursal_id) VALUES (2,11),(3,22),(4,11),(5,22)');
    const testPassword = 'InventoryTestPassword123!';
    const passwordHash = await require('bcryptjs').hash(testPassword, 4);
    for (let id = 1; id <= 5; id++) {
      await pool.query('INSERT INTO usuario(id,correo,nombre,password_hash,activo) VALUES (?,?,?,?,1)', [id, `inventory${id}@example.com`, `Fixture ${id}`, passwordHash]);
    }
    await pool.query('INSERT INTO usuario_rol(usuario_id,rol_id) VALUES (1,1),(2,4),(3,5),(4,2),(5,2),(5,3)');
    await pool.query("INSERT INTO inv_categoria(id,nombre) VALUES (1,'Tubos')");
    await pool.query("INSERT INTO inv_unidad(id,clave,nombre) VALUES (1,'M','Metro')");
    const productSql = "INSERT INTO inv_producto(sku,nombre_comercial,nombre_tecnico,categoria_id,unidad_id,tipo,precio_publico,precio_mayoreo,creado_por) VALUES ('TUB-TEST','Tubo','Tubo técnico',1,1,'MATERIA_PRIMA',0,0,1)";
    await pool.query(productSql);
    await pool.query("INSERT INTO inv_almacen(id,sucursal_id,nombre) VALUES (1,11,'Principal'),(2,22,'Principal')");
    await pool.query("INSERT INTO inv_ubicacion(id,almacen_id,sucursal_id,codigo) VALUES (1,1,11,'A-1-01'),(2,2,22,'A-1-01')");
    await pool.query('INSERT INTO inv_producto_almacen(producto_id,almacen_id,sucursal_id) VALUES (1,1,11),(1,2,22)');

    await t.test('schema rejects duplicate SKUs, negative stock and cross-branch locations', async () => {
      await assert.rejects(pool.query(productSql), { code: 'ER_DUP_ENTRY' });
      await assert.rejects(pool.query("INSERT INTO inv_ubicacion(almacen_id,sucursal_id,codigo) VALUES (1,22,'BAD')"), { code: 'ER_NO_REFERENCED_ROW_2' });
      await assert.rejects(pool.query('INSERT INTO inv_existencia(producto_id,ubicacion_id,almacen_id,sucursal_id,cantidad) VALUES (1,1,1,11,-1)'), { code: 'ER_CHECK_CONSTRAINT_VIOLATED' });
      await assert.rejects(pool.query('INSERT INTO inv_existencia(producto_id,ubicacion_id,almacen_id,sucursal_id,cantidad) VALUES (1,2,1,11,1)'), { code: 'ER_NO_REFERENCED_ROW_2' });
      await pool.query('INSERT INTO inv_existencia(producto_id,ubicacion_id,almacen_id,sucursal_id,cantidad) VALUES (1,1,1,11,1.500001)');
      const [[stock]] = await pool.query('SELECT cantidad FROM inv_existencia');
      assert.equal(stock.cantidad, '1.500001');
      await assert.rejects(pool.query('DELETE FROM inv_producto WHERE id=1'), { code: 'ER_ROW_IS_REFERENCED_2' });
    });

    await t.test('document references cannot mix branches; alerts deduplicate while retaining history', async () => {
      await pool.query("INSERT INTO inv_documento(id,sucursal_id,folio,tipo,motivo,idempotencia,creado_por,fecha_operacion) VALUES (1,11,'INI-1','INICIAL','Apertura','request-1',1,UTC_TIMESTAMP())");
      await assert.rejects(pool.query("INSERT INTO inv_documento_detalle(documento_id,sucursal_id,producto_id,almacen_id,ubicacion_id,cantidad,costo_unitario) VALUES (1,22,1,2,2,1,10)"), { code: 'ER_NO_REFERENCED_ROW_2' });
      const alertSql = "INSERT INTO inv_notificacion(sucursal_id,producto_id,almacen_id,tipo,mensaje) VALUES (11,1,1,'BAJO_MINIMO','Stock bajo')";
      await pool.query(alertSql);
      await assert.rejects(pool.query(alertSql), { code: 'ER_DUP_ENTRY' });
      await pool.query('UPDATE inv_notificacion SET activa=0, resuelta_at=UTC_TIMESTAMP()');
      await pool.query(alertSql);
      assert.equal((await pool.query('SELECT id FROM inv_notificacion'))[0].length, 2);
    });

    dbModule.pool = pool;
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use('/api/inventario', require('../src/routes/inventario'));
    app.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.message }));
    server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    const { signAccessToken } = require('../src/config/jwt');
    const catalogRequest = async (userId, url, method = 'GET', body) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/inventario${url}`, {
        method, headers: { Authorization: `Bearer ${signAccessToken({ sub: String(userId) })}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    };
    await t.test('catalog CRUD is global-only, validates data and audits writes', async () => {
      const category = await catalogRequest(1, '/categorias', 'POST', { nombre: 'Enfriamiento' });
      assert.equal(category.status, 201, JSON.stringify(category.body));
      assert.equal((await catalogRequest(2, '/categorias', 'POST', { nombre: 'Forbidden' })).status, 403);
      assert.equal((await catalogRequest(4, '/productos')).status, 403);
      const unit = await catalogRequest(1, '/unidades', 'POST', { clave: 'L', nombre: 'Litro', decimales: 3 });
      assert.equal(unit.status, 201);
      const product = { sku: 'ANT-ROSA', nombre_comercial: 'Anticongelante rosa', nombre_tecnico: 'Refrigerante',
        categoria_id: category.body.id, unidad_id: unit.body.id, tipo: 'CONSUMIBLE', precio_publico: '99.123456' };
      assert.equal((await catalogRequest(1, '/productos', 'POST', { ...product, costo_promedio: '1' })).status, 400);
      assert.equal((await catalogRequest(1, '/productos', 'POST', { ...product, precio_publico: '-1' })).status, 400);
      const createdProduct = await catalogRequest(1, '/productos', 'POST', product);
      assert.equal(createdProduct.status, 201, JSON.stringify(createdProduct.body));
      assert.equal((await catalogRequest(1, '/productos', 'POST', product)).status, 409);
      assert.equal((await catalogRequest(2, `/productos/${createdProduct.body.id}`, 'PUT', product)).status, 403);
      const found = await catalogRequest(2, '/productos?q=ANT-ROSA&limit=1');
      assert.equal(found.body.total, 1);
      assert.equal(found.body.items[0].precio_publico, '99.123456');
      assert.equal((await catalogRequest(1, '/productos?q=%25')).body.total, 0);
      assert.equal((await catalogRequest(1, '/productos?limit=1')).body.items.length, 1);
      assert.equal((await catalogRequest(1, `/unidades/${unit.body.id}`, 'PUT', { clave: 'L', nombre: 'Litro', decimales: 0 })).status, 409);
      assert.equal((await catalogRequest(1, `/productos/${createdProduct.body.id}`, 'PUT', { ...product, activo: false })).status, 200);
      assert.equal((await catalogRequest(1, '/productos?activo=0')).body.items[0].id, createdProduct.body.id);
      const [[audit]] = await pool.query("SELECT COUNT(*) total FROM inv_auditoria WHERE entidad='inv_producto' AND entidad_id=?", [createdProduct.body.id]);
      assert.equal(audit.total, 2);
      assert.equal((await catalogRequest(1, '/productos', 'POST', { ...product, sku: 'BAD-URL', foto_url: 'javascript:alert(1)' })).status, 400);
      const [[existingProduct]] = await pool.query('SELECT * FROM inv_producto WHERE id=1');
      const { id: existingId, creado_por, created_at, updated_at, ...editableProduct } = existingProduct;
      assert.equal((await catalogRequest(1, '/productos/1', 'PUT', { ...editableProduct, activo: false })).status, 409);
    });
    await t.test('warehouse and location CRUD is branch-scoped, including pagination and parent links', async () => {
      assert.equal((await catalogRequest(2, '/almacenes', 'POST', { nombre: 'Foreign', sucursal_id: 22 })).status, 403);
      const own = await catalogRequest(2, '/almacenes', 'POST', { nombre: 'Secundario', sucursal_id: 11 });
      assert.equal(own.status, 201);
      assert.equal((await catalogRequest(2, '/almacenes/2', 'PUT', { nombre: 'Changed', sucursal_id: 11 })).status, 403);
      assert.equal((await catalogRequest(1, '/almacenes/1', 'PUT', { nombre: 'Moved', sucursal_id: 22 })).status, 400);
      const list = await catalogRequest(2, '/almacenes?limit=1');
      assert.equal(list.body.total, 2);
      assert.equal(list.body.items.length, 1);
      assert.equal(list.body.items[0].sucursal_id, 11);
      assert.equal((await catalogRequest(2, '/ubicaciones', 'POST', { codigo: 'BAD', almacen_id: 2, sucursal_id: 11 })).status, 400);
      assert.equal((await catalogRequest(2, '/ubicaciones', 'POST', { codigo: 'B-2-01', almacen_id: own.body.id, sucursal_id: 11 })).status, 201);
      assert.equal((await catalogRequest(2, '/ubicaciones?q=B-2-01')).body.total, 1);
      const local = await catalogRequest(2, '/catalogos');
      assert.deepEqual(local.body.sucursales.map(r => r.id), [11]);
      assert.ok(local.body.almacenes.every(r => r.sucursal_id === 11));
      assert.equal((await catalogRequest(2, '/catalogos?sucursal_id=22')).status, 403);
      assert.equal((await catalogRequest(2, '/ubicaciones/1', 'PUT', { codigo: 'A-1-01', almacen_id: 1, sucursal_id: 11, activo: false })).status, 409);
    });
    await t.test('limits are exact decimal values scoped by branch, without changing stock', async () => {
      const body = { almacen_id: 1, sucursal_id: 11, minimo: '1.000001', punto_reorden: '2', maximo: '5' };
      assert.equal((await catalogRequest(2, '/productos/1/limites', 'PUT', body)).status, 200);
      assert.equal((await catalogRequest(2, '/productos/1/limites', 'PUT', { ...body, sucursal_id: 22, almacen_id: 2 })).status, 403);
      assert.equal((await catalogRequest(2, '/productos/1/limites', 'PUT', { ...body, almacen_id: 2 })).status, 400);
      assert.equal((await catalogRequest(2, '/productos/1/limites', 'PUT', { ...body, maximo: '0' })).status, 400);
      const result = await catalogRequest(2, '/productos/1/limites');
      assert.equal(result.body.length, 1);
      assert.equal(result.body[0].minimo, '1.000001');
      assert.equal(result.body[0].sucursal_id, 11);
      assert.equal((await catalogRequest(1, '/productos/1/limites')).body.length, 2);
      const [[stock]] = await pool.query('SELECT cantidad FROM inv_existencia WHERE producto_id=1 AND ubicacion_id=1');
      assert.equal(stock.cantidad, '1.500001');
    });
    await t.test('photos are authenticated, restricted to globals and validated by content', async () => {
      const photoRequest = (userId, body) => fetch(`http://127.0.0.1:${server.address().port}/api/inventario/fotos`, {
        method: 'POST', headers: { Authorization: `Bearer ${signAccessToken({ sub: String(userId) })}`, 'Content-Type': 'image/png' }, body,
      });
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1sAAAAASUVORK5CYII=', 'base64');
      assert.equal((await photoRequest(2, png)).status, 403);
      assert.equal((await photoRequest(1, Buffer.from('not an image at all'))).status, 400);
      const response = await photoRequest(1, png);
      assert.equal(response.status, 201);
      const { foto_url } = await response.json();
      const url = `http://127.0.0.1:${server.address().port}/api${foto_url}`;
      assert.equal((await fetch(url)).status, 401);
      assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${signAccessToken({ sub: '4' })}` } })).status, 403);
      const read = await fetch(url, { headers: { Authorization: `Bearer ${signAccessToken({ sub: '2' })}` } });
      assert.equal(read.status, 200);
      assert.deepEqual(Buffer.from(await read.arrayBuffer()), png);
    });
    await t.test('movement engine applies weighted average, prevents negative stock and is idempotent', async () => {
      await pool.query("INSERT INTO inv_costo_sucursal(producto_id,sucursal_id,costo_promedio,ultimo_costo) VALUES (1,11,20,20)");
      const entry = { sucursal_id: 11, tipo: 'ENTRADA', motivo: 'Compra de prueba', referencia: 'FAC-1', idempotencia: 'test-entry-00000001',
        detalles: [{ producto_id: 1, almacen_id: 1, ubicacion_id: 1, cantidad: '0.500000', costo_unitario: '10.000000' }] };
      const first = await catalogRequest(2, '/movimientos', 'POST', entry);
      assert.equal(first.status, 201, JSON.stringify(first.body));
      const repeated = await catalogRequest(2, '/movimientos', 'POST', entry);
      assert.equal(repeated.status, 200);
      assert.equal(repeated.body.duplicated, true);
      const [[afterEntry]] = await pool.query('SELECT cantidad FROM inv_existencia WHERE producto_id=1 AND ubicacion_id=1');
      const [[afterCost]] = await pool.query('SELECT costo_promedio,ultimo_costo FROM inv_costo_sucursal WHERE producto_id=1 AND sucursal_id=11');
      assert.equal(afterEntry.cantidad, '2.000001');
      assert.equal(afterCost.costo_promedio, '17.500001');
      assert.equal(afterCost.ultimo_costo, '10.000000');
      const exit = await catalogRequest(2, '/movimientos', 'POST', { sucursal_id: 11, tipo: 'SALIDA', motivo: 'Consumo interno', idempotencia: 'test-exit-000000001',
        detalles: [{ producto_id: 1, almacen_id: 1, ubicacion_id: 1, cantidad: '0.250000' }] });
      assert.equal(exit.status, 201, JSON.stringify(exit.body));
      const [[movement]] = await pool.query("SELECT cantidad_delta,costo_unitario,saldo_posterior FROM inv_movimiento ORDER BY id DESC LIMIT 1");
      assert.deepEqual(movement, { cantidad_delta: '-0.250000', costo_unitario: '17.500001', saldo_posterior: '1.750001' });
      const before = (await pool.query('SELECT COUNT(*) total FROM inv_documento'))[0][0].total;
      const rejected = await catalogRequest(2, '/movimientos', 'POST', { sucursal_id: 11, tipo: 'SALIDA', motivo: 'Exceso', idempotencia: 'test-exit-000000002',
        detalles: [{ producto_id: 1, almacen_id: 1, ubicacion_id: 1, cantidad: '999.000000' }] });
      assert.equal(rejected.status, 409);
      assert.equal((await pool.query('SELECT COUNT(*) total FROM inv_documento'))[0][0].total, before);
      assert.equal((await catalogRequest(2, '/movimientos', 'POST', { ...entry, sucursal_id: 22, idempotencia: 'test-entry-00000002' })).status, 403);
      assert.equal((await catalogRequest(2, '/movimientos', 'POST', { ...entry, tipo: 'INICIAL', idempotencia: 'test-initial-000001' })).status, 403);
      const stock = await catalogRequest(2, '/existencias?q=TUB-TEST');
      assert.equal(stock.status, 200);
      assert.equal(stock.body.items[0].cantidad, '1.750001');
      const kardex = await catalogRequest(2, '/kardex?q=FAC-1');
      assert.equal(kardex.body.total, 1);
      assert.equal(kardex.body.items[0].folio, first.body.folio);
    });
    await t.test('transfers use separate dispatch and receipt documents with branch scope', async () => {
      const payload = { sucursal_origen_id: 11, almacen_origen_id: 1, ubicacion_origen_id: 1,
        sucursal_destino_id: 22, almacen_destino_id: 2, ubicacion_destino_id: 2,
        motivo: 'Surtido entre sucursales', referencia: 'TR-TEST', idempotencia: 'test-transfer-000001',
        detalles: [{ producto_id: 1, cantidad: '0.250000' }] };
      const dispatched = await catalogRequest(2, '/transferencias', 'POST', payload);
      assert.equal(dispatched.status, 201, JSON.stringify(dispatched.body));
      assert.equal(dispatched.body.estado, 'DESPACHADA');
      assert.equal((await catalogRequest(2, `/transferencias/${dispatched.body.id}/recibir`, 'POST')).status, 403);
      const received = await catalogRequest(3, `/transferencias/${dispatched.body.id}/recibir`, 'POST');
      assert.equal(received.status, 200, JSON.stringify(received.body));
      assert.equal(received.body.estado, 'RECIBIDA');
      assert.equal((await catalogRequest(3, `/transferencias/${dispatched.body.id}/recibir`, 'POST')).status, 409);
      assert.equal((await catalogRequest(2, '/transferencias')).body.total, 1);
      assert.equal((await catalogRequest(3, '/transferencias')).body.total, 1);
      assert.equal((await catalogRequest(4, '/transferencias')).status, 403);
      const [[origin]] = await pool.query('SELECT cantidad FROM inv_existencia WHERE producto_id=1 AND ubicacion_id=1');
      const [[destination]] = await pool.query('SELECT cantidad FROM inv_existencia WHERE producto_id=1 AND ubicacion_id=2');
      assert.equal(origin.cantidad, '1.500001');
      assert.equal(destination.cantidad, '0.250000');
      assert.equal((await catalogRequest(2, '/transferencias', 'POST', payload)).status, 409);
    });
    await t.test('physical adjustments require global password authorization and preserve the request', async () => {
      const requested = await catalogRequest(2, '/ajustes', 'POST', { sucursal_id: 11, producto_id: 1, almacen_id: 1, ubicacion_id: 1,
        cantidad_contada: '1.250000', motivo: 'Conteo cíclico de prueba' });
      assert.equal(requested.status, 201, JSON.stringify(requested.body));
      assert.equal((await catalogRequest(2, `/ajustes/${requested.body.id}/decision`, 'PUT', { aprobar: true, motivo: 'Aprobado', password: testPassword })).status, 403);
      assert.equal((await catalogRequest(1, `/ajustes/${requested.body.id}/decision`, 'PUT', { aprobar: true, motivo: 'Aprobado', password: 'incorrecta' })).status, 403);
      const approved = await catalogRequest(1, `/ajustes/${requested.body.id}/decision`, 'PUT', { aprobar: true, motivo: 'Conteo validado', password: testPassword });
      assert.equal(approved.status, 200, JSON.stringify(approved.body));
      assert.equal(approved.body.estado, 'APROBADO');
      const [[stock]] = await pool.query('SELECT cantidad FROM inv_existencia WHERE producto_id=1 AND ubicacion_id=1');
      assert.equal(stock.cantidad, '1.250000');
      assert.equal((await catalogRequest(2, '/ajustes?estado=PENDIENTE')).body.total, 0);
      assert.equal((await catalogRequest(1, '/ajustes?estado=APROBADO')).body.total, 1);
    });
    await t.test('document reversal requires reauthentication and can only be applied once', async () => {
      const entry = await catalogRequest(2, '/movimientos', 'POST', { sucursal_id: 11, tipo: 'ENTRADA', motivo: 'Entrada reversible',
        idempotencia: 'test-reversal-entry-0001', detalles: [{ producto_id: 1, almacen_id: 1, ubicacion_id: 1, cantidad: '0.100000', costo_unitario: '18.000000' }] });
      assert.equal(entry.status, 201, JSON.stringify(entry.body));
      assert.equal((await catalogRequest(2, `/documentos/${entry.body.id}/reversa`, 'POST', { motivo: 'Error de captura', password: testPassword })).status, 403);
      assert.equal((await catalogRequest(1, `/documentos/${entry.body.id}/reversa`, 'POST', { motivo: 'Error de captura', password: 'incorrecta' })).status, 403);
      const reversed = await catalogRequest(1, `/documentos/${entry.body.id}/reversa`, 'POST', { motivo: 'Error de captura confirmado', password: testPassword });
      assert.equal(reversed.status, 201, JSON.stringify(reversed.body));
      assert.equal((await catalogRequest(1, `/documentos/${entry.body.id}/reversa`, 'POST', { motivo: 'Duplicada', password: testPassword })).status, 409);
      const documents = await catalogRequest(2, '/documentos');
      assert.equal(documents.status, 200);
      assert.equal(documents.body.items.find(row => row.id === entry.body.id).reversado, 1);
      const [[stock]] = await pool.query('SELECT cantidad FROM inv_existencia WHERE producto_id=1 AND ubicacion_id=1');
      assert.equal(stock.cantidad, '1.250000');
    });
    await t.test('dashboard, alerts, limits and rotation reports respect scope and reading history', async () => {
      const limits = await catalogRequest(2, '/productos/1/limites', 'PUT', { almacen_id: 1, sucursal_id: 11, minimo: '1.300000', punto_reorden: '1.400000', maximo: '5.000000' });
      assert.equal(limits.status, 200, JSON.stringify(limits.body));
      await pool.query("UPDATE inv_existencia SET ultimo_movimiento_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 100 DAY) WHERE producto_id=1 AND ubicacion_id=1");
      const dashboard = await catalogRequest(2, '/tablero');
      assert.equal(dashboard.status, 200, JSON.stringify(dashboard.body));
      assert.equal(dashboard.body.productos_bajo_minimo, 1);
      assert.equal(dashboard.body.productos_sin_movimiento, 1);
      assert.ok(Number(dashboard.body.valor_inventario) > 0);
      assert.ok(dashboard.body.alertas_activas >= 2);
      assert.equal((await catalogRequest(3, '/tablero?sucursal_id=11')).status, 403);
      const alerts = await catalogRequest(2, '/alertas');
      assert.equal(alerts.status, 200);
      assert.ok(alerts.body.items.some(row => row.tipo === 'BAJO_MINIMO'));
      assert.ok(alerts.body.items.some(row => row.tipo === 'SIN_MOVIMIENTO'));
      const alertId = alerts.body.items[0].id;
      assert.equal((await catalogRequest(2, `/alertas/${alertId}/leer`, 'POST')).status, 200);
      assert.equal((await catalogRequest(2, '/alertas')).body.items.find(row => row.id === alertId).leida, 1);
      assert.equal((await catalogRequest(1, '/alertas/leer-todas', 'POST', {})).status, 200);
      const limitReport = await catalogRequest(2, '/reportes/limites?estado=BAJO_MINIMO');
      assert.equal(limitReport.status, 200, JSON.stringify(limitReport.body));
      assert.equal(limitReport.body.total, 1);
      assert.equal(limitReport.body.items[0].estado, 'BAJO_MINIMO');
      const rotation = await catalogRequest(2, '/reportes/rotacion?dias=365&orden=mas');
      assert.equal(rotation.status, 200, JSON.stringify(rotation.body));
      assert.equal(rotation.body.items[0].sku, 'TUB-TEST');
      assert.ok(Number(rotation.body.items[0].cantidad_salida) > 0);
    });
    await t.test('supplier and purchase workflow authorizes and receives partial orders into Kardex', async () => {
      const providerBody = { razon_social: 'Proveedor Integración SA de CV', nombre_comercial: 'Proveedor Integración', rfc: 'PIN010101AA1',
        contacto: 'Compras', telefono: '3312345678', email: 'compras@example.com', condiciones_pago: '30 días', dias_entrega: 3,
        calificacion: 4.5, notas: 'Fixture', activo: true, sucursal_ids: [11,22] };
      assert.equal((await catalogRequest(2, '/proveedores', 'POST', providerBody)).status, 403);
      const provider = await catalogRequest(1, '/proveedores', 'POST', providerBody);
      assert.equal(provider.status, 201, JSON.stringify(provider.body));
      assert.equal((await catalogRequest(2, '/proveedores')).body.total, 1);
      assert.equal((await catalogRequest(3, '/proveedores')).body.total, 1);
      const mapped = await catalogRequest(2, `/proveedores/${provider.body.id}/productos/1`, 'PUT', { sucursal_id: 11, sku_proveedor: 'SUP-TUB', costo_referencia: '20.000000', preferido: true });
      assert.equal(mapped.status, 200, JSON.stringify(mapped.body));
      const proposals = await catalogRequest(2, '/compras/propuestas');
      assert.equal(proposals.status, 200, JSON.stringify(proposals.body));
      assert.equal(proposals.body.items[0].proveedor_id, provider.body.id);
      const orderBody = { sucursal_id: 11, almacen_id: 1, proveedor_id: provider.body.id, condiciones_pago: '30 días', notas: 'Compra de prueba',
        detalles: [{ producto_id: 1, cantidad: '0.400000', costo_esperado: '20.000000' }] };
      const order = await catalogRequest(2, '/compras/ordenes', 'POST', orderBody);
      assert.equal(order.status, 201, JSON.stringify(order.body));
      assert.equal(order.body.estado, 'BORRADOR');
      assert.equal((await catalogRequest(2, `/compras/ordenes/${order.body.id}/acciones/solicitar`, 'POST', {})).body.estado, 'PENDIENTE_AUTORIZACION');
      assert.equal((await catalogRequest(2, `/compras/ordenes/${order.body.id}/acciones/autorizar`, 'POST', { password: testPassword, motivo: 'Intento' })).status, 403);
      assert.equal((await catalogRequest(1, `/compras/ordenes/${order.body.id}/acciones/autorizar`, 'POST', { password: 'incorrecta', motivo: 'Intento' })).status, 403);
      assert.equal((await catalogRequest(1, `/compras/ordenes/${order.body.id}/acciones/autorizar`, 'POST', { password: testPassword, motivo: 'Presupuesto aprobado' })).body.estado, 'AUTORIZADA');
      assert.equal((await catalogRequest(2, `/compras/ordenes/${order.body.id}/acciones/enviar`, 'POST', {})).body.estado, 'ENVIADA');
      const firstReceipt = { ubicacion_id: 1, factura_proveedor: 'FAC-COMPRA-1', idempotencia: 'purchase-receipt-000001',
        detalles: [{ orden_detalle_id: 1, cantidad: '0.150000', costo_real: '22.000000' }] };
      const partial = await catalogRequest(2, `/compras/ordenes/${order.body.id}/recepciones`, 'POST', firstReceipt);
      assert.equal(partial.status, 201, JSON.stringify(partial.body));
      assert.equal(partial.body.estado_orden, 'PARCIAL');
      assert.equal((await catalogRequest(3, `/compras/ordenes/${order.body.id}/recepciones`, 'POST', { ...firstReceipt, idempotencia: 'purchase-receipt-000002' })).status, 403);
      const excessive = await catalogRequest(2, `/compras/ordenes/${order.body.id}/recepciones`, 'POST', { ...firstReceipt, idempotencia: 'purchase-receipt-000003', detalles: [{ orden_detalle_id: 1, cantidad: '0.300000', costo_real: '24.000000' }] });
      assert.equal(excessive.status, 409);
      const finalReceipt = await catalogRequest(2, `/compras/ordenes/${order.body.id}/recepciones`, 'POST', { ...firstReceipt, factura_proveedor: 'FAC-COMPRA-2', idempotencia: 'purchase-receipt-000004', detalles: [{ orden_detalle_id: 1, cantidad: '0.250000', costo_real: '24.000000' }] });
      assert.equal(finalReceipt.status, 201, JSON.stringify(finalReceipt.body));
      assert.equal(finalReceipt.body.estado_orden, 'RECIBIDA');
      assert.equal((await catalogRequest(2, `/compras/ordenes/${order.body.id}/recepciones`, 'POST', { ...firstReceipt, factura_proveedor: 'FAC-COMPRA-2', idempotencia: 'purchase-receipt-000004', detalles: [{ orden_detalle_id: 1, cantidad: '0.250000', costo_real: '24.000000' }] })).status, 200);
      const [[stock]] = await pool.query('SELECT cantidad FROM inv_existencia WHERE producto_id=1 AND ubicacion_id=1');
      assert.equal(stock.cantidad, '1.650000');
      const report = await catalogRequest(2, '/compras/reporte?dias=90');
      assert.equal(report.status, 200, JSON.stringify(report.body));
      assert.equal(report.body.summary.recepciones, 2);
      assert.ok(Number(report.body.summary.variacion_total) > 0);
      assert.equal((await catalogRequest(1, `/proveedores/${provider.body.id}`, 'PUT', { ...providerBody, sucursal_ids: [22] })).status, 409);
    });
    await t.test('weekly blind cycle count captures evidence and sends differences for global approval', async () => {
      const cycle = await catalogRequest(2, '/conteos', 'POST', { sucursal_id: 11, almacen_id: 1, semana: '2026-09-21', zona: 'TODAS', cantidad_productos: 1 });
      assert.equal(cycle.status, 201, JSON.stringify(cycle.body));
      const listed = await catalogRequest(2, '/conteos');
      assert.equal(listed.status, 200, JSON.stringify(listed.body));
      const row = listed.body.items.find(item => item.id === cycle.body.id);
      assert.equal(row.detalles.length, 1);
      assert.equal(row.detalles[0].existencia_sistema, null);
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1sAAAAASUVORK5CYII=', 'base64');
      const evidenceResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/inventario/conteos/evidencias?sucursal_id=11`, { method: 'POST', headers: { Authorization: `Bearer ${signAccessToken({ sub: '2' })}`, 'Content-Type': 'image/png' }, body: png });
      assert.equal(evidenceResponse.status, 201);
      const evidence = await evidenceResponse.json();
      const captured = await catalogRequest(2, `/conteos/${cycle.body.id}/partidas/${row.detalles[0].id}`, 'PUT', { cantidad_contada: '1.500000', evidencia_url: evidence.evidencia_url, notas: 'Conteo con evidencia' });
      assert.equal(captured.status, 200, JSON.stringify(captured.body));
      const completed = await catalogRequest(2, `/conteos/${cycle.body.id}/completar`, 'POST', {});
      assert.equal(completed.status, 200, JSON.stringify(completed.body));
      assert.equal(completed.body.ajustes_pendientes, 1);
      const completedList = await catalogRequest(2, '/conteos?estado=COMPLETADO');
      const completedRow = completedList.body.items.find(item => item.id === cycle.body.id);
      assert.equal(completedRow.detalles[0].existencia_sistema, '1.650000');
      assert.equal(completedRow.detalles[0].ajuste_estado, 'PENDIENTE');
      assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api${evidence.evidencia_url}`, { headers: { Authorization: `Bearer ${signAccessToken({ sub: '3' })}` } })).status, 403);
      assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api${evidence.evidencia_url}`, { headers: { Authorization: `Bearer ${signAccessToken({ sub: '2' })}` } })).status, 200);
      const adjustmentId = completedRow.detalles[0].ajuste_solicitud_id;
      const approved = await catalogRequest(1, `/ajustes/${adjustmentId}/decision`, 'PUT', { aprobar: true, motivo: 'Conteo semanal validado', password: testPassword });
      assert.equal(approved.status, 200, JSON.stringify(approved.body));
      const [[adjustedStock]] = await pool.query('SELECT cantidad FROM inv_existencia WHERE producto_id=1 AND ubicacion_id=1');
      assert.equal(adjustedStock.cantidad, '1.500000');

      const stale = await catalogRequest(2, '/conteos', 'POST', { sucursal_id: 11, almacen_id: 1, semana: '2026-09-28', zona: 'A', cantidad_productos: 1 });
      assert.equal(stale.status, 201, JSON.stringify(stale.body));
      const staleList = await catalogRequest(2, '/conteos?estado=PROGRAMADO');
      const staleRow = staleList.body.items.find(item => item.id === stale.body.id);
      await catalogRequest(2, `/conteos/${stale.body.id}/partidas/${staleRow.detalles[0].id}`, 'PUT', { cantidad_contada: '1.500000', notas: 'Antes del movimiento' });
      await catalogRequest(2, '/movimientos', 'POST', { sucursal_id: 11, tipo: 'ENTRADA', motivo: 'Movimiento concurrente', idempotencia: 'cycle-count-concurrent-01', detalles: [{ producto_id: 1, almacen_id: 1, ubicacion_id: 1, cantidad: '0.100000', costo_unitario: '20.000000' }] });
      assert.equal((await catalogRequest(2, `/conteos/${stale.body.id}/completar`, 'POST', {})).status, 409);
      assert.equal((await catalogRequest(2, `/conteos/${stale.body.id}/cancelar`, 'POST', { password: testPassword, motivo: 'Reprogramar' })).status, 403);
      assert.equal((await catalogRequest(1, `/conteos/${stale.body.id}/cancelar`, 'POST', { password: testPassword, motivo: 'Existencia modificada' })).status, 200);
      const report = await catalogRequest(2, '/conteos-reporte?dias=365');
      assert.equal(report.status, 200, JSON.stringify(report.body));
      assert.equal(report.body.summary.conteos, 2);
    });
    const request = async (id, query = '') => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/inventario/acceso${query}`, {
        headers: id ? { Authorization: `Bearer ${signAccessToken({ sub: String(id) })}` } : {},
      });
      return { status: response.status, body: await response.json() };
    };
    await t.test('HTTP rejects unauthenticated users, agents and other branches', async () => {
      assert.equal((await request()).status, 401);
      for (const id of [4,5]) assert.equal((await request(id)).status, 403);
      assert.equal((await request(2, '?sucursal_id=22')).status, 403);
      assert.equal((await request(3, '?sucursal_id=11')).status, 403);
      assert.equal((await request(1, '?sucursal_id=999')).status, 400);
      assert.equal((await request(2)).status, 403);
      assert.equal((await request(3)).status, 403);
      assert.equal((await request(1)).body.sucursal_ids, null);
      assert.equal((await request(1, '?sucursal_id=22')).body.sucursal_id, 22);
      // Role changes are effective on the very next request, independent of JWT age.
      await pool.query('UPDATE usuario_rol SET rol_id=2 WHERE usuario_id=2');
      assert.equal((await request(2)).status, 403);
    });
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (pool) await pool.end();
    dbModule.pool = source;
    if (created && /^seep_test_inventory_\d+_\d+$/.test(schema) && schema !== config.database) {
      // The integration suite can outlive MySQL's idle timeout. Use a fresh
      // connection so cleanup does not depend on the original pool socket.
      const cleanup = await mysql.createConnection({ host: config.host, port: config.port, user: config.user,
        password: config.password, ssl: config.ssl || undefined });
      try { await cleanup.query(`DROP DATABASE ${mysql.escapeId(schema)}`); }
      finally { await cleanup.end(); }
    }
    await source.end();
    const path = require('node:path');
    if (path.dirname(photoDirectory) === path.resolve(require('node:os').tmpdir()) && path.basename(photoDirectory).startsWith('seep-inventory-photos-')) {
      await require('node:fs/promises').rm(photoDirectory, { recursive: true });
    }
    if (path.dirname(countEvidenceDirectory) === path.resolve(require('node:os').tmpdir()) && path.basename(countEvidenceDirectory).startsWith('seep-count-evidence-')) {
      await require('node:fs/promises').rm(countEvidenceDirectory, { recursive: true });
    }
  }
});
