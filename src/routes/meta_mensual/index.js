const express = require('express');
const Joi = require('joi');

const { pool } = require('../../config/db');
const { required, adminOnly } = require('../../middleware/auth');
const validate = require('../../middleware/validate');
const asyncHandler = require('../../utils/asyncHandler');

const router = express.Router();
router.use(required, adminOnly);

function currentYm() {
  const d = new Date();
  const anio = d.getFullYear();
  const mes = d.getMonth() + 1; // 1-12
  return { anio, mes };
}

const upsertSchema = Joi.object({
  meta_pesos: Joi.number().min(0).precision(2).required(),
});

// GET /api/meta_mensual/current
router.get('/current', asyncHandler(async (req, res) => {
  const { anio, mes } = currentYm();
  const [[row]] = await pool.query(
    'SELECT id, anio, mes, meta_pesos, created_at, updated_at FROM meta_mensual WHERE anio = :anio AND mes = :mes LIMIT 1',
    { anio, mes }
  );

  if (row) return res.json({ ...row, meta_pesos: Number(row.meta_pesos || 0) });

  // Create default if missing
  const [ins] = await pool.query(
    'INSERT INTO meta_mensual (anio, mes, meta_pesos) VALUES (:anio, :mes, 0)',
    { anio, mes }
  );
  const [[created]] = await pool.query(
    'SELECT id, anio, mes, meta_pesos, created_at, updated_at FROM meta_mensual WHERE id = :id LIMIT 1',
    { id: ins.insertId }
  );
  return res.json({ ...created, meta_pesos: Number(created.meta_pesos || 0) });
}));

// PUT /api/meta_mensual/current
router.put('/current', validate(upsertSchema), asyncHandler(async (req, res) => {
  const { anio, mes } = currentYm();
  const { meta_pesos } = req.body;

  await pool.query(
    `INSERT INTO meta_mensual (anio, mes, meta_pesos)
     VALUES (:anio, :mes, :meta_pesos)
     ON DUPLICATE KEY UPDATE meta_pesos = VALUES(meta_pesos), updated_at = CURRENT_TIMESTAMP`,
    { anio, mes, meta_pesos }
  );

  const [[row]] = await pool.query(
    'SELECT id, anio, mes, meta_pesos, created_at, updated_at FROM meta_mensual WHERE anio = :anio AND mes = :mes LIMIT 1',
    { anio, mes }
  );

  res.json({ ...row, meta_pesos: Number(row?.meta_pesos || 0) });
}));

module.exports = router;
