const test = require('node:test');
const assert = require('node:assert/strict');
const { photosSchema, productPhotos, updatedProductPhotos, serializeProductPhotos } = require('../src/utils/productPhotos');
const { migrateInventoryPhotos } = require('../scripts/migrate-inventory-photos');
const photos = Array.from({ length: 10 }, (_, i) => `https://example.com/${i}.jpg`);

test('gallery accepts ten unique photos and rejects invalid or oversized galleries', () => {
  assert.equal(photosSchema.validate(photos).error, undefined);
  for (const invalid of [[...photos, 'https://example.com/11.jpg'], [photos[0], photos[0]], ['http://example.com/a.jpg'], ['/etc/passwd'], [null]]) assert.ok(photosSchema.validate(invalid).error);
  assert.equal(photosSchema.validate([]).error, undefined);
});
test('legacy covers survive edits and explicit empty galleries stay empty', () => {
  assert.deepEqual(productPhotos({ foto_url: photos[0], fotos: null }), [photos[0]]);
  assert.deepEqual(updatedProductPhotos({ fotos: JSON.stringify(photos) }, {}), photos);
  assert.deepEqual(updatedProductPhotos({ fotos: photos }, { foto_url: photos[0] }), photos);
  assert.deepEqual(updatedProductPhotos({ fotos: photos }, { fotos: [] }), []);
  assert.deepEqual(updatedProductPhotos({ fotos: photos }, { foto_url: null }), photos.slice(1));
  assert.equal(serializeProductPhotos({ fotos: [], foto_url: photos[0] }).foto_url, null);
  assert.equal(serializeProductPhotos({ fotos: photos.slice(1) }).foto_url, photos[1]);
});
test('gallery migration is idempotent, preserves legacy rows and releases its lock', async () => {
  let added = false; const calls = [];
  const db = { query: async sql => {
    calls.push(sql);
    if (sql.includes('SELECT DATABASE')) return [[{ name: 'test_photos' }]];
    if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
    if (sql.includes('information_schema')) return [added ? [{ DATA_TYPE: 'json' }] : []];
    if (sql.startsWith('ALTER')) added = true;
    return [[]];
  } };
  assert.equal((await migrateInventoryPhotos(db)).status, 'pending');
  assert.equal(added, false);
  assert.equal((await migrateInventoryPhotos(db, true)).status, 'applied');
  assert.equal((await migrateInventoryPhotos(db, true)).status, 'already_applied');
  assert.equal(calls.filter(sql => sql.startsWith('ALTER')).length, 1);
  assert.equal(calls.filter(sql => sql.includes('RELEASE_LOCK')).length, 2);
  assert.ok(!calls.some(sql => sql.startsWith('UPDATE inv_producto')));
});

test('photo deletion locks the product, preserves other photos and enforces permission', async () => {
  const { pool } = require('../src/config/db');
  const original = pool.getConnection;
  let allowed = true, commits = 0, audits = 0, acquired = 0;
  let record = { id: 1, foto_url: photos[0], fotos: JSON.stringify(photos) };
  pool.getConnection = async () => { acquired++; return {
    beginTransaction: async () => {}, commit: async () => { commits++; }, rollback: async () => {}, release: () => {},
    query: async (sql, args) => {
      if (sql.startsWith('SELECT * FROM inv_producto')) { assert.match(sql, /FOR UPDATE/); return [[record]]; }
      if (sql.startsWith('UPDATE inv_producto')) { record = { id: args[2], fotos: args[0], foto_url: args[1] }; return [{}]; }
      if (sql.includes('INSERT INTO inv_auditoria')) { audits++; return [{}]; }
      throw Error('Unexpected SQL');
    },
  }; };
  const express = require('express'), app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { sub: '1', can_manage_inventory_catalog: allowed }; next(); });
  app.use(require('../src/routes/inventario/catalog'));
  app.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.message }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const remove = foto_url => fetch(`http://127.0.0.1:${server.address().port}/productos/1/fotos`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ foto_url }) });
  try {
    allowed = false; const denied = await remove(photos[0]); assert.equal(denied.status, 403); await denied.arrayBuffer(); assert.equal(acquired, 0);
    allowed = true; const result = await remove(photos[0]); assert.equal(result.status, 200);
    assert.deepEqual((await result.json()).fotos, photos.slice(1)); assert.equal(record.foto_url, photos[1]);
    assert.equal(commits, 1); assert.equal(audits, 1);
    const invalid = await remove('javascript:alert(1)'); assert.equal(invalid.status, 400); await invalid.arrayBuffer(); assert.equal(acquired, 1);
    record = { id: 1, foto_url: photos[0], fotos: null };
    const last = await remove(photos[0]); assert.equal(last.status, 200); assert.deepEqual((await last.json()).fotos, []); assert.equal(record.foto_url, null);
    const setCover = foto_url => fetch(`http://127.0.0.1:${server.address().port}/productos/1/foto-principal`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ foto_url }) });
    const empty = await setCover(photos[0]); assert.equal(empty.status, 409); await empty.arrayBuffer();
    record = { id: 1, fotos: JSON.stringify(photos), foto_url: photos[0] };
    allowed = false; const deniedCover = await setCover(photos[4]); assert.equal(deniedCover.status, 403); await deniedCover.arrayBuffer();
    allowed = true; const cover = await setCover(photos[4]); assert.equal(cover.status, 200);
    const changed = await cover.json(); assert.equal(changed.foto_url, photos[4]);
    assert.deepEqual(changed.fotos, [photos[4], ...photos.filter(photo => photo !== photos[4])]);
    const stale = await setCover('https://example.com/missing.jpg'); assert.equal(stale.status, 409); await stale.arrayBuffer();
    assert.equal(record.foto_url, photos[4]); assert.equal(JSON.parse(record.fotos).length, 10);
  } finally { pool.getConnection = original; await new Promise(resolve => server.close(resolve)); }
});
