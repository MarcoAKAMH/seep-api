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
  orden_id: Joi.number().integer().min(1).max(MAX_ID).required(),
  empleado_id: Joi.number().integer().min(1).max(MAX_ID).required(),
  rol_en_orden: Joi.string().max(40).required(),
});

const update = Joi.object({
  orden_id: Joi.number().integer().min(1).max(MAX_ID).optional(),
  empleado_id: Joi.number().integer().min(1).max(MAX_ID).optional(),
  rol_en_orden: Joi.string().max(40).optional(),
}).min(1);

module.exports = { listQuery, create, update, idParam };
