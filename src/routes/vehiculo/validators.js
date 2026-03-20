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
  cliente_id: Joi.number().integer().min(1).max(MAX_ID).required(),
  marca: Joi.string().max(60).allow(null).optional(),
  modelo_marca: Joi.string().max(100).allow(null).optional(),
  placas: Joi.string().max(30).allow(null).optional(),
  unidad_vin: Joi.string().max(60).allow(null).optional(),
  anio: Joi.number().integer().min(1900).max(2100).allow(null).optional(),
  categoria_id: Joi.number().integer().min(1).max(MAX_ID).allow(null).optional(),
});

const update = Joi.object({
  cliente_id: Joi.number().integer().min(1).max(MAX_ID).optional(),
  marca: Joi.string().max(60).allow(null).optional(),
  modelo_marca: Joi.string().max(100).allow(null).optional(),
  placas: Joi.string().max(30).allow(null).optional(),
  unidad_vin: Joi.string().max(60).allow(null).optional(),
  anio: Joi.number().integer().min(1900).max(2100).allow(null).optional(),
  categoria_id: Joi.number().integer().min(1).max(MAX_ID).allow(null).optional(),
}).min(1);

module.exports = { listQuery, create, update, idParam };
