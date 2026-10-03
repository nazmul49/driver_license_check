#!/usr/bin/env bash
# Nightly backup: MySQL dump plus the encrypted image volume, kept for 7 days.
# The encryption key (deploy/.env) is NOT included; store it separately and securely.
# Cron example: 15 3 * * * /home/ubuntu/driver_license_check/deploy/backup.sh >> /home/ubuntu/dlc-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
DEST="${BACKUP_DIR:-$HOME/dlc-backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$DEST"
chmod 700 "$DEST"

compose() { docker compose -f compose.yml --env-file .env "$@"; }

# MYSQL_PWD keeps the password off the mysqldump command line inside the container.
compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --routines dlc' \
  | gzip > "$DEST/mysql-$STAMP.sql.gz"
docker run --rm -v dlc_images:/images:ro -v "$DEST":/backup alpine \
  tar -czf "/backup/images-$STAMP.tar.gz" -C /images .

find "$DEST" -name '*.gz' -mtime +7 -delete
echo "Backup written: $DEST/*-$STAMP.*"
