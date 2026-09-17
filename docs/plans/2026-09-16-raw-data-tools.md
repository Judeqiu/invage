# Raw-data retrieval

Current model: successful IBKR sync archives response bytes in each user's
`drive/<slug>/ibkr-flex/`. Parse failures retain raw bytes and triage metadata
in `broker-raw/<connector>/`. Only IBKR currently has an automatic connector.
Other channels can have uploaded source files; portfolio rows do not imply that
an original statement exists. SQL user state and connector credentials must
never be traversed by this reader.

Provide `list_raw_data` and `fetch_raw_data` to the host and specialists, bound
to the framework's authenticated user slug rather than a model-supplied identity.
List and retrieve existing files only; no broker sync or portfolio mutation.
Recognize existing archive layouts explicitly. All other uploaded drive files
remain retrievable with provenance marked unverified rather than inventing a
channel. Expose relative IDs, byte size, timestamp and paginated original bytes.
UTF-8/base64 reads are explicit, bounded and report continuation; no silent
truncation. Reject traversal, symlinks, directories and cross-user paths.

Alternative: extending only the old failure-triage reader misses successful
syncs and uploaded files. A new mandatory archive format would require rewriting
existing files without improving retrieval. Use the existing per-user drive
as the source of truth and describe provenance honestly.

## Shipped verification

Deployed to Velovest only through canonical agent-ops after draining both
services and taking a paired encrypted SQL/source/files/config backup. Existing
framework/dependencies remain v4.0.0-beta.13; no database schema change.

- Build passed; 41 targeted tests passed on Linux, including roster registration,
  user binding, cross-user/path/symlink rejection, stale versions, exact binary
  reads and multibyte UTF-8 pagination. Independent code review approved.
- Consultant framework authentication rehearsal passed for both current users.
- Live tool factories include both tools for all five consultant agents; tools
  are excluded from incognito. Live execution for both users listed 13 files and
  compared the first 256 returned bytes of each with the stored source, without
  printing account data. All comparisons passed.
- Both services active, Result=success, zero restarts. Public health beta.13
  verified at 2026-09-16T00:54:14Z.
- Live inventory contained three successful IBKR response archives, five triage
  files and five other Drive files. Uploaded files/generated reports are labeled
  with unverified provenance; no original source or provider support is invented.
- Recovery: server `/var/lib/velovest-raw-tool-recovery-20260916`; encrypted
  off-host `backups/velovest-v4-20260916/pre-raw-tool.tar.zst.enc`, checksum verified.
  Unchanged dependencies are in the preceding full v4 recovery bundle.

Retrieval uses saved files. It does not perform new provider downloads; use the
existing IBKR sync operation first when a fresh IBKR statement is needed.
