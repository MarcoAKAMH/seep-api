const Joi = require('joi');

const MAX_ID = 9007199254740991;

const listQuery = Joi.object({
  limit: Joi.number().integer().min(1).max(200).default(50),
  offset: Joi.number().integer().min(0).default(0),
});

const idParam = Joi.object({
  id: Joi.number().integer().min(1).max(MAX_ID).required(),
});

const create = Joi.object({
  nombre: Joi.string().max(120).required(),
  activo: Joi.boolean().truthy(1).falsy(0).optional(),
  comision_pct: Joi.number().min(0).max(100).precision(2).optional(),
});

const update = Joi.object({
  nombre: Joi.string().max(120).optional(),
  activo: Joi.boolean().truthy(1).falsy(0).optional(),
  comision_pct: Joi.number().min(0).max(100).precision(2).optional(),
}).min(1);

module.exports = { listQuery, create, update, idParam };
