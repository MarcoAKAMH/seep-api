-- Stage 5: add a distinct reorder-point alert while retaining notification history.
ALTER TABLE inv_notificacion MODIFY COLUMN tipo
  ENUM('BAJO_MINIMO','PUNTO_REORDEN','AGOTADO','SOBRE_MAXIMO','SIN_MOVIMIENTO') NOT NULL;
