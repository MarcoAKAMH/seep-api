// Imports the CAD_pro sheet as controlled test data through the inventory movement engine.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

function args() {
  const values = process.argv.slice(2);
  const value = name => { const i = values.indexOf(name); return i >= 0 ? values[i + 1] : undefined; };
  return { apply: values.includes('--apply'), file: value('--file'), branch: Number(value('--sucursal') || 1), user: Number(value('--usuario') || 1) };
}
const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
const number = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed.toFixed(6) : null;
};
function category(name) {
  const n = name.toUpperCase();
  if (/RAD\.|RADIADOR|POSTENFRI|ENFRIADOR|CONDENSADOR/.test(n)) return 'Radiadores y enfriamiento';
  if (/TUBO|CODO|COPLE|REDUCTOR|CONO|FLEXIBLE/.test(n)) return 'Tubería y conexiones';
  if (/MOFLE|SILENCIADOR|ESCAPE|CATALIZADOR|CONVERTIDOR/.test(n)) return 'Escape';
  if (/DISCO|SOLDAD|FUNDENTE|PLASTIACERO|CARDA|ELECTRODO/.test(n)) return 'Consumibles de taller';
  if (/TAPON|MANGUERA|ABRAZADERA|GOMA|HULE/.test(n)) return 'Accesorios';
  return 'Importado Excel — por clasificar';
}
function productType(name, categoryName) {
  return categoryName === 'Consumibles de taller' || /ANTICONGEL|REFRIGERANTE|ACEITE/.test(name.toUpperCase()) ? 'CONSUMIBLE' : 'PRODUCTO_TERMINADO';
}
function prepare(workbook) {
  const sheet = workbook.sheets.find(item => item.name === 'CAD_pro');
  if (!sheet) throw new Error('No se encontró la hoja CAD_pro.');
  const cell = (row, column) => normalize(row.cells[`${column}${row.row}`]);
  const source = sheet.rows.filter(row => row.row > 5 && (cell(row, 'C') || cell(row, 'D') || cell(row, 'G'))).map(row => ({
    row: row.row, sku: cell(row, 'C'), name: cell(row, 'D'), min: number(cell(row, 'E')), max: number(cell(row, 'F')),
    quantity: number(cell(row, 'G')), cost: number(cell(row, 'H')), provider: cell(row, 'I'),
  })).filter(row => row.name && row.name !== '#REF!' && row.name !== 'System.Xml.XmlElement');
  const groups = new Map();
  for (const row of source) {
    const generated = row.sku || `XLS-ALM-FILA-${row.row}`;
    const key = normalize(generated).toUpperCase();
    const current = groups.get(key) || [];
    current.push({ ...row, sku: generated }); groups.set(key, current);
  }
  const records = [];
  const pending = [];
  for (const [key, rows] of groups) {
    const duplicate = rows.length > 1;
    const bestName = [...rows].sort((a, b) => b.name.length - a.name.length)[0].name;
    const last = field => [...rows].reverse().find(row => row[field] !== null && row[field] !== '')?.[field] ?? null;
    const categoryName = category(bestName);
    const record = { sku: key.slice(0, 80), name: bestName, category: categoryName, type: productType(bestName, categoryName),
      quantity: last('quantity'), cost: last('cost'), min: last('min'), max: last('max'), provider: last('provider'), rows: rows.map(row => row.row), duplicate };
    records.push(record);
    if (duplicate) pending.push({ sku: key, reason: 'Código repetido; el catálogo se consolida, pero su cantidad inicial no se importa.', rows: record.rows });
    else if (Number(record.quantity) > 0 && record.cost === null) pending.push({ sku: key, reason: 'Cantidad con costo vacío; no se importa la existencia inicial.', rows: record.rows, quantity: record.quantity });
  }
  return { records, pending, sourceRows: sheet.rows.length };
}

