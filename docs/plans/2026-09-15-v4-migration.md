# Invage v4 personal-account migration

## Scope and current status

Requested: upgrade Invage to Utarus v4 while preserving users and data.
User confirmed personal accounts; do not introduce organizations/shared channels.

This is an inspected migration plan, not a completed migration. Production has
not been stopped, modified, backed up, or migrated by this task. No database or
encryption key has been created. No package pin has been changed by this task.

## Verified baseline (2026-09-15)

| Item | Evidence |
| --- | --- |
| Inventory target | `invage` and `invage-drive`, SSH `lextok03`, `/opt/invage` |
| Services | Both active; SIGTERM; 90-second stop timeout; run as root |
| Production framework | Installed `3.0.0-beta.42` |
| Production checkout | HEAD `bd4c096`; extensive tracked modifications and untracked product code |
| Local framework | Manifest and installed package `3.12.1` |
| Existing local edits | Package/lockfile bump from `3.12.0` to `3.12.1`; preserve these edits |
| Selected target | `v4.0.0-beta.13`, commit `9d560346b643a6dadbcc8498bbe9b164c30da84a`; verified against origin tags |
| PostgreSQL | Existing PostgreSQL 18 main cluster, port 5432, online |
| Data root | `.env` explicitly specifies `/opt/invage/data` |
| Database environment | Neither `UTARUS_DATABASE_URL` nor `INVAGE_BOOKS_DATABASE_URL` in production `.env`; inspect process/unit overrides before concluding no external books database exists |
| Storage | Data directory approximately 1.4 MB; filesystem approximately 12 GB free |
| Product configuration | `INVAGE_PRODUCT_PROFILE` absent from production `.env`; resolve intended roster from live code/unit before using newer local host |

## Data model and migration mapping

Target source of truth: target tag's `docs/database-data-model.md`,
`docs/database-beta.md`, schema registry, repositories, and importer source.
PostgreSQL is mandatory in v4, including personal mode. File-backed domains
remain authoritative only where explicitly supported; they are not fallbacks.

The three live user records contain `user`, `profile`, `log`, `portfolio`, and
`playbook`. Identity fields include stable IDs/slugs, creation dates, portal
tokens, password hashes, and Slack/Telegram identity arrays. Preserve every
field and its presence/absence; do not generate replacement users or credentials.

| Source family | Observed files | Required disposition |
| --- | ---: | --- |
| `users` | 3 | SQL user aggregate; exact identity/profile/custom-state reconciliation |
| `usage` | 3 | Mixed schema versions 1 and 3; explicitly convert v1 with verified semantics, preserve original history/counters and v3 balances |
| `invites.yaml` | 1 | SQL encrypted invitation records; preserve redemption metadata |
| `demo_mode.yaml` | 1 | Currently disabled; preserve `updated_at` and `updated_by_slack` metadata with explicit SQL migration |
| `chats` | 6 | Retain exact files and ownership |
| `sessions` | 1 | Retain transcript files; distinct from browser authentication sessions |
| `drive` | 38 | Retain reports/uploads/product files and access ownership |
| `reports` | 8 | Retain exact files and link behavior where supported |
| `kb` | 22 | Retain knowledge files; verify target runtime paths and resolution |
| `onboard_tokens.yaml` | 1 | Retain domain onboarding authority; verify binding flow under async registration |
| `backups` | 4 | Preserve historical recovery files, never import as current users |
| `.sessions.json` | 1 | Preserve backup; invalidate old browser sessions during cutover |
| `.link-tokens.json` | 1 | Preserve backup; invalidate ephemeral links explicitly |
| `.telegram-link-codes.json` | 1 | Preserve backup; invalidate ephemeral link codes explicitly |
| `share-links.json` | 1 | Empty object verified; preserve recovery bytes and verify target consumer |
| `notes`, `tasks`, `notifications` | 0 | Recheck final snapshot; any new records require covered migration |

Inventory is from live reads, not a consistent offline snapshot. Counts must be
rechecked and every file hashed after all writers stop.

## Blocking compatibility boundary

The target's `import-beta` is explicitly for v3.15.0 at a fixed source commit.
It rejects unrecognized source families. Invage's `kb`, `backups`,
`demo_mode.yaml`, `onboard_tokens.yaml`, and `share-links.json` are outside that
policy. The lower-level historical importer also checks supported source
version/commit and does not provide a universal migration.

