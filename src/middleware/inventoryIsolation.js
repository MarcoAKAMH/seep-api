// Mounted after auth and inventory: every other application endpoint is denied.
module.exports = function inventoryIsolation(req, res, next) {
  if (req.user?.is_inventory_only) {
    return res.status(403).json({ message: 'Este usuario solo puede acceder al módulo de inventario.' });
  }
  return next();
};
