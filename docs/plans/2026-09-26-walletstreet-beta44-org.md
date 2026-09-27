# WalletStreet beta.44 organization cutover

## Requested state

- Utarus `v4.0.0-beta.44`.
- Organization mode enabled with multiple organizations permitted and multiple members per organization. Utarus permits one organization membership per user.
- `qiu` organization containing the four current users: `admin-slack-u0bgs6lc5c2` (organization admin), `cy`, `david`, and `marina` (members).
- Shared organization room available in WebUI. Personal portfolios and books remain personal.

## Prepared and rehearsed

- WalletStreet production is `lextokprod02:/opt/financialexpert`, units `financialexpert` and `financialexpert-drive`. The public Caddy route is on `lextok03`.
- Production was Utarus beta.13, database `walletstreet_v4_prod`, personal mode, schema 20, four active users.
- The beta.44 framework package was built from GitHub tag `521e8d7bab50ed968d21d1468b384c74c8dc4b8c`; the agent source compiled against it in an isolated local install and again after a clean local dependency install. The test suite passed 440 tests in 48 files; 13 database integration files require the unavailable `UTARUS_TEST_DATABASE_URL` fixture and did not run.
- A production SQL snapshot was restored to `walletstreet_v4_beta44_rehearsal_20260926`, migrated to schema 22 with the beta.44 CLI, and passed `check personal`.
- `scripts/migration/enable-qiu-org.mjs` dry run and apply succeeded on the restored database. `check org` passed. Memberships reconciled as requested and the `general` room was created in the isolated data copy.
- The beta.44 package and new registry dependencies load successfully in a staging directory on the host.
- Both production units were gracefully stopped behind a temporary maintenance route. A consistent on-host backup was captured under `/var/lib/walletstreet-beta44-backup/` and its SQL archives and retained-file archive passed format and checksum checks. Both SQL dumps were restored into separate isolated databases; the WalletStreet restore has personal mode, schema 20, four users, and the books restore has eight public tables.
- Production services and the original public route were restored while the off-host backup export remains pending. `/login` returned HTTP 200 and the live package remains beta.13. No production schema or organization change has been applied.
- On 2026-09-27, the user authorized proceeding with production deployment. The new cutover did not start: direct SSH to `lextokprod02` and `lextok03` repeatedly stalled during banner exchange. A direct HTTPS check to the real Caddy IP returned HTTP 200 for `/login`. Retry the read-only host preflight before any maintenance change.

## Production cutover, 2026-09-27

- The public Caddy route was placed in maintenance mode and both units were gracefully stopped. A fresh paired recovery set was captured at `/var/lib/walletstreet-beta44-backup-20260927/`, checksummed, and restore-tested in isolated databases. The WalletStreet restore had personal mode, schema 20, and four users; the books restore had eight public tables.
- The beta.44 CLI migrated the live WalletStreet database and passed `check personal`. The organization conversion dry run identified exactly the four expected users; apply created `qiu`, its four memberships, and the `general` room. `check org` passed.
- The canonical `fast-deploy.sh` command above deployed beta.44 and restarted both services. Both units were active, the installed framework reported `4.0.0-beta.44`, the room file existed, and local `/login` returned HTTP 200. Recent service logs showed normal startup without errors.
- The original Caddy route was restored and public `/login` returned HTTP 200.
- The authorized encrypted off-host copy of the fresh recovery set completed at `backups/walletstreet-v4-20260926/beta44-before-20260927.tar.enc`, with a SHA-256 sidecar. Decryption and archive listing succeeded.

Do not downgrade beta.44 against schema 22. Any rollback must use the paired code, SQL, retained files and encryption key from before the upgrade, with reconciliation of writes accepted after the cutover.
