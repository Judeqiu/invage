# Velovest execution journal deployment — 2026-09-17

Deployed the working tree on `feat/victor-consultant` to inventory target `victorconsultant` on `lextokprod02`, `/opt/victorconsultant`. Both units are `victorconsultant` and `victorconsultant-drive`; public URL is https://chat.velovest.lextok.com. Framework remained 4.0.0-beta.13 and no database migration was performed.

A 308-file release was staged at `/private/tmp/velovest-release-20260917` from version-controlled and intended untracked source files, excluding secrets and local recovery artifacts. Rsync dry-run showed no deletions. Local build and 73 targeted regressions passed against disposable PostgreSQL 18. The existing live-market dashboard test needed a 30-second test timeout.

Both services were gracefully stopped and verified with MainPID=0, Result=success and no remaining database client connections. Paired database, code/dependencies, retained files, environment/key and service configuration were backed up to `/var/lib/velovest-recovery-20260917-journal`. The encrypted backup and protected recovery key were copied into ignored `backups/velovest-journal-20260917/`; SHA-256 and archive decryption/listing passed. This deployment did not perform a new SQL restore rehearsal.

Canonical deployment used the installed `.agents/skills/agent-ops/scripts/fast-deploy.sh` path, since the legacy `.Codex/skills` path is absent:

```
fast-deploy.sh victorconsultant --rsync-code --local-root=/private/tmp/velovest-release-20260917 --services=victorconsultant,victorconsultant-drive --npm
```

The script's framework re-stream moved a mode-0700 temporary directory into `node_modules/utarus`, blocking the separate `velovest` service user and causing startup failures. Both units were stopped, the package directory was corrected to mode 0755, and canonical `fast-deploy.sh ... --no-pull` restarted the services successfully. No deployment script was modified.

Live verification passed for both existing token identities: execution journal, broker connections, files and conversations. Anonymous journal requests returned 401. Login pages on ports 3030 and 3031 and the public journal asset passed. HTTPS health reported 4.0.0-beta.13. Both units were active/running with Result=success and NRestarts=0 after recovery.

No historical executions were imported into real accounts during deployment. Users must sync an Activity Flex query with execution-level Trades or upload historical XML to populate the journal. Cash/NLV and the PATH discrepancy remain separate reconciliation work.
