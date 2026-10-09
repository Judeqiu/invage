# Velovest Utarus v4.0.2 migration

Target: lextokprod02, /opt/victorconsultant, victorconsultant and victorconsultant-drive.
Pin: github:Judeqiu/utarus#v4.0.2, release commit 03ab20e634b6e149f1f7bf4b2f1c60bfa3387597.

The host now uses credential UUIDs for state, tool bindings, notifications, reports,
raw broker files and sync history. Legacy aliases resolve only at compatibility
boundaries. Other instances remain in local account mode unless explicitly configured.

Velovest has a dedicated loopback authority on port 3330, authority and agent ID
velovest, a committed source mirror at /opt/velovest-authority, its own PostgreSQL database velovest_authority, and a protected environment
file /etc/velovest-authority/authority.env. Existing account UUIDs, password hashes, profiles,
usage totals and report/chat ownership must be preserved. Billing is unconfigured;
retain unlimited access and migrate historical usage into its original period.
Do not enroll users into Binary's separate authority or change its services.

Before cutover, validate the clean committed source, restore a matching SQL and file
snapshot into isolated databases, and rehearse all steps. Gracefully stop both writers
for the authoritative backup. Preserve the agent database velovest_v4_20260916,
velovest_books, retained files, encryption keys, environment and service definitions.
Build the private alias-to-UUID map from the original utarus.users rows.

Run the pinned framework database CLI migrate then check personal. Run its
scripts/migrate-user-storage.mjs --data-root ROOT --mapping MAP --migrate-db first
without --apply, review, apply, then repeat the dry run. Product history needs
scripts/migration/migrate-broker-history-owners.mjs with the same map and sequence.
Archived legacy users/usage files are migration source material, never runtime state.

Start the dedicated authority, register agent velovest with its private credential
and exact public origin, then dry-run scripts/migration/enroll-shared-accounts.mjs
--mapping MAP with both private environment files. Review all identities and usage
before --apply. Enable UTARUS_ACCOUNTS_MODE=shared with explicit endpoint, authority
ID, agent ID and credential. Both HTTP processes configure shared accounts.

Deploy the exact clean committed source through agent-ops fast-deploy.sh
victorconsultant --rsync-code --force-utarus --local-root=/home/zqiu/projects/invage.
The server is a source mirror without Git: verify its tracked file checksums against
the reviewed commit before replacing it. No server-only code may be discarded.

Verify both services, authority health, database readiness, UUID storage dry runs,
existing username and email login, wrong-password rejection, previous chats/files,
dashboard and broker history, and cross-user denial. Check centralized opening usage
and a reserve/settle/release transaction. Preserve matching backups for rollback;
a package downgrade alone cannot reverse UUID or shared-ledger migration.

Use INVAGE_DISABLE_SCHEDULERS=true in isolated rehearsals and omit external channel credentials. The secondary Drive framework never starts a task scheduler.
