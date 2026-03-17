const express = require('express');
const router = express.Router();
const { pool } = require('../../config/db');
const { required } = require('../../middleware/auth');

function currentYm() {
  const d = new Date();
  return { anio: d.getFullYear(), mes: d.getMonth() + 1 };
}

function countNonSundayDaysInMonth(anio, mes) {
  // mes: 1-12
  const daysInMonth = new Date(anio, mes, 0).getDate();
  let count = 0;
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dt = new Date(anio, mes - 1, day);
    if (dt.getDay() !== 0) count += 1; // 0 = Sunday
  }
  return count;
}

// GET /api/dashboard/summary
router.get('/summary', required, async (req, res, next) => {
  try {
    const [[clientesRow]] = await pool.query('SELECT COUNT(*) AS clientes FROM cliente');
    const [[ordenesRow]] = await pool.query('SELECT COUNT(*) AS ordenes FROM orden_trabajo');

    const [[moneyRow]] = await pool.query(`
      SELECT
        SUM(CASE WHEN IFNULL(facturado,0) = 1 THEN COALESCE(total,0) ELSE 0 END) AS facturado,
        SUM(CASE WHEN IFNULL(facturado,0) = 0 THEN COALESCE(total,0) ELSE 0 END) AS porFacturar
      FROM orden_trabajo
    `);

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

    const [recentOrders] = await pool.query(`
      SELECT
        ot.id,
        ot.folio,
        ot.fecha_ingreso,
        c.nombre AS cliente,
        COALESCE(ce.nombre, CONCAT('Estatus #', ot.estatus_id)) AS estatus,
        COALESCE(ot.total,0) AS total,
        IFNULL(ot.facturado,0) AS facturado
      FROM orden_trabajo ot
      JOIN cliente c ON c.id = ot.cliente_id
      LEFT JOIN cat_estatus_orden ce ON ce.id = ot.estatus_id
      ORDER BY ot.fecha_ingreso DESC, ot.id DESC
      LIMIT 10
    `);

    // Meta mensual (para el mes actual)
    const { anio, mes } = currentYm();
    const [[metaRow]] = await pool.query(
      'SELECT id, anio, mes, meta_pesos FROM meta_mensual WHERE anio = :anio AND mes = :mes LIMIT 1',
      { anio, mes }
    );

    const meta_pesos = Number(metaRow?.meta_pesos || 0);
    const dias_laborables = countNonSundayDaysInMonth(anio, mes);
    const meta_dia_pesos = dias_laborables > 0 ? (meta_pesos / dias_laborables) : 0;

    res.json({
      counts: {
        clientes: Number(clientesRow?.clientes ?? 0),
        ordenes: Number(ordenesRow?.ordenes ?? 0)
      },
      money: {
        facturado: Number(moneyRow?.facturado ?? 0),
        porFacturar: Number(moneyRow?.porFacturar ?? 0)
      },
      ordersByStatus: ordersByStatus.map((r) => ({
        estatus_id: Number(r.estatus_id),
        estatus: r.estatus,
        count: Number(r.count),
        total: Number(r.total)
      })),
      recentOrders: recentOrders.map((r) => ({
        id: Number(r.id),
        folio: r.folio,
        fecha_ingreso: r.fecha_ingreso,
        cliente: r.cliente,
        estatus: r.estatus,
        total: Number(r.total),
        facturado: Number(r.facturado)
      })),
      meta: {
        anio,
        mes,
        meta_pesos,
        dias_laborables,
        meta_dia_pesos,
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