async function run() {
  const options = args();
  if (!options.file || !Number.isSafeInteger(options.branch) || options.branch <= 0 || !Number.isSafeInteger(options.user) || options.user <= 0) {
    throw new Error('Uso: node scripts/import-inventory-workbook.js --file archivo.xlsx --sucursal 1 --usuario 1 [--apply]');
  }
  const json = path.join(os.tmpdir(), `seep-inventory-${process.pid}-${Date.now()}.json`);
  const reader = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'read-inventory-workbook.ps1'), '-InputFile', path.resolve(options.file), '-OutputFile', json], { encoding: 'utf8', windowsHide: true });
  if (reader.status !== 0) throw new Error(reader.stderr || 'No se pudo leer el Excel.');
  const workbook = JSON.parse(fs.readFileSync(json, 'utf8'));
  fs.rmSync(json, { force: true });
  const prepared = prepare(workbook);
  const eligibleStock = prepared.records.filter(row => !row.duplicate && Number(row.quantity) > 0 && row.cost !== null);
  const summary = { mode: options.apply ? 'apply' : 'preview', file: workbook.file, sha256: workbook.sha256, branch: options.branch,
    catalogProducts: prepared.records.length, openingStockProducts: eligibleStock.length, pendingReview: prepared.pending.length,
    categories: [...new Set(prepared.records.map(row => row.category))], samplePending: prepared.pending.slice(0, 20) };
  if (!options.apply) { console.log(JSON.stringify(summary, null, 2)); return; }
  require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
  require('dotenv').config({ path: path.resolve(__dirname, '../.env.local'), override: true });
  const { pool } = require('../src/config/db');
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [[branch]] = await db.query('SELECT id,nombre FROM cat_sucursal WHERE id=? FOR UPDATE', [options.branch]);
    if (!branch) throw new Error('La sucursal no existe.');
    const [[user]] = await db.query('SELECT id,nombre FROM usuario WHERE id=? AND activo=1 FOR UPDATE', [options.user]);
    if (!user) throw new Error('El usuario de importación no existe o está inactivo.');
    const [prior] = await db.query(`SELECT id FROM inv_auditoria WHERE entidad='inv_importacion' AND JSON_UNQUOTE(JSON_EXTRACT(despues,'$.sha256'))=? LIMIT 1`, [workbook.sha256]);
    if (prior.length) throw new Error('Este archivo ya fue importado; no se duplicó información.');
    const [units] = await db.query("SELECT id FROM inv_unidad WHERE clave='PZA' LIMIT 1 FOR UPDATE");
    let unitId = units[0]?.id;
    if (!unitId) unitId = (await db.query("INSERT INTO inv_unidad(clave,nombre,decimales) VALUES ('PZA','Pieza / presentación',0)"))[0].insertId;
    const categoryIds = new Map();
    for (const name of summary.categories) {
      const [rows] = await db.query('SELECT id FROM inv_categoria WHERE nombre=? LIMIT 1 FOR UPDATE', [name]);
      const categoryId = rows[0]?.id || (await db.query('INSERT INTO inv_categoria(nombre) VALUES (?)', [name]))[0].insertId;
      categoryIds.set(name, categoryId);
    }
    const [warehouses] = await db.query("SELECT id FROM inv_almacen WHERE sucursal_id=? AND nombre='Almacén de prueba Excel' LIMIT 1 FOR UPDATE", [options.branch]);
    const warehouseId = warehouses[0]?.id || (await db.query("INSERT INTO inv_almacen(sucursal_id,nombre) VALUES (?,'Almacén de prueba Excel')", [options.branch]))[0].insertId;
    const [locations] = await db.query("SELECT id FROM inv_ubicacion WHERE almacen_id=? AND codigo='XLS-SIN-UBICAR' LIMIT 1 FOR UPDATE", [warehouseId]);
    const locationId = locations[0]?.id || (await db.query("INSERT INTO inv_ubicacion(almacen_id,sucursal_id,codigo,descripcion) VALUES (?,?,'XLS-SIN-UBICAR','Datos de prueba importados; ubicación física pendiente')", [warehouseId, options.branch]))[0].insertId;
    for (let start = 0; start < prepared.records.length; start += 200) {
      const part = prepared.records.slice(start, start + 200);
      await db.query(`INSERT IGNORE INTO inv_producto(sku,nombre_comercial,nombre_tecnico,categoria_id,unidad_id,tipo,creado_por) VALUES ?`,
        [part.map(row => [row.sku, row.name.slice(0, 180), row.name.slice(0, 255), categoryIds.get(row.category), unitId, row.type, options.user])]);
    }
    const productIds = new Map();
    for (let start = 0; start < prepared.records.length; start += 500) {
      const part = prepared.records.slice(start, start + 500);
      const [products] = await db.query('SELECT id,sku FROM inv_producto WHERE sku IN (?) FOR UPDATE', [part.map(row => row.sku)]);
      products.forEach(row => productIds.set(row.sku, Number(row.id)));
    }
    if (productIds.size !== prepared.records.length) throw new Error('No fue posible relacionar todos los códigos importados.');
    for (let start = 0; start < prepared.records.length; start += 200) {
      const part = prepared.records.slice(start, start + 200);
      await db.query(`INSERT INTO inv_producto_almacen(producto_id,almacen_id,sucursal_id,minimo,maximo,punto_reorden) VALUES ?
        ON DUPLICATE KEY UPDATE minimo=VALUES(minimo),maximo=VALUES(maximo),punto_reorden=VALUES(punto_reorden)`, [part.map(row => {
        const minimum = row.min || '0.000000';
        const maximum = row.max !== null && Number(row.max) >= Number(minimum) ? row.max : minimum;
        return [productIds.get(row.sku), warehouseId, options.branch, minimum, maximum, minimum];
      })]);
      await db.query(`INSERT INTO inv_auditoria(sucursal_id,usuario_id,accion,entidad,entidad_id,despues,motivo) VALUES ?`, [part.map(row => [
        options.branch, options.user, 'IMPORTAR_EXCEL', 'inv_producto', productIds.get(row.sku),
        JSON.stringify({ archivo: workbook.file, sha256: workbook.sha256, filas: row.rows, proveedor_fuente: row.provider, unidad_provisional: 'PZA' }), 'Datos de prueba desde Excel',
      ])]);
    }
    for (let start = 0; start < eligibleStock.length; start += 200) {
      const requested = eligibleStock.slice(start, start + 200);
      const ids = requested.map(row => productIds.get(row.sku));
      const [existingStock] = await db.query('SELECT producto_id FROM inv_existencia WHERE sucursal_id=? AND producto_id IN (?) FOR UPDATE', [options.branch, ids]);
      const occupied = new Set(existingStock.map(row => Number(row.producto_id)));
      const part = requested.filter(row => !occupied.has(productIds.get(row.sku)));
      if (!part.length) continue;
      const idempotency = `xlsx:${workbook.sha256.slice(0, 48)}:${start}`;
      const [document] = await db.query(`INSERT INTO inv_documento
        (sucursal_id,folio,tipo,estado,motivo,referencia,idempotencia,creado_por,aplicado_por,fecha_operacion,aplicado_at)
        VALUES (?,?,'INICIAL','APLICADO',?,?,?,?,?,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))`, [options.branch,
        `INI-XLS-${workbook.sha256.slice(0, 8)}-${start}`, 'Carga inicial de prueba desde Excel; validar físicamente',
        `${workbook.file} (${start + 1}-${start + part.length})`, idempotency, options.user, options.user]);
      const documentId = document.insertId;
      await db.query(`INSERT INTO inv_documento_detalle(documento_id,sucursal_id,producto_id,almacen_id,ubicacion_id,cantidad,costo_unitario) VALUES ?`,
        [part.map(row => [documentId, options.branch, productIds.get(row.sku), warehouseId, locationId, row.quantity, row.cost])]);
      await db.query(`INSERT INTO inv_existencia(producto_id,ubicacion_id,almacen_id,sucursal_id,cantidad,ultimo_movimiento_at) VALUES ?`,
        [part.map(row => [productIds.get(row.sku), locationId, warehouseId, options.branch, row.quantity, new Date()])]);
      await db.query(`INSERT INTO inv_costo_sucursal(producto_id,sucursal_id,costo_promedio,ultimo_costo) VALUES ?
        ON DUPLICATE KEY UPDATE costo_promedio=VALUES(costo_promedio),ultimo_costo=VALUES(ultimo_costo)`,
        [part.map(row => [productIds.get(row.sku), options.branch, row.cost, row.cost])]);
      const [details] = await db.query('SELECT id,producto_id,cantidad,costo_unitario FROM inv_documento_detalle WHERE documento_id=?', [documentId]);
      await db.query(`INSERT INTO inv_movimiento(detalle_id,sucursal_id,producto_id,ubicacion_id,almacen_id,cantidad_delta,costo_unitario,saldo_posterior,costo_promedio_posterior,usuario_id) VALUES ?`,
        [details.map(row => [row.id, options.branch, row.producto_id, locationId, warehouseId, row.cantidad, row.costo_unitario, row.cantidad, row.costo_unitario, options.user])]);
    }
    const [audit] = await db.query(`INSERT INTO inv_auditoria(sucursal_id,usuario_id,accion,entidad,entidad_id,despues,motivo)
      VALUES (?,?,'IMPORTAR_EXCEL','inv_importacion',?,?,?)`, [options.branch, options.user, options.branch,
      JSON.stringify({ ...summary, sha256: workbook.sha256, pending: prepared.pending }), 'Importación de datos de prueba']);
    await db.commit();
    console.log(JSON.stringify({ ...summary, status: 'applied', auditId: Number(audit.insertId), warehouseId: Number(warehouseId), locationId: Number(locationId) }, null, 2));
  } catch (error) { await db.rollback(); throw error; }
  finally { db.release(); await pool.end(); }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
