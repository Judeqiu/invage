# Session-bound BinDrive

The v4 user-state tool deliberately returns only public profile fields. Legacy BinDrive tools still require model-supplied auth_token; the reported Victor session sent the literal REDACTED and received 401 on list, download and upload.

Use the framework's authenticated tool-factory userSlug to bind all four BinDrive tools for every host/specialist. Read current database-backed credentials within the host on each operation and call the existing HTTP API so portal authorization, file validation and drive aliases remain authoritative. Credentials never enter tool schemas or results. Model-supplied identity/token fields cannot change the bound account. Incognito overrides fail closed instead of leaving legacy credential-based tools available. Missing identity, deleted accounts, missing credentials and HTTP failures throw and are logged; there is no fallback or cache.

Update skill descriptions to describe automatic authentication. Verify token-free operations, account isolation, credential rotation, incognito, exact downloaded JSON text, HTTP failures and registration on every consultant agent. Live verification uses a uniquely named temporary file and removes it afterward.

## Verification and deployment

`npm run build` passed. `npx vitest run tests/bindrive-auth.test.ts tests/raw-data.test.ts` passed all 13 tests. `git diff --check` passed.

Deployed to Victor Consultant (`lextokprod02:/opt/victorconsultant`) using the installed `.agents/skills/agent-ops/scripts/fast-deploy.sh` (legacy `.Codex/skills` path is absent). Release staging at `/private/tmp/bindrive-release-20260917` preserved the deployed baseline; checksum dry-run showed only four modified source files, the new bound tools, the test, and this document, with no deletions. Framework stayed at 4.0.0-beta.13; no database migration. Prior source backup: `/tmp/victor-bindrive-before.N05MaV/source.tgz` on the target host. Both services stopped gracefully with MainPID=0 and Result=success before the canonical deployment restart.

Live smoke under the service account and its database configuration constructed each consultant extension's registered tools for the affected account. A unique temporary UTF-8 file passed upload, list, exact-content download, deletion, and absence-after-deletion. No credential argument was provided. Anonymous `/api/files` remained 401; both 3030 and 3031 login endpoints returned 200. Both services were active/running, Result=success, NRestarts=0. No user account, login session, or existing file was changed.
