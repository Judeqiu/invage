# WalletStreet beta.53 to Utarus v4 migration

## Target and safety boundary

Production is `walletstreet` at `lextokprod02:/opt/financialexpert`, with
`financialexpert` and `financialexpert-drive` systemd units. The 2026-09-26
cutover from Utarus `3.0.0-beta.53` to `4.0.0-beta.13` is complete. The deployed
WalletStreet source is the local `walletstreet` branch rebased on
`origin/feat/victor-consultant`, including the local v4 startup fix.
The application has no server Git checkout, so use the canonical agent-ops
`fast-deploy.sh walletstreet --rsync-code --local-root=... --services=financialexpert,financialexpert-drive`.

The v4 database is mandatory. The live v3 host also uses the separate
`invage_books` PostgreSQL database. Preserve and restore both stores together;
the application does not provide a single transaction across them.

## Source inventory and adapter

The inspected live file snapshot contains 358 files. The explicit
`scripts/migration/import-walletstreet-v4.mjs` policy imports 4 complete user
documents, 4 usage accounts (2 v1 converted by the recorded credit rates),
2 invitations, demo mode, 1 note, 11 tasks, 153 notifications, and 1 unbound
widget state. It retains 341 files, including chats, sessions, Drive, reports,
knowledge, backups, onboarding tokens, share links, reporting, and notification
rate state. Three ephemeral browser/link stores are invalidated. The importer
rejects unrecognized files, symlinks, running tasks, changed source hashes,
wrong framework versions, and reused import IDs with a different manifest.

## Completed rehearsal

- A restricted encrypted off-host archive of production data/configuration was
  decrypted and inspected; it contains 406 tar entries. The encrypted books
  dump is readable and restored to a separate test database with 4 households,
  74 journal entries and 148 journal lines, matching live read-only counts.
- An isolated v4 personal database imported the 358-file source. Full user
  documents, usage/opening states, invitations, demo settings, notes, tasks,
  notifications, widgets, and source hashes reconciled within the transaction.
  Import manifest SHA-256:
  `0b0ecbdb25130fbb75301c3c14544f9f93d8b18bdcf2f2cdd197e1b900f18b65`.
- A second import with the same ID and immutable source was a no-op. A source
  copy modified by a web smoke was rejected, as required.
- The isolated v4 framework web/auth smoke passed for all 4 existing users,
  including full documents, credential resolution, sessions, broker API and
  anonymous denial. Chat channels and schedulers were disabled.
- The v4 rehearsal SQL dump restored into a second isolated database. It has
  4 users, 11 tasks, 153 notifications, 1 note, and 1 widget; v4 schema
  readiness and the matching encryption key binding passed there.
- An on-host root-restricted preliminary rollback archive of the existing
  application tree and two unit definitions contains 38,187 entries.
- A dedicated empty v4 production personal database was initialized with its
  separate key and passed schema/key readiness. Both existing units now have
  SIGTERM and a 90-second stop window via systemd drop-ins; neither service
  was restarted when these settings were installed.
- The approved encrypted v3 data and books backups and the protected production
  database credentials are retained under ignored, mode-0700
  `backups/walletstreet-v4-20260926/`. Checksums passed after copying. Local
  plaintext rehearsal copies were removed after the tests.

## Completed cutover

1. Exported the full pre-cutover application tree and units to encrypted off-host
   `v3-precutover.tar.zst.enc`. Put the public Caddy route into maintenance mode,
   gracefully stopped both units, then captured consistent `v3-final.tar.zst.enc`
   and `books-final.dump.enc`. The final source manifest matched rehearsal exactly.
2. Imported the final source to the dedicated `walletstreet_v4_prod` personal
   database. The imported counts were 4 users and usage accounts, 2 invitations,
   1 note, 11 tasks, 153 notifications and 1 widget; 341 retained files were
   unchanged byte for byte. `invage_books` remained separate at 4 households,
   74 journal entries and 148 lines. Preserved encrypted `v4-imported.dump.enc`.
3. Deployed the rebased code and prebuilt Utarus package with the canonical
   `fast-deploy.sh` using `--rsync-code`. The npm refresh exhausted Node memory
   while building Utarus; installing the two required prebuilt XML dependencies
   (`saxes` and `xmlchars`) completed that dependency. Set the required v4
   notification lease configuration and fixed `src/index.ts` so web/Telegram
   startup does not fall through to CLI startup.
4. Both units were gracefully stopped again for a consistent final v4 recovery
   set: encrypted off-host `v4-final.tar.zst.enc` and `v4-sql-pair.tar.enc`.
   SHA-256 checks passed after decrypting. Both SQL dumps restored successfully
   into isolated databases; the personal schema/key check and matching record
   counts passed. The on-host copies are in
   `/var/lib/walletstreet-recovery-20260926/`.
5. Restarted both units from stopped state. Both were `active/running` with
   `Result=success` and `NRestarts=0`. All four existing user tokens returned
   HTTP 200 on the broker connections API after restart. Restored and reloaded
   the original Caddy route; public `/health` reports v4.0.0-beta.13 and
   `/login` returns HTTP 200.

The encrypted off-host recovery set and separate production key are stored in
the ignored, mode-0700 `backups/walletstreet-v4-20260926/` directory. Preserve
them until the post-migration retention decision. The local branch and migration
scripts have not been committed or pushed.

Rollback must restore the exact v3 code/config/files and the corresponding books
SQL snapshot before v4 accepts writes. After v4 writes, preserve both v4 SQL and
files and reconcile those writes before any downgrade.
