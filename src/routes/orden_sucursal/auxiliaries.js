const { pool } = require('../../config/db');
const { createScopedOrderResource } = require('../../utils/scopedOrderResource');

module.exports = createScopedOrderResource({
  pool,
  table: 'orden_sucursal',
  selectFields: ["id","orden_id","sucursal_id","created_at"],
  insertFields: ["orden_id","sucursal_id"],
  updateFields: ["orden_id","sucursal_id"],
});
