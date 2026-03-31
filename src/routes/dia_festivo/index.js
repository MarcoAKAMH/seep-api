const express = require('express');
const Joi = require('joi');

const { pool } = require('../../config/db');
const { required, adminOnly } = require('../../middleware/auth');
const validate = require('../../middleware/validate');
const asyncHandler = require('../../utils/asyncHandler');

const router = express.Router();
router.use(required, adminOnly);

const listQuery = Joi.object({
  year: Joi.number().integer().min(2000).max(2100).optional(),
  month: Joi.number().integer().min(1).max(12).optional(),
});

const idParam = Joi.object({
  id: Joi.number().integer().min(1).max(9007199254740991).required(),
});

const createSchema = Joi.object({
  fecha: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  descripcion: Joi.string().max(180).allow('', null).default(null),
});

const updateSchema = Joi.object({
  fecha: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional(),
  descripcion: Joi.string().max(180).allow('', null).optional(),
}).min(1);

function currentYm() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function monthRange(year, month) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  const ymd = (dt) => dt.toISOString().slice(0, 10);
  return { start: ymd(start), end: ymd(end) };
}

router.get('/', validate(listQuery, 'query'), asyncHandler(async (req, res) => {
  const year = Number(req.query.year || 0) || currentYm().year;
  const month = Number(req.query.month || 0) || currentYm().month;
  const { start, end } = monthRange(year, month);

  const [rows] = await pool.query(
    `SELECT id, fecha, descripcion, created_at, updated_at
     FROM dia_festivo
     WHERE fecha >= :start AND fecha <= :end
     ORDER BY fecha ASC`,
    { start, end }
  );

  res.json(rows);
}));

router.get('/:id', validate(idParam, 'params'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [[row]] = await pool.query(
    'SELECT id, fecha, descripcion, created_at, updated_at FROM dia_festivo WHERE id = :id LIMIT 1',
    { id }
  );
  if (!row) return res.status(404).json({ message: 'No se encontró el recurso solicitado.' });
  res.json(row);
}));

router.post('/', validate(createSchema), asyncHandler(async (req, res) => {
  const { fecha, descripcion } = req.body;
  try {
    const [result] = await pool.query(
      'INSERT INTO dia_festivo (fecha, descripcion) VALUES (:fecha, :descripcion)',
      { fecha, descripcion }
    );
    const [[row]] = await pool.query(
      'SELECT id, fecha, descripcion, created_at, updated_at FROM dia_festivo WHERE id = :id LIMIT 1',
      { id: result.insertId }
    );
    res.status(201).json(row);
  } catch (err) {
    // Duplicate date
    if (err && (err.code === 'ER_DUP_ENTRY' || err.errno === 1062)) {
      return res.status(409).json({ message: 'Ya existe un día festivo con esa fecha.' });
    }
    throw err;
  }
}));

router.put('/:id', validate(idParam, 'params'), validate(updateSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { fecha, descripcion } = req.body;

  const fields = [];
  const params = { id };
  if (typeof fecha !== 'undefined') {
    fields.push('fecha = :fecha');
    params.fecha = fecha;
  }
  if (typeof descripcion !== 'undefined') {
    fields.push('descripcion = :descripcion');
    params.descripcion = descripcion;
  }
  if (!fields.length) return res.status(400).json({ message: 'No se enviaron datos para actualizar.' });

  try {
    const [result] = await pool.query(
      `UPDATE dia_festivo SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = :id`,
      params
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'No se encontró el recurso solicitado.' });

    const [[row]] = await pool.query(
      'SELECT id, fecha, descripcion, created_at, updated_at FROM dia_festivo WHERE id = :id LIMIT 1',
      { id }
    );
    res.json(row);
  } catch (err) {
    if (err && (err.code === 'ER_DUP_ENTRY' || err.errno === 1062)) {
      return res.status(409).json({ message: 'Ya existe un día festivo con esa fecha.' });
    }
    throw err;
  }
}));

router.delete('/:id', validate(idParam, 'params'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [result] = await pool.query('DELETE FROM dia_festivo WHERE id = :id', { id });
  if (result.affectedRows === 0) return res.status(404).json({ message: 'No se encontró el recurso solicitado.' });
  res.status(204).send();
}));

module.exports = router;
