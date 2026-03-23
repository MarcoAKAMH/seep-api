const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { pool } = require('../../config/db');
const { required, adminOnly } = require('../../middleware/auth');
const validate = require('../../middleware/validate');
const asyncHandler = require('../../utils/asyncHandler');

router.use(required, adminOnly);

// GET /api/reports/summary
router.get('/summary', async (req, res, next) => {
  try {
    const [ordersByStatus] = await pool.query(`
      SELECT
        ot.estatus_id AS estatus_id,
        COALESCE(ce.nombre, CONCAT('Estatus #', ot.estatus_id)) AS estatus,
        COUNT(*) AS count,
        COALESCE(SUM(ot.total),0) AS total
      FROM orden_trabajo ot
      LEFT JOIN cat_estatus_orden ce ON ce.id = ot.estatus_id
      GROUP BY ot.estatus_id, estatus
      ORDER BY count DESC
    `);

    const [monthly] = await pool.query(`
      SELECT
        DATE_FORMAT(fecha_ingreso, '%Y-%m') AS ym,
        COUNT(*) AS count,
        COALESCE(SUM(total),0) AS total
      FROM orden_trabajo
      GROUP BY ym
      ORDER BY ym DESC
      LIMIT 12
    `);

    const [topClients] = await pool.query(`
      SELECT
        c.id AS cliente_id,
        c.nombre AS cliente,
        COUNT(ot.id) AS ordenes,
        COALESCE(SUM(ot.total),0) AS total
      FROM cliente c
      JOIN orden_trabajo ot ON ot.cliente_id = c.id
      GROUP BY c.id, c.nombre
      ORDER BY ordenes DESC, total DESC
      LIMIT 10
    `);

    res.json({
      ordersByStatus: ordersByStatus.map((r) => ({
        estatus_id: Number(r.estatus_id),
        estatus: r.estatus,
        count: Number(r.count),
        total: Number(r.total)
      })),
      monthly: monthly
        .map((r) => ({ ym: r.ym, count: Number(r.count), total: Number(r.total) }))
        .reverse(),
      topClients: topClients.map((r) => ({
        cliente_id: Number(r.cliente_id),
        cliente: r.cliente,
        ordenes: Number(r.ordenes),
        total: Number(r.total)
      }))
    });
  } catch (err) {
    next(err);
  }
});

const ventasTotalesQuery = Joi.object({
  inicio: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  fin: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  meta: Joi.number().min(0).precision(2).default(0),
});

// GET /api/reports/ventas_totales?inicio=YYYY-MM-DD&fin=YYYY-MM-DD&meta=1234.56
// Nota: devuelve SOLO días con ventas (como el Excel).
router.get('/ventas_totales', validate(ventasTotalesQuery, 'query'), asyncHandler(async (req, res) => {
  const inicio = String(req.query.inicio);
  const fin = String(req.query.fin);
  const meta = Number(req.query.meta || 0);

  const [rows] = await pool.query(
    `SELECT
        DATE(ot.entrega_at) AS fecha,
        COALESCE(ccv.nombre, 'SIN CATEGORIA') AS tipo,
        SUM(COALESCE(ot.valor_mano_obra,0)) AS mano_obra,
        SUM(COALESCE(ot.valor_repuestos,0)) AS repuestos,
        SUM(COALESCE(ot.total,0)) AS total_reparacion
      FROM orden_trabajo ot
      LEFT JOIN vehiculo v ON v.id = ot.vehiculo_id
      LEFT JOIN cat_categoria_vehiculo ccv ON ccv.id = v.categoria_id
      WHERE ot.entrega_at IS NOT NULL
        AND DATE(ot.entrega_at) >= :inicio
        AND DATE(ot.entrega_at) <= :fin
      GROUP BY tipo, fecha
      ORDER BY tipo ASC, fecha ASC`,
    { inicio, fin }
  );

  const byTipo = new Map();
  for (const r of rows) {
    const tipo = String(r.tipo);
    if (!byTipo.has(tipo)) byTipo.set(tipo, []);
    byTipo.get(tipo).push({
      fecha: String(r.fecha).slice(0, 10),
      mano_obra: Number(r.mano_obra || 0),
      repuestos: Number(r.repuestos || 0),
      total_reparacion: Number(r.total_reparacion || 0),
    });
  }

  const categorias = Array.from(byTipo.entries()).map(([tipo, list]) => {
    const rowsOut = list.map((x) => {
      const cumplimiento = meta > 0 ? (x.mano_obra / meta) : 0;
      return { ...x, meta, cumplimiento };
    });

    const totalMano = rowsOut.reduce((acc, x) => acc + x.mano_obra, 0);
    const totalRep = rowsOut.reduce((acc, x) => acc + x.repuestos, 0);
    const totalRepn = rowsOut.reduce((acc, x) => acc + x.total_reparacion, 0);
    const totalMeta = meta * rowsOut.length;
    const promedioCumplimiento = rowsOut.length ? (rowsOut.reduce((acc, x) => acc + x.cumplimiento, 0) / rowsOut.length) : 0;

    return {
      tipo,
      rows: rowsOut,
      totals: {
        mano_obra: totalMano,
        repuestos: totalRep,
        total_reparacion: totalRepn,
        meta: totalMeta,
        cumplimiento_promedio: promedioCumplimiento,
      },
    };
  });

  res.json({
    params: { inicio, fin, meta },
    categorias,
  });
}));

