#!/usr/bin/env bash
# run-backup.sh — encrypted Postgres backup pipeline (Task 28.4, Req 28.8).
#
# Pipeline:
#
#   pg_dump --format=custom $DATABASE_URL
#       | apps/api/scripts/backup-encrypt.ts -
#       | rclone rcat r2:edubridge-backups/<bucket-prefix>/<filename>.enc
#
# All three stages stream — nothing is written to disk on the bastion
# host so a compromised host never holds plaintext at rest.
#
# Required environment:
#
#   DATABASE_URL                postgres://user:pass@host:5432/db
#   BACKUP_ENCRYPTION_KEY       base64 32 bytes (`openssl rand -base64 32`)
#   R2_BACKUP_REMOTE            rclone remote name (e.g. `r2:edubridge-backups`)
#   R2_BACKUP_PREFIX            prefix inside the bucket
#                               (e.g. `production/postgres/daily`)
#
# Cron example (run daily at 02:30 UTC):
#
#   30 2 * * *  /opt/edubridge/run-backup.sh >> /var/log/edubridge-backup.log 2>&1
#
# Exits with non-zero on any failure so the cron MTA (or PagerDuty
# integration) can alert.

set -euo pipefail

# ---- 1. Pre-flight checks --------------------------------------------------

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "FATAL: required env var $name is unset" >&2
    exit 2
  fi
}

require_env DATABASE_URL
require_env BACKUP_ENCRYPTION_KEY
require_env R2_BACKUP_REMOTE
require_env R2_BACKUP_PREFIX

for bin in pg_dump node rclone; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "FATAL: required binary '$bin' is not on PATH" >&2
    exit 3
  fi
done

# ---- 2. Resolve script paths ----------------------------------------------

# Resolve the repo root from this script's location so the cron
# entrypoint works regardless of $PWD when invoked by anacron / cron.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
ENCRYPT_SCRIPT="$REPO_ROOT/apps/api/scripts/backup-encrypt.ts"

if [[ ! -f "$ENCRYPT_SCRIPT" ]]; then
  echo "FATAL: backup-encrypt.ts not found at $ENCRYPT_SCRIPT" >&2
  exit 4
fi

# ---- 3. Compose the destination object key --------------------------------

TIMESTAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
HOSTNAME="$(hostname -s 2>/dev/null || echo unknown)"
OBJECT_KEY="${R2_BACKUP_PREFIX%/}/${HOSTNAME}-${TIMESTAMP}.dump.enc"

echo "[backup] $(date -u +%FT%TZ) starting backup -> ${R2_BACKUP_REMOTE}/${OBJECT_KEY}"

# ---- 4. Stream pg_dump | encrypt | rclone ---------------------------------

# `pg_dump --format=custom` produces a compressed, restorable archive
# directly. We deliberately disable compression in `rclone` (already
# compressed) and let `pg_dump`'s custom-format writer handle it.
#
# `set -o pipefail` (already on) ensures any stage failing causes the
# whole pipeline to exit non-zero.

pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" \
  | node "$ENCRYPT_SCRIPT" - \
  | rclone rcat "${R2_BACKUP_REMOTE%:}/${OBJECT_KEY}" \
      --no-traverse \
      --s3-no-check-bucket \
      --quiet

echo "[backup] $(date -u +%FT%TZ) success -> ${R2_BACKUP_REMOTE%:}/${OBJECT_KEY}"

# ---- 5. Optional retention ------------------------------------------------

# Drop archives older than $BACKUP_RETENTION_DAYS days. Defaults to 30.
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
if [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] && (( RETENTION_DAYS > 0 )); then
  echo "[backup] purging archives older than ${RETENTION_DAYS} days"
  rclone delete "${R2_BACKUP_REMOTE%:}/${R2_BACKUP_PREFIX%/}/" \
    --min-age "${RETENTION_DAYS}d" \
    --quiet
fi

exit 0
