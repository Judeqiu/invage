# Velovest dashboard and Utarus v4.2.12 deployment

Target `victorconsultant` on `lextokprod02`, installation `/opt/victorconsultant`, services `victorconsultant` and `victorconsultant-drive`. Public URL `https://chat.velovest.lextok.com`; the legacy Victor hostname shares the same Caddy block. Keep infrastructure names and local account mode unchanged.

Pin `github:Judeqiu/utarus#v4.2.12`. Read the framework upgrade notes from v4.2.9 through v4.2.12. They require no SQL migration or new secrets. The dashboard refinements and framework integration are already committed; this rollout replaces the temporary framework commit pin with the released version.

Verify production source against its previous committed deployment before replacement. Velovest is a source mirror without Git; compare all deployed source files and identify extras rather than assuming a clean worktree. Create the incoming source tree with `git archive` from the clean, pushed Invage deployment commit. Attach the locally installed, built framework package matching v4.2.12 to that staging tree.

Before deployment, place only the Velovest Caddy block in maintenance mode. Gracefully stop both services and confirm no client connections remain in `velovest_v4_20260916` or `velovest_books`. Capture and verify a paired source/configuration, framework, retained-file, system configuration and database backup. Keep an encrypted verified off-server copy using the existing recovery key.

Deploy through Agent Ops `fast-deploy.sh victorconsultant --rsync-code --force-utarus --local-root=<committed archive staging>` with both services selected. No remote framework reinstall is needed. Verify the application source against the incoming commit, installed framework version and representative framework bundle hashes, database readiness, both services active and both local login endpoints returning 200. Then restore the saved Caddy configuration and verify public login and served dashboard assets.

Confirm the deployed dashboard includes premium before fees with a separate brokerage-fee card, gross short-put assignment obligation, an above-30-percent radar with search, historical monthly cash flow and recorded realized P&L, Entry Spot fallbacks and Open/Timeline/History/Rolls views. Dashboard sessions start on Open. The date navigation, Latest and dashboard Refresh controls are removed; reload the page to fetch updated dashboard data. The consultant's chat uses Velovest AI and optional supporting explanations expand under the visible answer. Actual execution-time underlying quotes are unavailable in the imported execution model, so Entry Spot remains a clearly labelled adjusted-close reference.

Save the deployment receipt, source and framework checksums and off-server verification with the new backup. After every check succeeds, retain that newest complete deployment backup and remove only the older complete deployment set. Preserve broker/import evidence and migration/rehearsal snapshots.

Rollback uses the previous source and matching framework package plus the same database/account configuration. Preserve the paired backup. No SQL downgrade is required; the saved dashboard preference migration does not delete other preferences.
