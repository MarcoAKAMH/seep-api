const express = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const validate = require('../../middleware/validate');
const { required } = require('../../middleware/auth');
const v = require('./validators');
const aux = require('./auxiliaries');

const router = express.Router();

router.use(required);

router.get('/', validate(v.listQuery, 'query'), asyncHandler(async (req, res) => {
  const rows = await aux.list(req.query);
  res.json(rows);
}));

router.get('/:usuario_id/:rol_id', validate(v.keyParams, 'params'), asyncHandler(async (req, res) => {
  const row = await aux.getByKey({ usuario_id: Number(req.params.usuario_id), rol_id: Number(req.params.rol_id) });
  if (!row) return res.status(404).json({ message: 'Not found' });
  res.json(row);
}));

router.post('/', validate(v.create), asyncHandler(async (req, res) => {
  const created = await aux.createOne(req.body);
  res.status(201).json(created);
}));

router.put('/:usuario_id/:rol_id', validate(v.keyParams, 'params'), validate(v.update), asyncHandler(async (req, res) => {
  const keys = { usuario_id: Number(req.params.usuario_id), rol_id: Number(req.params.rol_id) };
  const updated = await aux.updateOne(keys, req.body);
  res.json(updated);
}));

router.delete('/:usuario_id/:rol_id', validate(v.keyParams, 'params'), asyncHandler(async (req, res) => {
  const keys = { usuario_id: Number(req.params.usuario_id), rol_id: Number(req.params.rol_id) };
  const ok = await aux.removeOne(keys);
  if (!ok) return res.status(404).json({ message: 'Not found' });
  res.status(204).send();
}));

module.exports = router;
