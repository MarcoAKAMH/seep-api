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
  recomendaria: Joi.string().max(20).allow(null).optional(),
  nps: Joi.number().integer().min(-9007199254740991).max(MAX_ID).allow(null).optional(),
  calidad_id: Joi.number().integer().min(1).max(MAX_ID).allow(null).optional(),
});

const update = Joi.object({
  orden_id: Joi.number().integer().min(1).max(MAX_ID).optional(),
  recomendaria: Joi.string().max(20).allow(null).optional(),
  nps: Joi.number().integer().min(-9007199254740991).max(MAX_ID).allow(null).optional(),
  calidad_id: Joi.number().integer().min(1).max(MAX_ID).allow(null).optional(),
}).min(1);

module.exports = { listQuery, create, update, idParam };
