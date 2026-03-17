-- Meta mensual, técnicos (comisión) y días festivos
-- Ejecuta este script una vez en tu base de datos.

USE seep_taller;

-- 1) Empleado: porcentaje de comisión
SET @col_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'empleado'
    AND COLUMN_NAME = 'comision_pct'
);

SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE empleado ADD COLUMN comision_pct DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER activo',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2) Meta mensual
CREATE TABLE IF NOT EXISTS meta_mensual (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  anio SMALLINT UNSIGNED NOT NULL,
  mes TINYINT UNSIGNED NOT NULL,
  meta_pesos DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_meta_mensual (anio, mes)
) ENGINE=InnoDB;

-- 3) Días festivos
CREATE TABLE IF NOT EXISTS dia_festivo (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  fecha DATE NOT NULL,
  descripcion VARCHAR(180) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_dia_festivo_fecha (fecha)
) ENGINE=InnoDB;
