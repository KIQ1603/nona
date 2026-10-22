#!/usr/bin/env bash
# Logical backup of the NONA database (pg_dump custom format), optionally encrypted.
#
#   infrastructure/scripts/backup.sh [output-dir]
#
# Env: PG_CONTAINER (default nona-postgres-1), PGUSER/PGDATABASE (nona/nona),
#      BACKUP_PASSPHRASE  -> if set, the dump is encrypted with AES-256 (openssl, PBKDF2) and the
#                            plaintext never touches disk.
# In production prefer your managed database's snapshots + PITR; keep this for portable, tested dumps.
set -euo pipefail

CONTAINER="${PG_CONTAINER:-nona-postgres-1}"
DB_USER="${PGUSER:-nona}"
DB_NAME="${PGDATABASE:-nona}"
OUT_DIR="${1:-backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT_DIR"

if [[ -n "${BACKUP_PASSPHRASE:-}" ]]; then
  FILE="$OUT_DIR/nona-$STAMP.dump.enc"
  docker exec "$CONTAINER" pg_dump -U "$DB_USER" -Fc "$DB_NAME" \
    | openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_PASSPHRASE > "$FILE"
else
  FILE="$OUT_DIR/nona-$STAMP.dump"
  docker exec "$CONTAINER" pg_dump -U "$DB_USER" -Fc "$DB_NAME" > "$FILE"
  echo "WARNING: backup is NOT encrypted (set BACKUP_PASSPHRASE)" >&2
fi

[[ -s "$FILE" ]] || { echo "backup is empty - aborting" >&2; rm -f "$FILE"; exit 1; }
(cd "$OUT_DIR" && shasum -a 256 "$(basename "$FILE")" > "$(basename "$FILE").sha256")
echo "$FILE"
