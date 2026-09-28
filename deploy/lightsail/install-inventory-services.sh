#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then echo 'Ejecuta este instalador con sudo.' >&2; exit 1; fi
ROOT=/home/ubuntu/seep-api
[[ -f "$ROOT/.env" ]] || { echo "Falta $ROOT/.env" >&2; exit 1; }

install -d -o ubuntu -g ubuntu -m 750 /var/lib/seep/inventory-photos /var/lib/seep/inventory-count-evidence
install -d -o root -g ubuntu -m 750 /var/backups/seep/inventory
chmod 750 "$ROOT/scripts/backup-inventory.sh" "$ROOT/ops/tasks/"*.sh
install -m 644 "$ROOT/deploy/lightsail/"seep-inventory-*.service /etc/systemd/system/
install -m 644 "$ROOT/deploy/lightsail/"seep-inventory-*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now seep-inventory-alerts.timer seep-inventory-counts.timer seep-inventory-backup.timer seep-inventory-cleanup.timer
systemctl list-timers 'seep-inventory-*' --all
