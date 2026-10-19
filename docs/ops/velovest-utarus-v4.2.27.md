# Velovest — Utarus v4.2.27

Target: `victorconsultant` on `lextokprod02`, `/opt/victorconsultant`, both
`victorconsultant` and `victorconsultant-drive` units. Source branch: `main`.
Pin `github:Judeqiu/utarus#v4.2.27`; release commit
`0d7c6f27f63af5d5e9698beb1d2f55f12823cb4c`.

This rollout includes the committed standalone Option risk calculator at
`/option-risk`. Upgrade from Utarus 4.2.18 requires additive migrations 30 and
31. Read all intervening release notes. Preserve a checksummed schema-29 live
SQL and file recovery set with the matching source/framework and encryption
configuration. Record that separate live captures are not an atomic snapshot.
Never initialize the existing database or rotate its encryption keys.

Prepare the clean committed source archive and matching locally installed
framework while the app and Drive remain live. Run the new framework's explicit
`migrate` and `check personal` CLI with Velovest's protected environment before
activation. These migrations add tables without rewriting existing notes. Do
not restart the old framework after migrating to schema 31.

Deploy through Agent Ops `fast-deploy.sh victorconsultant --rsync-code
--force-utarus --local-root=<committed staging>
--services=victorconsultant,victorconsultant-drive`. Keep the stop/start interval
limited to the prepared cutover, and start both replacements immediately. No
backup, transfer or reporting work belongs between stop and start.

Ark image generation uses `ARK_API_KEY` and
`UTARUS_IMAGE_MODEL=doubao-seedream-4-0-250828` in the protected service
environment, independent of chat routing. Preserve the existing reports origin.
Never put the credential in source, commands, reports or logs. Configuration
validation does not prove provider connectivity, model access or paid generation.
Do not generate an image solely for a deployment smoke check.

Verify installed source hashes, framework version, database readiness, both
units, local/public login and served calculator assets. Check ordinary notes
remain available and image capability is configured. Observe logs for startup
and database errors. Capture a complete checksummed post-start live SQL/file/
source/framework/config backup, encrypt and verify its off-server copy, record
a receipt, then prune superseded complete deployment backups. Preserve the
schema-29 migration recovery set and unrelated broker/import evidence.

Rollback across schema 31 requires coordinated database and file recovery with
the original encryption configuration and reconciliation of later writes; a
code-only downgrade to 4.2.18 will fail readiness. If only Ark is unavailable,
keep 4.2.27/schema 31 and disable both optional image settings if needed.
