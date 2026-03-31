const express = require('express');
const router = express.Router();
const { pool } = require('../../config/db');
const { required } = require('../../middleware/auth');

function currentDateParts() {
  const d = new Date();
  return { anio: d.getFullYear(), mes: d.getMonth() + 1, dia: d.getDate() };
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

async function countNonSundayHolidaysInMonth(anio, mes) {
  const [[row]] = await pool.query(
    `SELECT COUNT(DISTINCT fecha) AS total
       FROM dia_festivo
      WHERE YEAR(fecha) = :anio
        AND MONTH(fecha) = :mes
        AND DAYOFWEEK(fecha) <> 1`,
    { anio, mes }
  );

  return Number(row?.total ?? 0);
}

function getAllowedSucursalIds(user) {
  return Array.isArray(user?.allowed_sucursal_ids)
    ? user.allowed_sucursal_ids.map((id) => Number(id)).filter(Boolean)
    : [];
}

// GET /api/dashboard/summary
router.get('/summary', required, async (req, res, next) => {
  try {
    const canViewAllOrders = Boolean(req.user?.is_admin || req.user?.can_view_all_orders);
    const allowedSucursalIds = getAllowedSucursalIds(req.user);
    const shouldRestrictOrders = !canViewAllOrders;
    const hasOrderAccess = canViewAllOrders || allowedSucursalIds.length > 0;

    const [[clientesRow]] = await pool.query('SELECT COUNT(*) AS clientes FROM cliente');
    const [[ordenesRow]] = hasOrderAccess
      ? await pool.query(
          shouldRestrictOrders
            ? `SELECT COUNT(*) AS ordenes
                 FROM orden_trabajo ot
                 INNER JOIN orden_sucursal os ON os.orden_id = ot.id
                WHERE os.sucursal_id IN (?)`
            : 'SELECT COUNT(*) AS ordenes FROM orden_trabajo',
          shouldRestrictOrders ? [allowedSucursalIds] : [],
        )
      : [[{ ordenes: 0 }]];

    const [[moneyRow]] = hasOrderAccess
      ? await pool.query(
          shouldRestrictOrders
            ? `SELECT
                 SUM(CASE WHEN IFNULL(ot.facturado,0) = 1 THEN COALESCE(ot.total,0) ELSE 0 END) AS facturado,
                 SUM(CASE WHEN IFNULL(ot.facturado,0) = 0 THEN COALESCE(ot.total,0) ELSE 0 END) AS porFacturar
               FROM orden_trabajo ot
               INNER JOIN orden_sucursal os ON os.orden_id = ot.id
               WHERE os.sucursal_id IN (?)`
            : `SELECT
                 SUM(CASE WHEN IFNULL(facturado,0) = 1 THEN COALESCE(total,0) ELSE 0 END) AS facturado,
                 SUM(CASE WHEN IFNULL(facturado,0) = 0 THEN COALESCE(total,0) ELSE 0 END) AS porFacturar
               FROM orden_trabajo`,
          shouldRestrictOrders ? [allowedSucursalIds] : [],
        )
      : [[{ facturado: 0, porFacturar: 0 }]];

    const { anio, mes, dia } = currentDateParts();

    const [[deliveredMonthRow]] = hasOrderAccess
      ? await pool.query(
          shouldRestrictOrders
            ? `SELECT COALESCE(SUM(ot.total), 0) AS acumulado
                 FROM orden_trabajo ot
                 INNER JOIN orden_sucursal os ON os.orden_id = ot.id
                WHERE os.sucursal_id IN (?)
                  AND ot.entrega_at IS NOT NULL
                  AND YEAR(ot.entrega_at) = ?
                  AND MONTH(ot.entrega_at) = ?`
            : `SELECT COALESCE(SUM(total), 0) AS acumulado
                 FROM orden_trabajo
                WHERE entrega_at IS NOT NULL
                  AND YEAR(entrega_at) = ?
                  AND MONTH(entrega_at) = ?`,
          shouldRestrictOrders
            ? [allowedSucursalIds, anio, mes]
            : [anio, mes],
        )
      : [[{ acumulado: 0 }]];

    const [[deliveredDayRow]] = hasOrderAccess
      ? await pool.query(
          shouldRestrictOrders
            ? `SELECT COALESCE(SUM(ot.total), 0) AS acumulado
                 FROM orden_trabajo ot
                 INNER JOIN orden_sucursal os ON os.orden_id = ot.id
                WHERE os.sucursal_id IN (?)
                  AND ot.entrega_at IS NOT NULL
                  AND YEAR(ot.entrega_at) = ?
                  AND MONTH(ot.entrega_at) = ?
                  AND DAY(ot.entrega_at) = ?`
            : `SELECT COALESCE(SUM(total), 0) AS acumulado
                 FROM orden_trabajo
                WHERE entrega_at IS NOT NULL
                  AND YEAR(entrega_at) = ?
                  AND MONTH(entrega_at) = ?
                  AND DAY(entrega_at) = ?`,
          shouldRestrictOrders
            ? [allowedSucursalIds, anio, mes, dia]
            : [anio, mes, dia],
        )
      : [[{ acumulado: 0 }]];

    const [ordersByStatus] = hasOrderAccess
      ? await pool.query(
          shouldRestrictOrders
            ? `SELECT
                 ot.estatus_id AS estatus_id,
                 COALESCE(ce.nombre, CONCAT('Estatus #', ot.estatus_id)) AS estatus,
                 COUNT(*) AS count,
                 COALESCE(SUM(ot.total),0) AS total
               FROM orden_trabajo ot
               INNER JOIN orden_sucursal os ON os.orden_id = ot.id
               LEFT JOIN cat_estatus_orden ce ON ce.id = ot.estatus_id
               WHERE os.sucursal_id IN (?)
               GROUP BY ot.estatus_id, estatus
               ORDER BY count DESC`
            : `SELECT
                 ot.estatus_id AS estatus_id,
                 COALESCE(ce.nombre, CONCAT('Estatus #', ot.estatus_id)) AS estatus,
                 COUNT(*) AS count,
                 COALESCE(SUM(ot.total),0) AS total
               FROM orden_trabajo ot
               LEFT JOIN cat_estatus_orden ce ON ce.id = ot.estatus_id
               GROUP BY ot.estatus_id, estatus
               ORDER BY count DESC`,
          shouldRestrictOrders ? [allowedSucursalIds] : [],
        )
      : [[]];

    const [recentOrders] = hasOrderAccess
      ? await pool.query(
          shouldRestrictOrders
            ? `SELECT
                 ot.id,
                 ot.fecha_ingreso,
                 c.nombre AS cliente,
                 COALESCE(ce.nombre, CONCAT('Estatus #', ot.estatus_id)) AS estatus,
                 COALESCE(ot.total,0) AS total,
                 IFNULL(ot.facturado,0) AS facturado
               FROM orden_trabajo ot
               INNER JOIN orden_sucursal os ON os.orden_id = ot.id
               JOIN cliente c ON c.id = ot.cliente_id
               LEFT JOIN cat_estatus_orden ce ON ce.id = ot.estatus_id
               WHERE os.sucursal_id IN (?)
               ORDER BY ot.fecha_ingreso DESC, ot.id DESC
               LIMIT 10`
            : `SELECT
                 ot.id,
                 ot.fecha_ingreso,
                 c.nombre AS cliente,
                 COALESCE(ce.nombre, CONCAT('Estatus #', ot.estatus_id)) AS estatus,
                 COALESCE(ot.total,0) AS total,
                 IFNULL(ot.facturado,0) AS facturado
               FROM orden_trabajo ot
               JOIN cliente c ON c.id = ot.cliente_id
               LEFT JOIN cat_estatus_orden ce ON ce.id = ot.estatus_id
               ORDER BY ot.fecha_ingreso DESC, ot.id DESC
               LIMIT 10`,
          shouldRestrictOrders ? [allowedSucursalIds] : [],
        )
      : [[]];

    // Meta mensual (para el mes actual)
    const [[metaRow]] = await pool.query(
      'SELECT id, anio, mes, meta_pesos FROM meta_mensual WHERE anio = :anio AND mes = :mes LIMIT 1',
      { anio, mes }
    );

    const meta_pesos = Number(metaRow?.meta_pesos || 0);
    const diasBase = countNonSundayDaysInMonth(anio, mes);
    const diasFestivos = await countNonSundayHolidaysInMonth(anio, mes);
    const dias_laborables = Math.max(0, diasBase - diasFestivos);
    const meta_dia_pesos = dias_laborables > 0 ? (meta_pesos / dias_laborables) : 0;
    const acumulado_entregadas_pesos = Number(deliveredMonthRow?.acumulado || 0);
    const cumplimiento_meta_pct = meta_pesos > 0 ? (acumulado_entregadas_pesos / meta_pesos) : 0;
    const restante_meta_pesos = Math.max(0, meta_pesos - acumulado_entregadas_pesos);
    const acumulado_entregadas_hoy_pesos = Number(deliveredDayRow?.acumulado || 0);
    const cumplimiento_meta_dia_pct = meta_dia_pesos > 0 ? (acumulado_entregadas_hoy_pesos / meta_dia_pesos) : 0;
    const restante_meta_dia_pesos = Math.max(0, meta_dia_pesos - acumulado_entregadas_hoy_pesos);

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
        acumulado_entregadas_pesos,
        cumplimiento_meta_pct,
        restante_meta_pesos,
        acumulado_entregadas_hoy_pesos,
        cumplimiento_meta_dia_pct,
        restante_meta_dia_pesos,
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
