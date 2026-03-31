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
  sucursal_id: Joi.number().integer().min(1).max(MAX_ID).required(),
  vehiculo_id: Joi.number().integer().min(1).max(MAX_ID).allow(null).optional(),
  kilometraje: Joi.number().integer().min(0).allow(null).optional(),
  estatus_id: Joi.number().integer().min(1).max(MAX_ID).required(),
  fecha_ingreso: Joi.date().iso().required(),
  fecha_entrega_estimada: Joi.date().iso().allow(null).optional(),
  servicio: Joi.string().allow(null).optional(),
  inicio_reparacion_at: Joi.date().iso().allow(null).optional(),
  entrega_at: Joi.date().iso().allow(null).optional(),
  valor_mano_obra: Joi.number().precision(2).optional(),
  valor_repuestos: Joi.number().precision(2).optional(),
  facturado: Joi.boolean().truthy(1).falsy(0).optional(),
  horas_reparacion: Joi.number().precision(2).allow(null).optional(),
  dias_reparacion: Joi.number().precision(2).allow(null).optional(),
  tipo_reparacion_id: Joi.number().integer().min(1).max(MAX_ID).allow(null).optional(),
  total: Joi.number().precision(2).allow(null).optional(),
  tecnicos_reparadores_ids: Joi.array()
    .items(Joi.number().integer().min(1).max(MAX_ID))
    .unique()
    .optional(),
  tecnicos_desmonte_ids: Joi.array()
    .items(Joi.number().integer().min(1).max(MAX_ID))
    .unique()
    .optional(),
});

const update = Joi.object({
  cliente_id: Joi.number().integer().min(1).max(MAX_ID).optional(),
  sucursal_id: Joi.number().integer().min(1).max(MAX_ID).optional(),
  vehiculo_id: Joi.number().integer().min(1).max(MAX_ID).allow(null).optional(),
  kilometraje: Joi.number().integer().min(0).allow(null).optional(),
  estatus_id: Joi.number().integer().min(1).max(MAX_ID).optional(),
  fecha_ingreso: Joi.date().iso().optional(),
  fecha_entrega_estimada: Joi.date().iso().allow(null).optional(),
  servicio: Joi.string().allow(null).optional(),
  inicio_reparacion_at: Joi.date().iso().allow(null).optional(),
  entrega_at: Joi.date().iso().allow(null).optional(),
  valor_mano_obra: Joi.number().precision(2).optional(),
  valor_repuestos: Joi.number().precision(2).optional(),
  facturado: Joi.boolean().truthy(1).falsy(0).optional(),
  horas_reparacion: Joi.number().precision(2).allow(null).optional(),
  dias_reparacion: Joi.number().precision(2).allow(null).optional(),
  tipo_reparacion_id: Joi.number().integer().min(1).max(MAX_ID).allow(null).optional(),
  total: Joi.number().precision(2).allow(null).optional(),
  tecnicos_reparadores_ids: Joi.array()
    .items(Joi.number().integer().min(1).max(MAX_ID))
    .unique()
    .optional(),
  tecnicos_desmonte_ids: Joi.array()
    .items(Joi.number().integer().min(1).max(MAX_ID))
    .unique()
    .optional(),
}).min(1);

module.exports = { listQuery, create, update, idParam };
