const router = require('express').Router();
const { pool } = require('../../config/db');
const { required } = require('../../middleware/auth');
const asyncHandler = require('../../utils/asyncHandler');
const { inventoryOnly, resolveInventoryScope } = require('../../utils/inventoryAccess');

router.use(required, inventoryOnly);
// Read-only inventory accounts may only consult product information, photographs and stock quantities.
router.use((req, res, next) => {
  if (!req.user.is_inventory_only || req.user.is_inventory_admin) return next();
  const readable = ['/acceso', '/catalogos', '/productos', '/existencias'].includes(req.path)
    || /^\/fotos\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(req.path);
  if (req.method === 'GET' && readable) return next();
  return res.status(403).json({ message: 'Este usuario solo puede consultar el catálogo, sus precios y las existencias.' });
});
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
