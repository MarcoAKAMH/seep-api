-- Stage 7: weekly cycle counts and evidence.
ALTER TABLE inv_existencia ADD UNIQUE KEY uq_inv_existencia_scope (producto_id,ubicacion_id,almacen_id,sucursal_id);

CREATE TABLE inv_conteo_ciclico (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  folio VARCHAR(80) NOT NULL,
  sucursal_id BIGINT UNSIGNED NOT NULL,
  almacen_id BIGINT UNSIGNED NOT NULL,
  semana DATE NOT NULL,
  zona VARCHAR(60) NOT NULL,
  estado ENUM('PROGRAMADO','EN_PROCESO','COMPLETADO','CANCELADO') NOT NULL DEFAULT 'PROGRAMADO',
  asignado_a BIGINT UNSIGNED NULL,
  creado_por BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  iniciado_at DATETIME(6) NULL,
  completado_at DATETIME(6) NULL,
  cancelado_at DATETIME(6) NULL,
  UNIQUE KEY uq_inv_conteo_folio (folio),
  UNIQUE KEY uq_inv_conteo_semana_zona (almacen_id,semana,zona),
  KEY ix_inv_conteo_scope (sucursal_id,estado,semana),
  FOREIGN KEY (almacen_id,sucursal_id) REFERENCES inv_almacen(id,sucursal_id),
  FOREIGN KEY (asignado_a) REFERENCES usuario(id),
  FOREIGN KEY (creado_por) REFERENCES usuario(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE inv_conteo_ciclico_detalle (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  conteo_id BIGINT UNSIGNED NOT NULL,
  producto_id BIGINT UNSIGNED NOT NULL,
  ubicacion_id BIGINT UNSIGNED NOT NULL,
  almacen_id BIGINT UNSIGNED NOT NULL,
  sucursal_id BIGINT UNSIGNED NOT NULL,
  existencia_sistema DECIMAL(18,6) NOT NULL,
  cantidad_contada DECIMAL(18,6) NULL,
  diferencia DECIMAL(18,6) GENERATED ALWAYS AS (IF(cantidad_contada IS NULL,NULL,cantidad_contada-existencia_sistema)) STORED,
  estado ENUM('PENDIENTE','CONTADO','SIN_DIFERENCIA','AJUSTE_PENDIENTE') NOT NULL DEFAULT 'PENDIENTE',
  evidencia_url VARCHAR(255) NULL,
  notas VARCHAR(500) NULL,
  contado_por BIGINT UNSIGNED NULL,
  ajuste_solicitud_id BIGINT UNSIGNED NULL,
  contado_at DATETIME(6) NULL,
  UNIQUE KEY uq_inv_conteo_partida (conteo_id,producto_id,ubicacion_id),
  KEY ix_inv_conteo_producto (sucursal_id,producto_id,contado_at),
  FOREIGN KEY (conteo_id) REFERENCES inv_conteo_ciclico(id),
  FOREIGN KEY (producto_id,ubicacion_id,almacen_id,sucursal_id) REFERENCES inv_existencia(producto_id,ubicacion_id,almacen_id,sucursal_id),
  FOREIGN KEY (contado_por) REFERENCES usuario(id),
  FOREIGN KEY (ajuste_solicitud_id) REFERENCES inv_ajuste_solicitud(id),
  CONSTRAINT ck_inv_conteo_cantidad CHECK (existencia_sistema >= 0 AND (cantidad_contada IS NULL OR cantidad_contada >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
