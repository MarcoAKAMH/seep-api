const express = require('express');

const authRoutes = require('./auth');

// Auto-generated table routes
const cat_tipo_cliente = require('./cat_tipo_cliente');
const cat_estatus_orden = require('./cat_estatus_orden');
const cat_categoria_vehiculo = require('./cat_categoria_vehiculo');
const cat_sucursal = require('./cat_sucursal');
const cat_tipo_reparacion = require('./cat_tipo_reparacion');
const dashboard = require('./dashboard');
const reports = require('./reports');
const meta_mensual = require('./meta_mensual');
const dia_festivo = require('./dia_festivo');
const cat_calidad = require('./cat_calidad');
const empleado = require('./empleado');
const cliente = require('./cliente');
const vehiculo = require('./vehiculo');
const orden_trabajo = require('./orden_trabajo');
const orden_sucursal = require('./orden_sucursal');
const orden_asignacion = require('./orden_asignacion');
const encuesta_satisfaccion = require('./encuesta_satisfaccion');
const garantia = require('./garantia');
const usuario = require('./usuario');
const rol = require('./rol');
const permiso = require('./permiso');
const usuario_rol = require('./usuario_rol');
const rol_permiso = require('./rol_permiso');

const router = express.Router();

router.use('/auth', authRoutes);

// Tables
router.use('/cat_tipo_cliente', cat_tipo_cliente);
router.use('/cat_estatus_orden', cat_estatus_orden);
router.use('/cat_categoria_vehiculo', cat_categoria_vehiculo);
router.use('/cat_sucursal', cat_sucursal);
router.use('/cat_tipo_reparacion', cat_tipo_reparacion);

// Summaries for UI (dashboard / reports)
router.use('/dashboard', dashboard);
router.use('/reports', reports);
router.use('/meta_mensual', meta_mensual);
router.use('/dia_festivo', dia_festivo);
router.use('/cat_calidad', cat_calidad);
router.use('/empleado', empleado);
router.use('/cliente', cliente);
router.use('/vehiculo', vehiculo);
router.use('/orden_trabajo', orden_trabajo);
router.use('/orden_sucursal', orden_sucursal);
router.use('/orden_asignacion', orden_asignacion);
router.use('/encuesta_satisfaccion', encuesta_satisfaccion);
router.use('/garantia', garantia);
router.use('/usuario', usuario);
router.use('/rol', rol);
router.use('/permiso', permiso);
router.use('/usuario_rol', usuario_rol);
router.use('/rol_permiso', rol_permiso);

module.exports = router;
