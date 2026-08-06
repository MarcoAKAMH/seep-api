function normalizeVehiclePlate(value) {
  if (typeof value !== 'string') return value;
  return value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
}

function createVehiclePlateConflictError(placas, clienteNombre) {
  return Object.assign(
    new Error(`La placa ${placas} ya pertenece al cliente ${clienteNombre || 'otro cliente'}. Captura una placa distinta.`),
    { status: 409 }
  );
}

async function findVehiclePlateConflict(db, placas, excludedVehicleId) {
  const placasNormalizadas = normalizeVehiclePlate(placas);
  if (!placasNormalizadas) return null;

  const params = { placas: placasNormalizadas };
  let sql = `SELECT v.id, c.nombre AS cliente_nombre
    FROM vehiculo v
    INNER JOIN cliente c ON c.id = v.cliente_id
    WHERE v.placas = :placas`;

  if (excludedVehicleId) {
    sql += ' AND v.id != :id';
    params.id = excludedVehicleId;
  }

  sql += ' LIMIT 1';
  const [rows] = await db.query(sql, params);
  return rows[0] || null;
}

async function assertVehiclePlateIsUnique(db, placas, excludedVehicleId) {
  const placasNormalizadas = normalizeVehiclePlate(placas);
  if (!placasNormalizadas) return placasNormalizadas;

  const conflict = await findVehiclePlateConflict(db, placasNormalizadas, excludedVehicleId);
  if (conflict) {
    throw createVehiclePlateConflictError(placasNormalizadas, conflict.cliente_nombre);
  }

  return placasNormalizadas;
}

async function rethrowDuplicateVehiclePlateError(db, err, placas, excludedVehicleId) {
  if (err?.code !== 'ER_DUP_ENTRY') throw err;

  const conflict = await findVehiclePlateConflict(db, placas, excludedVehicleId);
  throw createVehiclePlateConflictError(
    normalizeVehiclePlate(placas),
    conflict?.cliente_nombre
  );
}

module.exports = {
  assertVehiclePlateIsUnique,
  normalizeVehiclePlate,
  rethrowDuplicateVehiclePlateError,
};
