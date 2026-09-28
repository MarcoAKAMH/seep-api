#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${SEEP_ENV_FILE:-$ROOT/.env}"
if [[ ! -r "$ENV_FILE" ]]; then echo "No se puede leer $ENV_FILE" >&2; exit 1; fi

while IFS='=' read -r key value; do
  key="${key//[[:space:]]/}"
  [[ -z "$key" || "$key" == \#* ]] && continue
  case "$key" in
    DB_HOST|DB_PORT|DB_USER|DB_PASSWORD|DB_NAME|DB_SSL|DB_SSL_CA_PATH|INVENTORY_PHOTO_DIR|INVENTORY_COUNT_EVIDENCE_DIR|INVENTORY_BACKUP_DIR|INVENTORY_BACKUP_RETENTION_DAYS)
      value="${value%$'\r'}"
      if [[ "$value" == \"*\" && "$value" == *\" ]]; then value="${value:1:${#value}-2}"; fi
      if [[ "$value" == \'*\' && "$value" == *\' ]]; then value="${value:1:${#value}-2}"; fi
      printf -v "$key" '%s' "$value"
      ;;
  esac
done < "$ENV_FILE"

: "${DB_HOST:?Falta DB_HOST}"
: "${DB_USER:?Falta DB_USER}"
: "${DB_PASSWORD:?Falta DB_PASSWORD}"
DB_NAME="${DB_NAME:-seep_taller}"
DB_PORT="${DB_PORT:-3306}"
PHOTO_DIR="${INVENTORY_PHOTO_DIR:-$ROOT/uploads/inventory}"
EVIDENCE_DIR="${INVENTORY_COUNT_EVIDENCE_DIR:-$ROOT/uploads/inventory-counts}"
OUTPUT_DIR="${INVENTORY_BACKUP_DIR:-/var/backups/seep/inventory}"
RETENTION_DAYS="${INVENTORY_BACKUP_RETENTION_DAYS:-30}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/seep-inventory-${STAMP}-XXXXXX")"
OPTION_FILE="$(mktemp "${TMPDIR:-/tmp}/seep-mysql-${STAMP}-XXXXXX.cnf")"

cleanup() { rm -rf -- "$STAGE"; rm -f -- "$OPTION_FILE"; }
trap cleanup EXIT
install -d -m 750 "$OUTPUT_DIR" "$STAGE/uploads"
chmod 600 "$OPTION_FILE"
cat > "$OPTION_FILE" <<EOF
[client]
host=$DB_HOST
port=$DB_PORT
user=$DB_USER
password=$DB_PASSWORD
default-character-set=utf8mb4
EOF

MYSQL_ARGS=("--defaults-extra-file=$OPTION_FILE" --single-transaction --routines --triggers --hex-blob --set-gtid-purged=OFF)
if [[ "${DB_SSL:-false}" == "true" ]]; then
  MYSQL_ARGS+=(--ssl-mode=VERIFY_IDENTITY)
  [[ -n "${DB_SSL_CA_PATH:-}" ]] && MYSQL_ARGS+=("--ssl-ca=$DB_SSL_CA_PATH")
fi
mysqldump "${MYSQL_ARGS[@]}" "$DB_NAME" > "$STAGE/database.sql"

if [[ -d "$PHOTO_DIR" ]]; then cp -a "$PHOTO_DIR" "$STAGE/uploads/inventory-photos"; fi
if [[ -d "$EVIDENCE_DIR" ]]; then cp -a "$EVIDENCE_DIR" "$STAGE/uploads/inventory-count-evidence"; fi
(
  cd "$STAGE"
  find . -type f ! -name manifest.sha256 -print0 | sort -z | xargs -0 -r sha256sum > manifest.sha256
)

ARCHIVE="$OUTPUT_DIR/seep-inventory-$STAMP.tar.gz"
tar -C "$STAGE" -czf "$ARCHIVE" .
sha256sum "$ARCHIVE" > "$ARCHIVE.sha256"
find "$OUTPUT_DIR" -maxdepth 1 -type f \( -name 'seep-inventory-*.tar.gz' -o -name 'seep-inventory-*.tar.gz.sha256' \) -mtime "+$RETENTION_DAYS" -delete
echo "$ARCHIVE"
