# Velovest personal migration — 2026-09-16

Target deployment: `victorconsultant` and `victorconsultant-drive` on
`lextokprod02`, `/opt/victorconsultant`, HTTPS `chat.velovest.lextok.com`.
Source framework: **3.12.0**. Target: **4.0.0-beta.13**, personal SQL schema20.
This is separate from Invage on lextok03. Preserve the **consultant** profile.

## Verified source model

Two current user documents and one historical `.yaml.bak-20260822-demo` backup, one v3 usage document, 13 drive files, five
session files, three chat files, one operational health file and one ephemeral
browser-session file: 27 files total. Domain fields include portfolio, treasury,
playbook, broker connections, cash and deposits; full documents must compare
exactly after decryption. Existing password hashes and auth tokens remain.
No invitations, demo settings, books database configuration, notes, tasks or
organization records are present. Existing shared databases `invage_books`
and `utarus_binary_beta` are outside this migration.

One current user has no usage file. The explicit migration policy initializes that
account at `2026-09-16T00:12:39.000Z`, with zero historical counters; the existing
v3 usage account is copied unchanged. No historical activity is fabricated.
The fresh database initializes disabled demo mode. Old browser sessions are
invalidated; source bytes remain in recovery backups.

## Adapter and host

`scripts/migration/velovest-v4.mjs` is specifically scoped to the inspected
3.12.0 layout. It rejects unsupported families and symlinks, hashes every file,
imports users and usage in one transaction, records the manifest and initialization
policy, reconciles complete documents and opening usage, and verifies replay.
It does not mislabel 3.12 as the framework importer's supported 3.15 source.

Velovest runs without bot transports. `WEB_ONLY=true` explicitly starts the HTTP
host and scheduler without inventing a CLI identity or keeping stdin alive.
Both units must drain with SIGTERM/90 seconds and share an explicit personal
runtime database/key. The consultant profile remains selected.

## Acceptance gates

1. Graceful offline snapshot, original code/config/dependencies backup,
   encrypted off-host copy and actual restore checks.
2. Isolated import and replay, full document/credential/usage verification,
   consultant framework startup and all existing account authentication.
3. Stop both writers; compare final domain state with rehearsal; preserve final
   operational telemetry. Import dedicated production SQL and verify.
4. Canonical agent-ops deployment of both Velovest services. Verify login,
   authenticated domain/files/chat access, public health, and persistence after
   a controlled graceful restart.
5. Paired production SQL/files/key/code backup; isolated SQL restore and
   decrypted reconciliation, with encrypted off-host recovery copy.

Recovery: `/var/lib/velovest-recovery-20260916` on lextokprod02, plus ignored
`backups/velovest-v4-20260916/` off-host. Database environments are protected
under `/etc/velovest/`. No scheduled backup job is added by this migration.

Before any v4 writes, rollback can restore the exact captured v3 set and units.
After v4 writes, preserve/reconcile SQL and retained files; never downgrade only
the package pin or discard new user data.

## Execution evidence

- Source snapshot: 27 files. The users directory contains two canonical users
  plus one same-identity historical backup, retained unchanged. One current
  usage account was absent and explicitly initialized; one v3 account preserved.
- Full rehearsal reconciliation and replay passed for both users, including
  all custom domain fields and credentials, plus usage and opening balances.
- Rehearsal manifest SHA256:
  `771c62c6c4951b0b4314ab17a6e61a22519727acc5b18f55bcebeea2413a4bec`.
- Final production manifest SHA256:
  `30937bde9e1dc3c43188c85530f4371b937351698162f5a683a1c536e18cdc90`.
  Only operational health telemetry changed between snapshots. Final user,
  domain, drive and transcript bytes matched the rehearsal before cutover.
- The original encrypted recovery archive was copied off-host, checksum-checked,
  decrypted and restored; all 27 source file hashes matched.
- Linux build passed. Seven migration tests passed. The shared domain code's
  431-test regression run from the Invage migration remains applicable; it was
  not re-run against production or claimed as a new Velovest test run.
- Consultant-framework smoke passed: existing tokens, real browser sessions,
  full aggregates, broker APIs, anonymous denial and graceful framework stop.
- Actual WEB_ONLY host smoke passed with closed stdin and no CLI identity,
  then clean SIGTERM exit0. It used a firewall-blocked rehearsal port and
  placeholder external-provider credentials; no model messages were sent.
- Independent code review approved the adapter and web-only lifecycle.
- Rehearsal SQL restored into a separate database with original ownership/ACLs;
  full decrypted record reconciliation passed.
- Production configuration/admin mappings validated in place without copying
  the production environment into rehearsal. Books remained unconfigured.
- Production imported transactionally into `velovest_v4_20260916`; both current
  user documents and usage accounts reconciled before canonical deployment.
- Canonical `fast-deploy.sh victorconsultant --rsync-code` deployed both units
  using the same tested Linux dependency artifact. Profile remains `consultant`;
  service user is `velovest`; direct node entry replaces the legacy stdin pipe.
- Live first-start checks: login on3030/3031, public HTTPS health beta.13,
  both existing token identities, broker APIs, eight visible drive entries,
  two conversations and 26 original non-operational files verified. Operational
  health telemetry remains mutable. Both units had zero restarts.

No other agent service or existing shared database was changed by this upgrade.

### Final acceptance

Upgrade completed. Both units drained successfully, then restarted through the
canonical script with `Result=success`, `NRestarts=0`, `ActiveState=active` and
`SubState=running`. Full production reconciliation and live authenticated
broker/files/chat checks passed again after restart. Public HTTPS health
reports **4.0.0-beta.13**.

The actual production SQL dump restored into
`velovest_v4_restore_production_20260916` with original ownership and ACLs;
full decrypted user/credential/domain/usage reconciliation passed. The paired
v4 SQL/files/key/config/code bundle was encrypted, copied off-host, checksum-
verified, decrypted and restored locally. Its SQL format, key configuration,
exact beta.13 dependencies and all 26 original non-operational source files
were verified. Operational health telemetry was captured in both snapshots
and may change normally while the host runs.

Existing browser sessions require reauthentication. Permanent tokens and
password hashes are unchanged; no plaintext password reset was performed.
Source changes remain in the local working tree; deployment used the reviewed
clean rsync artifact rather than a new git commit.