Live usage files contain both version 1 and version 3 records. The target
historical importer requires usage version 3. Therefore merely extending its
retained-file allowlist would still not migrate this source correctly. Verify
the original and target credit/cost models before defining a lossless conversion;
do not invent credit balances from historical USD telemetry.

Do not claim this beta.42 dataset is v3.15, remove files to pass the importer,
use user-only import as a complete migration, or run an intermediate v3 release
against live data merely to satisfy a version label. A verified Invage-specific
migration path is required before production cutover.

## Required execution phases

1. Preserve the actual live code/configuration, including untracked files and
   package contents needed for rollback. Compare live code against local code;
   do not overwrite production changes with an unchecked `git pull` or rsync.
2. Adapt host and domain APIs against the exact v4 tag:
   - Open and bind the personal database before state-dependent imports.
   - Pass the runtime to `createFramework`.
   - Await lookups, session state, registration, web startup and signed links.
   - Carry the revision read with each user snapshot into every write. No
     reread-and-overwrite workaround, hidden revision cache, or YAML dual-write.
   - Replace YAML-writing admin bootstrap with explicit database behavior that
     preserves existing linked identities.
   - Adapt agent enrichment, portfolio/household/reconciliation tools, broker
     persistence, onboarding and dashboard reads; propagate async contracts.
   - Drain both entry points on signals before releasing bindings/closing pools.
   - Check all dependencies, including `pg`, in the deployed package layout.
3. Implement and verify an explicitly versioned source migration policy, using
   the target repositories/transactions. Validate every file family, fail on
   unsupported/new content, reconcile full user documents and usage exactly,
   and preserve import identity/checksums. Include demo state and retained
   product files. Test identical replay and changed-source rejection.
4. Prepare an isolated rehearsal environment on PostgreSQL 18 with a dedicated
   database/login and restricted secret file. Inspect existing databases/roles
   first. Do not reconfigure or restart the shared cluster. Disable outbound
   bots, mail, billing and scheduled delivery during rehearsal.
5. Arrange the maintenance interval, quiesce ingress, gracefully stop both
   writers, verify that they have stopped, and take an authoritative snapshot.
   Back up code, config, units, framework package and all files with restrictive
   permissions and verified hashes. If books SQL is discovered, include its
   consistent dump. Preserve secrets without logging them.
6. Rehearse import and restored application against that immutable snapshot.
   Compare all three identities and credentials, complete user documents, usage,
   invites, demo state, retained-file checksums and ownership. Verify existing
   password login, old chats, note revision conflicts, cross-user denial and
   persistence after restart. Test restore, not just archive listing.
7. Import/check the dedicated production personal database only after rehearsal
   passes. Keep the matching encryption key in protected recovery material.
   Deploy through the canonical script with
   `--force-utarus --services=invage,invage-drive`, using the reviewed code-sync
   method. The script forcibly restarts processes, so drain writers beforehand.
8. Verify both service versions/status, database readiness, authentication,
   existing chats/files, knowledge, domain onboarding and portfolio operations.
   Reopen traffic only after checks pass. Users must sign in again; permanent
   credentials are preserved.

## Rollback

Before users write to v4, rollback restores the exact v3 code/config/files and
service topology captured at cutover. After v4 accepts writes, retain SQL,
files and the encryption key and reconcile those writes before reverting.
Changing only the framework pin would expose stale YAML and is not a rollback.
Never reset or drop a live database to make a downgraded host start.

## Acceptance gates (evidence recorded below)

- Host compatibility build and meaningful database-backed regressions.
- Explicit migration support for this source release and every populated family.
- Immutable offline snapshot, encrypted off-host recovery copy and restore test.
- Full record/credential reconciliation and retained-file hashes.
- Controlled cutover and post-deployment ownership/persistence smoke checks.

## Local baseline validation

`npm run build` passed on the existing local v3.12.1 dependency. A socket-enabled
test rerun reported 418 passed and 12 skipped, with two failing books suites
because local PostgreSQL at port 5432 refused connections. All other 47 suites
passed. This is not full database validation or v4 validation. The initial
sandboxed run also had socket-permission failures, resolved by the rerun.

## Execution evidence — 2026-09-15

Target: **v4.0.0-beta.13**, framework commit
`9d560346b643a6dadbcc8498bbe9b164c30da84a`; actual schema registry reaches **20**.
Production source was **3.0.0-beta.42**, not the local v3.12.1 pin.

- Implemented explicit personal-mode runtime ownership and revisioned domain
  saves. Domain aggregates retain every custom field. Optional JSON fields are
  omitted explicitly; undefined values and stale updates fail.
