const test = require('node:test');
const assert = require('node:assert/strict');

// Opt in: SEEP_MYSQL_TESTS=1 node --test test/mysql-access.test.js
// Creates an empty, uniquely named test database. Business data is never copied.
test('MySQL and HTTP integration: branch roles, users, orders and reports', { skip: process.env.SEEP_MYSQL_TESTS !== '1' }, async (t) => {
  const dotenv = require('dotenv');
  dotenv.config();
  dotenv.config({ path: '.env.local', override: true });
  const mysql = require('mysql2/promise');
  const dbModule = require('../src/config/db');
  const sourcePool = dbModule.pool;
  const config = sourcePool.pool.config.connectionConfig;
  const schema = `seep_test_scope_${Date.now()}_${process.pid}`;
  const quote = (name) => mysql.escapeId(name);
  let created = false;
  let pool;
  let server;
  try {
    await sourcePool.query(`CREATE DATABASE ${quote(schema)}`);
    created = true;
    pool = mysql.createPool({ host: config.host, port: config.port, user: config.user, password: config.password,
      ssl: config.ssl || undefined, database: schema, namedPlaceholders: true, connectionLimit: 4 });
    const tables = ['rol', 'rol_sucursal', 'usuario', 'usuario_rol', 'auth_refresh_token', 'cat_sucursal',
      'orden_trabajo', 'orden_sucursal', 'orden_asignacion', 'garantia', 'cliente', 'vehiculo', 'empleado',
      'cat_estatus_orden', 'cat_categoria_vehiculo', 'cat_tipo_material_suelto', 'meta_mensual', 'dia_festivo'];
    for (const table of tables) {
      await pool.query(`CREATE TABLE ${quote(table)} LIKE ${quote(config.database)}.${quote(table)}`);
    }
    dbModule.pool = pool;
    await pool.query("INSERT INTO rol (id,nombre) VALUES (1,'Administrador'),(2,'Agente El Salto'),(3,'Agente Chapala')");
    await pool.query("INSERT INTO cat_sucursal (id,nombre) VALUES (1,'Alameda'),(2,'Chapala')");
    await pool.query('INSERT INTO rol_sucursal (rol_id,sucursal_id) VALUES (2,1),(3,2)');

    await t.test('migration checks, applies and runs again without duplicating roles', async () => {
      const { migrateBranchAdmins } = require('../scripts/migrate-branch-admins');
      const db = await pool.getConnection();
      try {
        const planned = await migrateBranchAdmins(db, false);
        assert.deepEqual(planned.map((row) => row.sucursal_id), [1, 2]);
        assert.equal((await db.query('SELECT id FROM rol'))[0].length, 3);
        await migrateBranchAdmins(db, true);
        await migrateBranchAdmins(db, true);
        assert.equal((await db.query('SELECT id FROM rol'))[0].length, 5);
        assert.equal((await db.query('SELECT rol_id FROM rol_sucursal'))[0].length, 4);
        await db.query("UPDATE rol SET nombre='Unrelated role' WHERE id=4");
        await assert.rejects(migrateBranchAdmins(db, true), /otro rol/);
        await db.query("UPDATE rol SET nombre='Administrador Alameda' WHERE id=4");
      } finally { db.release(); }
    });

    const password = 'ScopedTestPassword123!';
    const passwordHash = await require('bcryptjs').hash(password, 4);
    for (let id = 1; id <= 10; id += 1) {
      await pool.query('INSERT INTO usuario (id,correo,nombre,password_hash,activo) VALUES (?,?,?,?,?)',
        [id, `test${id}@example.com`, `Test ${id}`, passwordHash, id === 8 ? 0 : 1]);
    }
    await pool.query('INSERT INTO usuario_rol (usuario_id,rol_id) VALUES (1,1),(2,4),(3,5),(4,2),(5,3),(6,2),(6,3),(8,4),(9,4),(9,3),(10,4)');
    await pool.query("INSERT INTO cliente (id,tipo_cliente_id,nombre) VALUES (1,1,'Client A'),(2,1,'Client B')");
    await pool.query("INSERT INTO cat_estatus_orden (id,nombre) VALUES (1,'Entregada')");
    await pool.query("INSERT INTO cat_categoria_vehiculo (id,nombre) VALUES (1,'Automovil'),(2,'Material suelto')");
    await pool.query("INSERT INTO cat_tipo_material_suelto (id,nombre) VALUES (1,'Pieza')");
    await pool.query("INSERT INTO vehiculo (id,cliente_id,categoria_id,marca) VALUES (1,1,1,'A'),(2,2,1,'B')");
    await pool.query("INSERT INTO empleado (id,nombre,clave_unica,comision_pct) VALUES (1,'Shared','T1',10),(2,'Partner','T2',20)");
    for (const [id, branch, amount] of [[1, 1, 300], [2, 2, 600], [3, 1, 90], [4, null, 50]]) {
      await pool.query('INSERT INTO orden_trabajo (id,cliente_id,vehiculo_id,estatus_id,fecha_ingreso,entrega_at,valor_mano_obra,valor_repuestos,total) VALUES (?,?,?,1,?,?,?,?,?)',
        [id, branch || 1, branch || 1, '2026-09-01 10:00:00', id === 3 ? '2026-09-02 02:00:00' : '2026-09-01 18:00:00', amount * 0.6, amount * 0.4, amount]);
      if (branch) await pool.query('INSERT INTO orden_sucursal (id,orden_id,sucursal_id) VALUES (?,?,?)', [id, id, branch]);
    }
    await pool.query("INSERT INTO orden_asignacion (id,orden_id,empleado_id,rol_en_orden) VALUES (1,1,1,'reparador'),(2,1,1,'desmonte'),(3,1,2,'reparador'),(4,2,1,'reparador'),(5,3,1,'reparador')");
    await pool.query('INSERT INTO garantia (id,orden_id) VALUES (1,1),(2,2)');
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use('/api', require('../src/routes'));
    app.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.message, code: error.code }));
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const { signAccessToken } = require('../src/config/jwt');
    async function request(userId, path, method = 'GET', body) {
      const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signAccessToken({ sub: String(userId) })}` }, body: body ? JSON.stringify(body) : undefined });
      const data = response.status === 204 ? null : await response.json();
      return { status: response.status, data };
    }
    const ids = (rows) => rows.map((row) => Number(row.id));

    await t.test('login and refresh include branch capabilities; disabled accounts and agents are denied', async () => {
      const login = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo: 'test2@example.com', password }) });
      assert.equal(login.status, 200);
      const session = await login.json();
      assert.equal(session.user.can_manage_users, true);
      assert.equal(session.user.is_admin, false);
      assert.deepEqual(session.user.allowed_sucursal_ids, [1]);
      const refreshed = await fetch(base + '/auth/refresh', { method: 'POST', headers: { Cookie: login.headers.get('set-cookie').split(';')[0] } });
      assert.equal(refreshed.status, 200);
      assert.equal((await refreshed.json()).user.can_view_reports, true);
      for (const userId of [4, 5, 6, 7, 9]) {
        assert.equal((await request(userId, '/reports/summary')).status, 403);
        assert.equal((await request(userId, '/usuario')).status, 403);
      }
      assert.equal((await request(8, '/orden_trabajo')).status, 401);
    });

    await t.test('manager lists are scoped before pagination and restrict role catalogs', async () => {
      assert.deepEqual(ids((await request(2, '/usuario')).data), [2, 4, 8, 10]);
      assert.deepEqual(ids((await request(3, '/usuario')).data), [3, 5]);
      assert.deepEqual(ids((await request(2, '/usuario?limit=1&offset=1')).data), [4]);
      assert.deepEqual(ids((await request(2, '/rol')).data), [2, 4]);
      assert.deepEqual(ids((await request(3, '/rol')).data), [3, 5]);
      assert.equal((await request(2, '/rol/1')).status, 404);
      assert.equal((await request(1, '/usuario')).data.length, 10);
      assert.equal((await request(1, '/rol')).data.length, 5);
    });

    await t.test('branch managers create/update/delete same-branch users and cannot affect other accounts', async () => {
      let counter = 0;
      const payload = (role_ids) => ({ correo: `created${++counter}@example.com`, nombre: 'Created', password, role_ids });
      for (const roleId of [1, 2, 3, 4, 5]) {
        const result = await request(1, '/usuario', 'POST', payload([roleId]));
        assert.equal(result.status, 201, JSON.stringify(result));
        assert.equal((await request(1, `/usuario/${result.data.id}`, 'DELETE')).status, 204);
      }
      for (const [manager, agent, admin] of [[2, 2, 4], [3, 3, 5]]) {
        const result = await request(manager, '/usuario', 'POST', payload([agent]));
        assert.equal(result.status, 201, JSON.stringify(result));
        const url = `/usuario/${result.data.id}`;
        assert.equal((await request(manager, url, 'PUT', { role_ids: [admin] })).status, 200);
        assert.equal((await request(manager, url, 'PUT', { password: 'ReplacementPassword123!' })).status, 200);
        assert.equal((await request(manager, url, 'DELETE')).status, 204);
      }
      for (const role_ids of [[1], [3], [5], [2, 3]]) assert.equal((await request(2, '/usuario', 'POST', payload(role_ids))).status, 403);
      for (const target of [1, 3, 5, 6, 7, 9]) {
        assert.equal((await request(2, `/usuario/${target}`)).status, 404);
        assert.equal((await request(2, `/usuario/${target}`, 'PUT', { password: 'Unauthorized123!' })).status, 404);
        assert.equal((await request(2, `/usuario/${target}`, 'PUT', { role_ids: [2] })).status, 404);
        assert.equal((await request(2, `/usuario/${target}`, 'DELETE')).status, 404);
      }
      assert.equal((await request(2, '/usuario/4', 'PUT', { role_ids: [1] })).status, 403);
      assert.equal((await request(2, '/usuario_rol', 'POST', { usuario_id: 4, rol_id: 1 })).status, 403);
      assert.equal((await request(1, '/usuario_rol', 'POST', { usuario_id: 2, rol_id: 3 })).status, 400);
      assert.equal((await request(1, '/usuario_rol/4/2', 'PUT', { rol_id: 4 })).status, 200);
      assert.equal((await request(1, '/usuario_rol/4/4', 'PUT', { rol_id: 2 })).status, 200);
    });

    await t.test('order and child endpoints reject foreign reads, writes and transfers', async () => {
      assert.deepEqual(ids((await request(2, '/orden_trabajo')).data), [1, 3]);
      assert.deepEqual(ids((await request(3, '/orden_trabajo')).data), [2]);
      assert.deepEqual(ids((await request(1, '/orden_trabajo?sucursal_id=2')).data), [2]);
      assert.deepEqual(ids((await request(2, '/orden_trabajo?limit=1&offset=1')).data), [3]);
      assert.equal((await request(2, '/orden_trabajo/2')).status, 404);
      assert.equal((await request(2, '/orden_trabajo/1', 'PUT', { sucursal_id: 2 })).status, 403);
      assert.equal((await request(2, '/orden_trabajo/2', 'DELETE')).status, 404);
      assert.equal((await request(2, '/orden_sucursal/2', 'PUT', { sucursal_id: 1 })).status, 403);
      assert.equal((await request(2, '/cat_sucursal/2', 'PUT', { nombre: 'Forbidden' })).status, 403);
      assert.deepEqual(ids((await request(2, '/orden_asignacion')).data), [1, 2, 3, 5]);
      assert.equal((await request(2, '/orden_asignacion/4')).status, 404);
      assert.equal((await request(2, '/orden_asignacion/1', 'PUT', { orden_id: 2 })).status, 403);
      assert.equal((await request(2, '/orden_asignacion', 'POST', { orden_id: 2, empleado_id: 1, rol_en_orden: 'reparador' })).status, 403);
      assert.deepEqual(ids((await request(2, '/garantia')).data), [1]);
      assert.equal((await request(2, '/garantia/2', 'DELETE')).status, 404);
      assert.equal((await request(2, '/garantia/1', 'PUT', { orden_id: 2 })).status, 403);
      const own = await request(2, '/garantia', 'POST', { orden_id: 3 });
      assert.equal(own.status, 201, JSON.stringify(own));
      assert.equal((await request(2, `/garantia/${own.data.id}`, 'DELETE')).status, 204);
      const body = { cliente_id: 1, estatus_id: 1, fecha_ingreso: '2026-09-01T10:00:00Z', sucursal_id: 1, tipo_reparacion_id: 2, tipo_material_suelto: 'Pieza' };
      const order = await request(2, '/orden_trabajo', 'POST', body);
      assert.equal(order.status, 201, JSON.stringify(order));
      assert.equal((await request(2, `/orden_trabajo/${order.data.id}`, 'DELETE')).status, 204);
      assert.equal((await request(2, '/orden_trabajo', 'POST', { ...body, sucursal_id: 2 })).status, 403);
    });

    await t.test('all report endpoints apply scope, preserve totals, local dates and participant shares', async () => {
      const range = 'inicio=2026-09-01&fin=2026-09-01';
      const urls = ['/reports/summary', `/reports/ventas_totales?${range}`, `/reports/resultado_trabajadores?${range}`, '/reports/resultado_trabajadores/details?empleado_id=1&fecha=2026-09-01'];
      for (const url of urls) {
        const separator = url.includes('?') ? '&' : '?';
        assert.equal((await request(2, `${url}${separator}sucursal_id=2`)).status, 403);
        assert.equal((await request(1, `${url}${separator}sucursal_id=999`)).status, 400);
        assert.equal((await request(1, `${url}${separator}sucursal_id=all`)).status, 400);
        const local = await request(2, url);
        assert.equal(local.status, 200, JSON.stringify(local));
        assert.equal(local.data.params.sucursal_id, 1);
        assert.equal((await request(1, url)).data.params.sucursal_id, null);
      }
      const salesTotal = (report) => report.categorias.reduce((sum, category) => sum + category.totals.total_reparacion, 0);
      assert.equal(salesTotal((await request(1, urls[1])).data), 1040);
      assert.equal(salesTotal((await request(2, urls[1])).data), 390);
      assert.equal(salesTotal((await request(3, urls[1])).data), 600);
      for (const [base, factor] of [['total', 1], ['mano_obra', 0.6], ['repuestos', 0.4]]) {
        const result = (await request(2, `${urls[2]}&base=${base}`)).data;
        const worker = result.trabajadores.find((row) => row.empleado_id === 1);
        assert.ok(Math.abs(worker.totals.productividad - 290 * factor) < 0.00001);
        assert.ok(Math.abs(worker.totals.comision - 29 * factor) < 0.00001);
        const detail = (await request(2, `${urls[3]}&base=${base}`)).data;
        assert.deepEqual(detail.orders.map((row) => row.orden_id).sort(), [1, 3]);
        assert.ok(Math.abs(detail.orders.reduce((sum, row) => sum + row.share, 0) - worker.totals.productividad) < 0.00001);
      }
      const global = (await request(1, '/reports/summary')).data;
      const local = (await request(2, '/reports/summary')).data;
      assert.equal(global.ordersByStatus[0].count, 4);
      assert.equal(local.ordersByStatus[0].count, 2);
      const empty = await request(2, '/reports/resultado_trabajadores?inicio=2001-01-01&fin=2001-01-01');
      assert.deepEqual(empty.data.trabajadores, []);
    });
  } finally {
    if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    if (pool) await pool.end();
    dbModule.pool = sourcePool;
    // Only this exact database created by this run can be removed.
    if (created && /^seep_test_scope_\d+_\d+$/.test(schema) && schema !== config.database) {
      await sourcePool.query(`DROP DATABASE ${quote(schema)}`);
    }
    await sourcePool.end();
  }
});
