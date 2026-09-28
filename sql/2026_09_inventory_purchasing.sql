-- Stage 6: suppliers, purchase orders and partial receipts.
CREATE TABLE inv_proveedor (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  razon_social VARCHAR(180) NOT NULL,
  nombre_comercial VARCHAR(180) NOT NULL,
  rfc VARCHAR(20) NULL,
  contacto VARCHAR(180) NULL,
  telefono VARCHAR(40) NULL,
  email VARCHAR(180) NULL,
  condiciones_pago VARCHAR(180) NULL,
  dias_entrega SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  calificacion DECIMAL(3,2) NOT NULL DEFAULT 0,
  notas VARCHAR(500) NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_por BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_inv_proveedor_rfc (rfc),
  KEY ix_inv_proveedor_nombre (nombre_comercial),
  FOREIGN KEY (creado_por) REFERENCES usuario(id),
  CONSTRAINT ck_inv_proveedor_calificacion CHECK (calificacion >= 0 AND calificacion <= 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE inv_proveedor_sucursal (
  proveedor_id BIGINT UNSIGNED NOT NULL,
  sucursal_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (proveedor_id,sucursal_id),
  FOREIGN KEY (proveedor_id) REFERENCES inv_proveedor(id),
  FOREIGN KEY (sucursal_id) REFERENCES cat_sucursal(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE inv_producto_proveedor (
  producto_id BIGINT UNSIGNED NOT NULL,
  proveedor_id BIGINT UNSIGNED NOT NULL,
  sucursal_id BIGINT UNSIGNED NOT NULL,
  sku_proveedor VARCHAR(100) NULL,
  costo_referencia DECIMAL(18,6) NOT NULL DEFAULT 0,
  preferido BOOLEAN NOT NULL DEFAULT FALSE,
  preferido_unico TINYINT GENERATED ALWAYS AS (IF(preferido,1,NULL)) STORED,
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (producto_id,proveedor_id,sucursal_id),
  UNIQUE KEY uq_inv_producto_proveedor_preferido (producto_id,sucursal_id,preferido_unico),
  FOREIGN KEY (producto_id) REFERENCES inv_producto(id),
  FOREIGN KEY (proveedor_id,sucursal_id) REFERENCES inv_proveedor_sucursal(proveedor_id,sucursal_id),
  CONSTRAINT ck_inv_producto_proveedor_costo CHECK (costo_referencia >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE inv_orden_compra (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  folio VARCHAR(80) NOT NULL,
  sucursal_id BIGINT UNSIGNED NOT NULL,
  almacen_id BIGINT UNSIGNED NOT NULL,
  proveedor_id BIGINT UNSIGNED NOT NULL,
  estado ENUM('BORRADOR','PENDIENTE_AUTORIZACION','AUTORIZADA','ENVIADA','PARCIAL','RECIBIDA','RECHAZADA','CANCELADA') NOT NULL DEFAULT 'BORRADOR',
  fecha_estimada DATE NULL,
  condiciones_pago VARCHAR(180) NULL,
  notas VARCHAR(500) NULL,
  subtotal_estimado DECIMAL(18,6) NOT NULL DEFAULT 0,
  creado_por BIGINT UNSIGNED NOT NULL,
  autorizado_por BIGINT UNSIGNED NULL,
  enviado_por BIGINT UNSIGNED NULL,
  cancelado_por BIGINT UNSIGNED NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  solicitado_at DATETIME(6) NULL,
  autorizado_at DATETIME(6) NULL,
  enviado_at DATETIME(6) NULL,
  completado_at DATETIME(6) NULL,
  cancelado_at DATETIME(6) NULL,
  UNIQUE KEY uq_inv_oc_folio (folio),
  UNIQUE KEY uq_inv_oc_receipt_scope (id,sucursal_id,almacen_id),
  KEY ix_inv_oc_scope (sucursal_id,estado,created_at),
  FOREIGN KEY (almacen_id,sucursal_id) REFERENCES inv_almacen(id,sucursal_id),
  FOREIGN KEY (proveedor_id,sucursal_id) REFERENCES inv_proveedor_sucursal(proveedor_id,sucursal_id),
  FOREIGN KEY (creado_por) REFERENCES usuario(id),
  FOREIGN KEY (autorizado_por) REFERENCES usuario(id),
  FOREIGN KEY (enviado_por) REFERENCES usuario(id),
  FOREIGN KEY (cancelado_por) REFERENCES usuario(id),
  CONSTRAINT ck_inv_oc_total CHECK (subtotal_estimado >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE inv_orden_compra_detalle (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  orden_compra_id BIGINT UNSIGNED NOT NULL,
  producto_id BIGINT UNSIGNED NOT NULL,
  cantidad_ordenada DECIMAL(18,6) NOT NULL,
  cantidad_recibida DECIMAL(18,6) NOT NULL DEFAULT 0,
  costo_esperado DECIMAL(18,6) NOT NULL,
  importe_estimado DECIMAL(18,6) GENERATED ALWAYS AS (cantidad_ordenada*costo_esperado) STORED,
  UNIQUE KEY uq_inv_oc_producto (orden_compra_id,producto_id),
  FOREIGN KEY (orden_compra_id) REFERENCES inv_orden_compra(id),
  FOREIGN KEY (producto_id) REFERENCES inv_producto(id),
  CONSTRAINT ck_inv_oc_detalle CHECK (cantidad_ordenada > 0 AND cantidad_recibida >= 0 AND cantidad_recibida <= cantidad_ordenada AND costo_esperado >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE inv_recepcion_compra (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  folio VARCHAR(80) NOT NULL,
  orden_compra_id BIGINT UNSIGNED NOT NULL,
  sucursal_id BIGINT UNSIGNED NOT NULL,
  almacen_id BIGINT UNSIGNED NOT NULL,
  ubicacion_id BIGINT UNSIGNED NOT NULL,
  factura_proveedor VARCHAR(180) NOT NULL,
  idempotencia VARCHAR(80) NOT NULL,
  documento_inventario_id BIGINT UNSIGNED NOT NULL,
  recibido_por BIGINT UNSIGNED NOT NULL,
  fecha_recepcion DATETIME(6) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_inv_recepcion_folio (folio),
  UNIQUE KEY uq_inv_recepcion_request (idempotencia),
  KEY ix_inv_recepcion_oc (orden_compra_id,fecha_recepcion),
  FOREIGN KEY (orden_compra_id,sucursal_id,almacen_id) REFERENCES inv_orden_compra(id,sucursal_id,almacen_id),
  FOREIGN KEY (ubicacion_id,almacen_id,sucursal_id) REFERENCES inv_ubicacion(id,almacen_id,sucursal_id),
  FOREIGN KEY (documento_inventario_id) REFERENCES inv_documento(id),
  FOREIGN KEY (recibido_por) REFERENCES usuario(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE inv_recepcion_compra_detalle (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  recepcion_id BIGINT UNSIGNED NOT NULL,
  orden_detalle_id BIGINT UNSIGNED NOT NULL,
  producto_id BIGINT UNSIGNED NOT NULL,
  cantidad DECIMAL(18,6) NOT NULL,
  costo_esperado DECIMAL(18,6) NOT NULL,
  costo_real DECIMAL(18,6) NOT NULL,
  variacion_unitaria DECIMAL(18,6) GENERATED ALWAYS AS (costo_real-costo_esperado) STORED,
  importe_real DECIMAL(18,6) GENERATED ALWAYS AS (cantidad*costo_real) STORED,
  UNIQUE KEY uq_inv_recepcion_partida (recepcion_id,orden_detalle_id),
  FOREIGN KEY (recepcion_id) REFERENCES inv_recepcion_compra(id),
  FOREIGN KEY (orden_detalle_id) REFERENCES inv_orden_compra_detalle(id),
  FOREIGN KEY (producto_id) REFERENCES inv_producto(id),
  CONSTRAINT ck_inv_recepcion_detalle CHECK (cantidad > 0 AND costo_esperado >= 0 AND costo_real >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
