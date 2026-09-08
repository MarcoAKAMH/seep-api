const { pool } = require('../../config/db');
const { createScopedOrderResource } = require('../../utils/scopedOrderResource');

module.exports = createScopedOrderResource({
  pool,
  table: 'orden_asignacion',
  selectFields: ["id","orden_id","empleado_id","rol_en_orden","created_at"],
  insertFields: ["orden_id","empleado_id","rol_en_orden"],
  updateFields: ["orden_id","empleado_id","rol_en_orden"],
});