- Production had no books database; `INVAGE_BOOKS_DATABASE_URL` was verified
  absent and remains absent. This run does not certify books-enabled
  cross-database journal/aggregate atomicity.
- Custom transactional importer supports the inspected beta.42 layout. All
  three complete user documents (including portfolio, playbook, log, profile,
  credential hashes/tokens and channel identities) reconciled exactly.
- Usage: three records; two v1 records converted using recorded raw-counter
  credit rates, retaining original telemetry including video counters. Existing
  v3 record unchanged. Opening state also compared.
- Two invitations reconciled exactly. The beta.42 Slack redemption omitted
  `used_by`; the adapter preserves SQL NULL rather than inventing a Telegram ID.
- All 92 source files hashed. 81 retained files include drive/reports, chats,
  sessions, knowledge, onboarding tokens and historical backups. Three ephemeral
  auth files are no longer authoritative; old sessions/short-lived links are
  invalidated by the fresh SQL auth store. Permanent credentials are preserved.
- Import ID `invage_beta42_20260915`, manifest SHA256
  `38809c92fba7911d5214cd42c00a3b7fc314d815d1bb55a906316448849adbf4`.
  Replay was a no-op; final stopped-source hashes matched the rehearsal exactly.
- Linux build passed. Full database-backed regression: **50 suites / 431 tests
  passed**, no skips/fatal teardown errors. Migration tests: **6 passed**.
  Tests cover complete aggregate preservation, stale revisions, funds,
  onboarding, books fixture behavior and dashboard domain reads.
- Rehearsal full-framework boot, all three existing permanent tokens, issued
  browser sessions, domain broker APIs and anonymous rejection passed. Plaintext
  user passwords were not available: their unchanged hashes were reconciled,
  rather than resetting credentials or claiming a typed-password login test.
- Rehearsal SQL dump restored to `invage_v4_restore_20260915`. Read-only verifier
  checked decrypted users/credentials, usage/opening state, invitations, demo
  settings and schema readiness after restoration.
- Encrypted v3 off-host archive was decrypted locally, and every one of its 92
  data files matched the captured manifest. Exact old code, Linux dependencies,
  service definitions and environment were present.
- Canonical deployment used a clean source tree and the Linux dependencies from
  rehearsal. Both units run as `invage`, with the same protected database env,
  personal profile `full`, SIGTERM and a 90-second drain window.
- Canonical stream creates its framework directory with `mktemp` mode 0700.
  This blocked the non-root runtime during the first startup. Corrected that
  directory to 0755, verified readability, then used canonical `--no-pull`
  restart. Future forced streams must account for this deploy-script behavior.
- Live HTTP: login on 3001/3002, public HTTPS health reporting beta.13,
  all three existing token identities, domain broker API, drive listing and
  chat history access passed. All 92 original files remained hash-identical.
  Both services were stable with zero restarts after the permission correction;
  Slack connected. No model prompts or outbound user messages were sent.

Recovery locations (private; never commit credentials):

- Server: `/var/lib/invage-recovery-20260915` (v3 archive/source, v4 SQL and
  encrypted complete recovery bundles).
- Off-host: ignored `backups/invage-v4-20260915/` (encrypted bundles, checksums,
  restricted recovery key).
- PostgreSQL roles/databases are dedicated to this agent. Existing Lydia
  databases and the shared PostgreSQL 18 configuration were unchanged.

Migration commands require `npm run build` because the policy imports compiled
credit rates. Run them from the built rehearsal/migration workspace with the
explicit target env file; the production host itself runs source with tsx.

### Final acceptance

Completed production upgrade and post-restart verification. Both units have
`Result=success`, `NRestarts=0`, `ActiveState=active`, `SubState=running`.
Public HTTPS `/health` returned 200 and `version=4.0.0-beta.13` at
`2026-09-15T14:21:41Z`. Full production aggregate/credential/usage/invitation
verification passed again after restart.

The final v4 shutdown drained both writers successfully. Its consistent
production SQL dump was restored to `invage_v4_restore_production_20260915`;
full decrypted reconciliation passed with the production key. The complete
v4 encrypted bundle was downloaded, checksum-verified, decrypted locally and
checked for the SQL dump, key configuration, exact beta.13 dependencies and
all 92 original data files. Both the v3 and v4 recovery paths have restore
verification evidence. No production user records were fabricated or reset.
