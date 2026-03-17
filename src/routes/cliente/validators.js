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
  tipo_cliente_id: Joi.number().integer().min(1).max(MAX_ID).required(),
  nombre: Joi.string().max(180).required(),
  clave_unica: Joi.string().max(400).required(),
});

const update = Joi.object({
  tipo_cliente_id: Joi.number().integer().min(1).max(MAX_ID).optional(),
  nombre: Joi.string().max(180).optional(),
  clave_unica: Joi.string().max(400).optional(),
}).min(1);

module.exports = { listQuery, create, update, idParam };
