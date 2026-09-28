const router = require('express').Router();
const { pool } = require('../../config/db');
const { required } = require('../../middleware/auth');
const asyncHandler = require('../../utils/asyncHandler');
const { inventoryOnly, resolveInventoryScope } = require('../../utils/inventoryAccess');

router.use(required, inventoryOnly);
// Foundation endpoint; no stock mutation endpoints exist until the movement engine is ready.
router.get('/acceso', asyncHandler(async (req, res) => {
  const scope = await resolveInventoryScope(req.user, req.query.sucursal_id, pool);
  res.json({
    sucursal_id: scope.sucursalId,
    sucursal_ids: scope.sucursalIds,
    can_manage_inventory: true,
    can_manage_inventory_catalog: Boolean(req.user.can_manage_inventory_catalog),
    can_authorize_inventory_adjustments: Boolean(req.user.can_authorize_inventory_adjustments),
  });
}));

router.use(require('./photos'));
router.use(require('./movements'));
router.use(require('./controls'));
router.use(require('./reports'));
router.use(require('./purchasing'));
router.use(require('./cycleCounts'));
router.use(require('./catalog'));

module.exports = router;
