const express = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const validate = require('../../middleware/validate');
const { required } = require('../../middleware/auth');
const v = require('./validators');
const aux = require('./auxiliaries');

const router = express.Router();

router.use(required);

router.get('/', validate(v.listQuery, 'query'), asyncHandler(async (req, res) => {
  const rows = await aux.list(req.query, req.user);
  res.json(rows);
}));

router.get('/:id', validate(v.idParam, 'params'), asyncHandler(async (req, res) => {
  const row = await aux.getById(Number(req.params.id), req.user);
  if (!row) return res.status(404).json({ message: 'No se encontro el recurso solicitado.' });
  res.json(row);
}));

router.post('/', validate(v.create), asyncHandler(async (req, res) => {
  const created = await aux.createOne(req.body, req.user);
  res.status(201).json(created);
}));

router.put('/:id', validate(v.idParam, 'params'), validate(v.update), asyncHandler(async (req, res) => {
  const updated = await aux.updateOne(Number(req.params.id), req.body, req.user);
  if (!updated) return res.status(404).json({ message: 'No se encontro el recurso solicitado.' });
  res.json(updated);
}));

router.delete('/:id', validate(v.idParam, 'params'), asyncHandler(async (req, res) => {
  const ok = await aux.removeOne(Number(req.params.id), req.user);
  if (!ok) return res.status(404).json({ message: 'No se encontro el recurso solicitado.' });
  res.status(204).send();
}));

module.exports = router;
