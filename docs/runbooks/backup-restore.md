# Runbook: backup, restore and the restore drill

**Targets (proposed, confirm before launch):** RPO ≤ 15 minutes, RTO ≤ 1 hour. A backup that was never restored is not a backup.

## Routine

- Production: use the managed database's automated snapshots + point-in-time recovery (RPO minutes), retention ≥ 14 days, stored in a different region/account. Object storage: enable versioning.
- Portable dump (any environment): `BACKUP_PASSPHRASE=… infrastructure/scripts/backup.sh backups` → encrypted `nona-<UTC>.dump.enc` + `.sha256`. Keep the passphrase in the secret manager, never next to the backup.
- Schedule the dump at least daily and ship it off-host.

## Restore drill (run monthly and after any data-rewriting migration)

```bash
BACKUP_PASSPHRASE=… infrastructure/scripts/restore-drill.sh backups/nona-<UTC>.dump.enc
```

It verifies the checksum, restores into a scratch database (never the live one), compares row counts with the source, runs integrity checks (order totals, item totals, no negative stock, history present, paid payments have a transaction number, refunds ≤ payment, append-only triggers present), prints the measured RPO sample and drops the scratch DB. **Exit code ≠ 0 = drill failed → treat as an incident.**

Last drill (local, 2026-10-10): passed, restore 1 s, RPO sample 0 s; corrupted-file case correctly rejected.

## Real restore

1. Stop writers: scale web/api/worker to 0 (payments are safe: provider callbacks are retried and reconciliation re-checks pending payments).
2. Restore to a **new** database; run `pnpm db:migrate` (no-op if the dump is current) and the drill's integrity queries.
3. Point the services at it; start API first, then worker, then web.
4. Run `payments-maintenance` (worker does it every 30 s) and review `/admin/system`: restored `PENDING` payments are reconciled against the provider, so orders paid during the data-loss window are found and settled or refunded.
5. Announce the data-loss window; replay anything from provider dashboards if needed.
