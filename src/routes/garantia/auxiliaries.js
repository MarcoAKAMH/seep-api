const { pool } = require('../../config/db');
const { createScopedOrderResource } = require('../../utils/scopedOrderResource');

module.exports = createScopedOrderResource({
  pool,
  table: 'garantia',
  selectFields: ["id","orden_id","ingreso_garantia_at","salida_garantia_at","dias_garantia","created_at"],
  insertFields: ["orden_id","ingreso_garantia_at","salida_garantia_at","dias_garantia"],
  updateFields: ["orden_id","ingreso_garantia_at","salida_garantia_at","dias_garantia"],
});
