#!/usr/bin/env bash
# Restore drill: proves a backup can actually be restored and is internally consistent.
#
#   infrastructure/scripts/restore-drill.sh path/to/nona-*.dump[.enc]
#
# Restores into a throw-away database (never the live one), compares it with the source, runs
# integrity checks, prints a report (including the measured RPO) and drops the scratch database.
# Exit code != 0 means the drill FAILED. Run it on a schedule and after every migration that rewrites data.
set -euo pipefail

FILE="${1:?usage: restore-drill.sh <backup file>}"
CONTAINER="${PG_CONTAINER:-nona-postgres-1}"
DB_USER="${PGUSER:-nona}"
SOURCE_DB="${PGDATABASE:-nona}"
DRILL_DB="nona_restore_drill"
psql_() { docker exec -i "$CONTAINER" psql -U "$DB_USER" -v ON_ERROR_STOP=1 -tA "$@"; }

[[ -f "$FILE" ]] || { echo "no such file: $FILE" >&2; exit 2; }
if [[ -f "$FILE.sha256" ]]; then
  (cd "$(dirname "$FILE")" && shasum -a 256 -c "$(basename "$FILE").sha256" >/dev/null) || { echo "CHECKSUM MISMATCH" >&2; exit 1; }
  echo "checksum ok"
fi

START=$(date +%s)
psql_ -d postgres -c "DROP DATABASE IF EXISTS $DRILL_DB WITH (FORCE)" >/dev/null
psql_ -d postgres -c "CREATE DATABASE $DRILL_DB" >/dev/null

if [[ "$FILE" == *.enc ]]; then
  : "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required to decrypt}"
  openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE < "$FILE" | docker exec -i "$CONTAINER" pg_restore -U "$DB_USER" -d "$DRILL_DB" --no-owner --exit-on-error
else
  docker exec -i "$CONTAINER" pg_restore -U "$DB_USER" -d "$DRILL_DB" --no-owner --exit-on-error < "$FILE"
fi
RESTORE_SECONDS=$(( $(date +%s) - START ))

FAIL=0
check() { # name, source value, restored value
  if [[ "$2" == "$3" ]]; then printf '  %-34s %s\n' "$1" "$3"; else printf '  %-34s MISMATCH source=%s restored=%s\n' "$1" "$2" "$3"; FAIL=1; fi
}
count() { psql_ -d "$1" -c "SELECT COUNT(*) FROM $2"; }

echo "restored in ${RESTORE_SECONDS}s - row counts (source vs restored):"
for t in users products product_variants inventory_movements orders order_items order_status_history payments refunds coupons coupon_usages audit_logs outbox_events site_settings; do
  check "$t" "$(count "$SOURCE_DB" "$t")" "$(count "$DRILL_DB" "$t")"
done
check "schema_migrations" "$(psql_ -d "$SOURCE_DB" -c "SELECT string_agg(name, ',' ORDER BY name) FROM schema_migrations")" "$(psql_ -d "$DRILL_DB" -c "SELECT string_agg(name, ',' ORDER BY name) FROM schema_migrations")"

echo "integrity checks on the restored copy:"
bad() { # name, query that must return 0
  local n; n="$(psql_ -d "$DRILL_DB" -c "$2")"
  if [[ "$n" == "0" ]]; then printf '  %-34s ok\n' "$1"; else printf '  %-34s FAILED (%s rows)\n' "$1" "$n"; FAIL=1; fi
}
bad "order totals consistent"        "SELECT COUNT(*) FROM orders WHERE total_vnd <> subtotal_vnd - discount_vnd + shipping_fee_vnd"
bad "item totals consistent"         "SELECT COUNT(*) FROM order_items WHERE line_total_vnd <> unit_price_vnd * quantity - discount_vnd"
bad "no negative stock"              "SELECT COUNT(*) FROM (SELECT variant_id FROM inventory_movements GROUP BY variant_id HAVING SUM(delta) < 0) x"
bad "orders without history"         "SELECT COUNT(*) FROM orders o WHERE NOT EXISTS (SELECT 1 FROM order_status_history h WHERE h.order_id = o.id)"
bad "paid payments without txn no."  "SELECT COUNT(*) FROM payments WHERE provider = 'VNPAY' AND status = 'PAID' AND provider_transaction_no IS NULL"
bad "refunds exceeding payment"      "SELECT COUNT(*) FROM payments WHERE refunded_vnd > amount_vnd"
bad "orphan order items"             "SELECT COUNT(*) FROM order_items i WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = i.order_id)"
bad "append-only triggers present"   "SELECT 3 - COUNT(*) FROM pg_trigger WHERE tgname IN ('inventory_movements_append_only','audit_logs_append_only','order_status_history_append_only')"

# RPO: how much recent activity the backup would have lost = newest row in source minus newest row in the copy.
SRC_LAST=$(psql_ -d "$SOURCE_DB" -c "SELECT COALESCE(EXTRACT(EPOCH FROM MAX(created_at)), 0)::bigint FROM audit_logs")
DRILL_LAST=$(psql_ -d "$DRILL_DB" -c "SELECT COALESCE(EXTRACT(EPOCH FROM MAX(created_at)), 0)::bigint FROM audit_logs")
RPO=$(( SRC_LAST - DRILL_LAST ))
echo "measured data-loss window for this backup (RPO sample): ${RPO}s"

psql_ -d postgres -c "DROP DATABASE IF EXISTS $DRILL_DB WITH (FORCE)" >/dev/null
if [[ "$FAIL" == "0" ]]; then echo "RESTORE DRILL PASSED (restore took ${RESTORE_SECONDS}s)"; else echo "RESTORE DRILL FAILED" >&2; exit 1; fi
