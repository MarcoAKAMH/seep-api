-- Apply with scripts/migrate-inventory.js; requires MySQL >= 8.0.16.
-- Independent inventory: deliberately no cliente or orden_trabajo foreign keys.
CREATE TABLE inv_categoria (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uq_inv_categoria_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE inv_unidad (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clave VARCHAR(20) NOT NULL,
  nombre VARCHAR(80) NOT NULL,
  decimales TINYINT UNSIGNED NOT NULL DEFAULT 3,
  UNIQUE KEY uq_inv_unidad_clave (clave),
  CONSTRAINT ck_inv_unidad_decimales CHECK (decimales <= 6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE inv_producto (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sku VARCHAR(80) NOT NULL,
  nombre_comercial VARCHAR(180) NOT NULL,
  nombre_tecnico VARCHAR(255) NOT NULL,
  categoria_id BIGINT UNSIGNED NOT NULL,
  unidad_id BIGINT UNSIGNED NOT NULL,
  tipo ENUM('MATERIA_PRIMA','PRODUCTO_TERMINADO','CONSUMIBLE') NOT NULL,
  codigo_barras VARCHAR(128) NULL,
  foto_url VARCHAR(1024) NULL,
  precio_publico DECIMAL(18,6) NOT NULL DEFAULT 0,
  precio_mayoreo DECIMAL(18,6) NOT NULL DEFAULT 0,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_por BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_inv_producto_sku (sku),
  UNIQUE KEY uq_inv_producto_barcode (codigo_barras),
  KEY ix_inv_producto_nombre (nombre_comercial),
  FOREIGN KEY (categoria_id) REFERENCES inv_categoria(id),
  FOREIGN KEY (unidad_id) REFERENCES inv_unidad(id),
  FOREIGN KEY (creado_por) REFERENCES usuario(id),
  CONSTRAINT ck_inv_producto_precios CHECK (precio_publico >= 0 AND precio_mayoreo >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE inv_almacen (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sucursal_id BIGINT UNSIGNED NOT NULL,
  nombre VARCHAR(120) NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uq_inv_almacen_nombre (sucursal_id, nombre),
  UNIQUE KEY uq_inv_almacen_scope (id, sucursal_id),
  FOREIGN KEY (sucursal_id) REFERENCES cat_sucursal(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE inv_ubicacion (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  almacen_id BIGINT UNSIGNED NOT NULL,
  sucursal_id BIGINT UNSIGNED NOT NULL,
  codigo VARCHAR(60) NOT NULL,
  descripcion VARCHAR(180) NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uq_inv_ubicacion_codigo (almacen_id, codigo),
  UNIQUE KEY uq_inv_ubicacion_scope (id, almacen_id, sucursal_id),
  KEY ix_inv_ubicacion_busqueda (codigo),
  FOREIGN KEY (almacen_id, sucursal_id) REFERENCES inv_almacen(id, sucursal_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE inv_producto_almacen (
  producto_id BIGINT UNSIGNED NOT NULL,
  almacen_id BIGINT UNSIGNED NOT NULL,
  sucursal_id BIGINT UNSIGNED NOT NULL,
  minimo DECIMAL(18,6) NOT NULL DEFAULT 0,
  maximo DECIMAL(18,6) NOT NULL DEFAULT 0,
  punto_reorden DECIMAL(18,6) NOT NULL DEFAULT 0,
  PRIMARY KEY (producto_id, almacen_id),
  UNIQUE KEY uq_inv_producto_almacen_scope (producto_id, almacen_id, sucursal_id),
  FOREIGN KEY (producto_id) REFERENCES inv_producto(id),
  FOREIGN KEY (almacen_id, sucursal_id) REFERENCES inv_almacen(id, sucursal_id),
  CONSTRAINT ck_inv_limites CHECK (minimo >= 0 AND maximo >= minimo AND punto_reorden >= minimo AND punto_reorden <= maximo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE inv_costo_sucursal (
  producto_id BIGINT UNSIGNED NOT NULL,
  sucursal_id BIGINT UNSIGNED NOT NULL,
  costo_promedio DECIMAL(18,6) NOT NULL DEFAULT 0,
  ultimo_costo DECIMAL(18,6) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (producto_id, sucursal_id),
  FOREIGN KEY (producto_id) REFERENCES inv_producto(id),
  FOREIGN KEY (sucursal_id) REFERENCES cat_sucursal(id),
  CONSTRAINT ck_inv_costos CHECK (costo_promedio >= 0 AND ultimo_costo >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE inv_existencia (
  producto_id BIGINT UNSIGNED NOT NULL,
  ubicacion_id BIGINT UNSIGNED NOT NULL,
  almacen_id BIGINT UNSIGNED NOT NULL,
  sucursal_id BIGINT UNSIGNED NOT NULL,
  cantidad DECIMAL(18,6) NOT NULL DEFAULT 0,
  ultimo_movimiento_at DATETIME(6) NULL,
  PRIMARY KEY (producto_id, ubicacion_id),
  KEY ix_inv_existencia_sucursal (sucursal_id, producto_id),
  FOREIGN KEY (producto_id, almacen_id, sucursal_id) REFERENCES inv_producto_almacen(producto_id, almacen_id, sucursal_id),
  FOREIGN KEY (ubicacion_id, almacen_id, sucursal_id) REFERENCES inv_ubicacion(id, almacen_id, sucursal_id),
  CONSTRAINT ck_inv_existencia_cantidad CHECK (cantidad >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE inv_documento (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sucursal_id BIGINT UNSIGNED NOT NULL,
  folio VARCHAR(80) NOT NULL,
  tipo ENUM('INICIAL','ENTRADA','SALIDA','DEVOLUCION','AJUSTE','TRANSFERENCIA_SALIDA','TRANSFERENCIA_ENTRADA','REVERSA') NOT NULL,
  estado ENUM('BORRADOR','PENDIENTE','APLICADO','CANCELADO') NOT NULL DEFAULT 'BORRADOR',
  motivo VARCHAR(500) NOT NULL,
  referencia VARCHAR(180) NULL,
  documento_origen_id BIGINT UNSIGNED NULL,
  idempotencia VARCHAR(80) NOT NULL,
  creado_por BIGINT UNSIGNED NOT NULL,
  autorizado_por BIGINT UNSIGNED NULL,
  aplicado_por BIGINT UNSIGNED NULL,
  fecha_operacion DATETIME(6) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  autorizado_at DATETIME(6) NULL,
  aplicado_at DATETIME(6) NULL,
  UNIQUE KEY uq_inv_documento_folio (sucursal_id, folio),
  UNIQUE KEY uq_inv_documento_request (idempotencia),
  UNIQUE KEY uq_inv_documento_scope (id, sucursal_id),
  KEY ix_inv_documento_fecha (sucursal_id, fecha_operacion),
  FOREIGN KEY (sucursal_id) REFERENCES cat_sucursal(id),
  FOREIGN KEY (documento_origen_id) REFERENCES inv_documento(id),
  FOREIGN KEY (creado_por) REFERENCES usuario(id),
  FOREIGN KEY (autorizado_por) REFERENCES usuario(id),
  FOREIGN KEY (aplicado_por) REFERENCES usuario(id),
  CONSTRAINT ck_inv_documento_aplicado CHECK (estado <> 'APLICADO' OR (aplicado_por IS NOT NULL AND aplicado_at IS NOT NULL)),
  CONSTRAINT ck_inv_documento_ajuste CHECK (tipo <> 'AJUSTE' OR estado <> 'APLICADO' OR (autorizado_por IS NOT NULL AND autorizado_at IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE inv_documento_detalle (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  documento_id BIGINT UNSIGNED NOT NULL,
  sucursal_id BIGINT UNSIGNED NOT NULL,
  producto_id BIGINT UNSIGNED NOT NULL,
  almacen_id BIGINT UNSIGNED NOT NULL,
  ubicacion_id BIGINT UNSIGNED NOT NULL,
  cantidad DECIMAL(18,6) NOT NULL,
  costo_unitario DECIMAL(18,6) NOT NULL,
  UNIQUE KEY uq_inv_detalle_scope (id, sucursal_id, producto_id, ubicacion_id, almacen_id),
  FOREIGN KEY (documento_id, sucursal_id) REFERENCES inv_documento(id, sucursal_id),
  FOREIGN KEY (producto_id, almacen_id, sucursal_id) REFERENCES inv_producto_almacen(producto_id, almacen_id, sucursal_id),
  FOREIGN KEY (ubicacion_id, almacen_id, sucursal_id) REFERENCES inv_ubicacion(id, almacen_id, sucursal_id),
  CONSTRAINT ck_inv_detalle CHECK (cantidad > 0 AND costo_unitario >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE inv_movimiento (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  detalle_id BIGINT UNSIGNED NOT NULL,
  sucursal_id BIGINT UNSIGNED NOT NULL,
  producto_id BIGINT UNSIGNED NOT NULL,
  ubicacion_id BIGINT UNSIGNED NOT NULL,
  almacen_id BIGINT UNSIGNED NOT NULL,
  cantidad_delta DECIMAL(18,6) NOT NULL,
  costo_unitario DECIMAL(18,6) NOT NULL,
  saldo_posterior DECIMAL(18,6) NOT NULL,
  costo_promedio_posterior DECIMAL(18,6) NOT NULL,
  usuario_id BIGINT UNSIGNED NOT NULL,
  reversa_de_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_inv_movimiento_detalle (detalle_id),
  KEY ix_inv_kardex (sucursal_id, producto_id, created_at, id),
  FOREIGN KEY (detalle_id, sucursal_id, producto_id, ubicacion_id, almacen_id) REFERENCES inv_documento_detalle(id, sucursal_id, producto_id, ubicacion_id, almacen_id),
  FOREIGN KEY (usuario_id) REFERENCES usuario(id),
  FOREIGN KEY (reversa_de_id) REFERENCES inv_movimiento(id),
  CONSTRAINT ck_inv_movimiento CHECK (cantidad_delta <> 0 AND costo_unitario >= 0 AND saldo_posterior >= 0 AND costo_promedio_posterior >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE inv_notificacion (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sucursal_id BIGINT UNSIGNED NOT NULL,
  producto_id BIGINT UNSIGNED NOT NULL,
  almacen_id BIGINT UNSIGNED NOT NULL,
  tipo ENUM('BAJO_MINIMO','AGOTADO','SOBRE_MAXIMO','SIN_MOVIMIENTO') NOT NULL,
  mensaje VARCHAR(500) NOT NULL,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  abierta TINYINT GENERATED ALWAYS AS (IF(activa, 1, NULL)) STORED,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resuelta_at DATETIME(6) NULL,
  UNIQUE KEY uq_inv_alerta_abierta (producto_id, almacen_id, tipo, abierta),
  KEY ix_inv_alerta_scope (sucursal_id, activa, created_at),
  FOREIGN KEY (producto_id, almacen_id, sucursal_id) REFERENCES inv_producto_almacen(producto_id, almacen_id, sucursal_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE inv_notificacion_lectura (
  notificacion_id BIGINT UNSIGNED NOT NULL,
  usuario_id BIGINT UNSIGNED NOT NULL,
  leida_at DATETIME(6) NOT NULL,
  PRIMARY KEY (notificacion_id, usuario_id),
  FOREIGN KEY (notificacion_id) REFERENCES inv_notificacion(id),
  FOREIGN KEY (usuario_id) REFERENCES usuario(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE inv_auditoria (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sucursal_id BIGINT UNSIGNED NULL,
  usuario_id BIGINT UNSIGNED NOT NULL,
  accion VARCHAR(80) NOT NULL,
  entidad VARCHAR(80) NOT NULL,
  entidad_id BIGINT UNSIGNED NOT NULL,
  antes JSON NULL,
  despues JSON NULL,
  motivo VARCHAR(500) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY ix_inv_auditoria_scope (sucursal_id, created_at, id),
  KEY ix_inv_auditoria_entidad (entidad, entidad_id),
  FOREIGN KEY (sucursal_id) REFERENCES cat_sucursal(id),
  FOREIGN KEY (usuario_id) REFERENCES usuario(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
