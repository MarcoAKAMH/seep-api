-- Add refresh token storage for secure sessions
-- Run this once on your seep_taller database.

USE seep_taller;

-- If table doesn't exist, create it.
CREATE TABLE IF NOT EXISTS auth_refresh_token (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  usuario_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  is_persistent TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  replaced_by_hash CHAR(64) NULL,
  ip VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  UNIQUE KEY uq_art_hash (token_hash),
  KEY idx_art_usuario (usuario_id),
  KEY idx_art_expires (expires_at),
  CONSTRAINT fk_art_usuario FOREIGN KEY (usuario_id) REFERENCES usuario(id)
) ENGINE=InnoDB;

-- If your table already existed from a previous run WITHOUT is_persistent:
-- ALTER TABLE auth_refresh_token ADD COLUMN is_persistent TINYINT(1) NOT NULL DEFAULT 1 AFTER token_hash;