const trabajadoresQuery = Joi.object({
  inicio: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  fin: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  meta: Joi.number().min(0).precision(2).default(0),
  dias: Joi.number().integer().min(1).max(31).default(6),
});

function ymd(dt) {
  return dt.toISOString().slice(0, 10);
}

function enumerateDates(inicio, fin) {
  const start = new Date(`${inicio}T00:00:00`);
  const end = new Date(`${fin}T00:00:00`);
  const out = [];
  const d = new Date(start);
  while (d.getTime() <= end.getTime()) {
    out.push(ymd(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function calcPromedioCumplimiento(rows, meta, dias) {
  if (!meta || meta <= 0) return 0;
  const list = [];
  for (const r of rows) {
    if (r.productividad > 0) {
      list.push(r.productividad / meta);
    } else if (list.length < dias) {
      list.push(0);
    }
  }
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i] === 0 && list.length > dias) list.splice(i, 1);
  }
  if (!list.length) return 0;
  return list.reduce((a, b) => a + b, 0) / list.length;
}

// GET /api/reports/resultado_trabajadores?inicio=YYYY-MM-DD&fin=YYYY-MM-DD&meta=1000&dias=6
router.get('/resultado_trabajadores', validate(trabajadoresQuery, 'query'), asyncHandler(async (req, res) => {
  const inicio = String(req.query.inicio);
  const fin = String(req.query.fin);
  const meta = Number(req.query.meta || 0);
  const dias = Number(req.query.dias || 6);

  // Traemos por asignación (1 fila = 1 participación del empleado en la orden)
  const [rows] = await pool.query(
    `SELECT
      DATE(ot.entrega_at) AS fecha,
      ot.id AS orden_id,
      COALESCE(ot.total,0) AS total_venta,
      oa.empleado_id AS empleado_id
    FROM orden_trabajo ot
    JOIN orden_asignacion oa ON oa.orden_id = ot.id
    WHERE ot.entrega_at IS NOT NULL
      AND DATE(ot.entrega_at) >= :inicio
      AND DATE(ot.entrega_at) <= :fin
      AND COALESCE(ot.total,0) > 0`,
    { inicio, fin }
  );

  // order -> { fecha, total_venta, countsByEmpleado }
  const orders = new Map();
  for (const r of rows) {
    const orden_id = Number(r.orden_id);
    const fecha = String(r.fecha).slice(0, 10);
    const total_venta = Number(r.total_venta || 0);
    const empleado_id = Number(r.empleado_id);
    if (!orders.has(orden_id)) {
      orders.set(orden_id, { fecha, total_venta, counts: new Map(), totalCount: 0 });
    }
    const o = orders.get(orden_id);
    o.totalCount += 1;
    o.counts.set(empleado_id, (o.counts.get(empleado_id) || 0) + 1);
  }

  // empleado -> fecha -> { productividad, trabajos }
  const agg = new Map();
  for (const [, o] of orders.entries()) {
    if (!o.totalCount) continue;
    for (const [empleado_id, count] of o.counts.entries()) {
      const share = o.total_venta * (count / o.totalCount);
      if (!agg.has(empleado_id)) agg.set(empleado_id, new Map());
      const byFecha = agg.get(empleado_id);
      if (!byFecha.has(o.fecha)) byFecha.set(o.fecha, { productividad: 0, trabajos: 0 });
      const cell = byFecha.get(o.fecha);
      cell.productividad += share;
      cell.trabajos += count;
    }
  }

  const empleadoIds = Array.from(agg.keys());
  if (empleadoIds.length === 0) {
    return res.json({ params: { inicio, fin, meta, dias }, trabajadores: [] });
  }

  const [emps] = await pool.query(
    `SELECT id, nombre, COALESCE(comision_pct,0) AS comision_pct
     FROM empleado
     WHERE id IN (${empleadoIds.map((id) => Number(id)).join(',')})`
  );
  const empById = new Map(emps.map((e) => [Number(e.id), { nombre: e.nombre, comision_pct: Number(e.comision_pct || 0) }]));

  const fechas = enumerateDates(inicio, fin);

  const trabajadores = empleadoIds
    .map((empleado_id) => {
      const info = empById.get(empleado_id) || { nombre: `Empleado #${empleado_id}`, comision_pct: 0 };
      const byFecha = agg.get(empleado_id) || new Map();
      const rowsOut = fechas.map((f) => {
        const cell = byFecha.get(f) || { productividad: 0, trabajos: 0 };
        const productividad = Number(cell.productividad || 0);
        const trabajos = Number(cell.trabajos || 0);
        const cumplimiento = meta > 0 ? (productividad / meta) : 0;
        const comision = productividad * (info.comision_pct / 100);
        return { fecha: f, productividad, meta, cumplimiento, trabajos, comision };
      });

      const totalVenta = rowsOut.reduce((acc, x) => acc + x.productividad, 0);
      const totalMeta = meta * rowsOut.length;
      const totalTrabajos = rowsOut.reduce((acc, x) => acc + x.trabajos, 0);
      const totalComision = rowsOut.reduce((acc, x) => acc + x.comision, 0);
      const promedio = calcPromedioCumplimiento(rowsOut, meta, dias);

      return {
        empleado_id,
        nombre: info.nombre,
        comision_pct: info.comision_pct,
        rows: rowsOut,
        totals: {
          productividad: totalVenta,
          meta: totalMeta,
          cumplimiento_promedio: promedio,
          trabajos: totalTrabajos,
          comision: totalComision,
        },
      };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  res.json({ params: { inicio, fin, meta, dias }, trabajadores });
}));

module.exports = router;
