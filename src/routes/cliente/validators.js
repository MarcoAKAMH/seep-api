const Joi = require('joi');

const MAX_ID = 9007199254740991;

const listQuery = Joi.object({
  limit: Joi.number().integer().min(1).max(200).default(50),
  offset: Joi.number().integer().min(0).default(0),
});

const idParam = Joi.object({
  id: Joi.number().integer().min(1).max(MAX_ID).required(),
});

const vehiculoItem = Joi.object({
  id: Joi.number().integer().min(1).max(MAX_ID).optional(),
  marca: Joi.string().max(60).required(),
  modelo_marca: Joi.string().max(100).required(),
  placas: Joi.string().max(30).required(),
  unidad_vin: Joi.string().max(60).required(),
  anio: Joi.number().integer().min(1900).max(2100).allow(null).optional(),
  categoria_id: Joi.number().integer().min(1).max(MAX_ID).required(),
});

const create = Joi.object({
  tipo_cliente_id: Joi.number().integer().min(1).max(MAX_ID).required(),
  nombre: Joi.string().max(180).required(),
  nombre_encargado: Joi.string().max(180).allow(null, '').optional(),
  telefono: Joi.string().max(30).required(),
  correo: Joi.string().email().max(150).allow(null, '').optional(),
  vehiculos: Joi.array().items(vehiculoItem).required(),
});

const update = Joi.object({
  tipo_cliente_id: Joi.number().integer().min(1).max(MAX_ID).optional(),
  nombre: Joi.string().max(180).optional(),
  nombre_encargado: Joi.string().max(180).allow(null, '').optional(),
  telefono: Joi.string().max(30).optional(),
  correo: Joi.string().email().max(150).allow(null, '').optional(),
  vehiculos: Joi.array().items(vehiculoItem).optional(),
}).min(1);

module.exports = { listQuery, create, update, idParam };
