# Organization-owned financial data model review

## Production status — 2026-09-27

The `qiu` family reporting organization now owns the migrated finance records in
`walletstreet_v4_prod.finance`. The cutover imported three members, 14 brokerage
and manual accounts, 49 assets (including 42 positions), 12 cash balances, six
deposits, one property and payment, one liability, and five cash flows. The
former separate books database was imported as 491 immutable organization-scoped
records, including 74 balanced journal entries and 148 lines. The old books URL
was removed from the live application configuration. Both importers returned
`already-applied` on replay.

User finance writes now update the Utarus user aggregate, organization finance
projection, source checkpoint, and a credential-redacted change event in one
PostgreSQL transaction. Current cash commands write through that path; the
history tool shows the imported double-entry entries alongside later finance
changes. **Later changes are audit snapshots, not double-entry journal entries.**
The old books database and its final encrypted dump are retained for recovery.
Broker statement application refuses a second native account on the same
connector until the personal state model can represent both independently.
Schema version 2 archives broker source bytes encrypted in
`finance.source_files`, scoped to `qiu` and linked to the matching account.
The three existing IBKR files (5,079 bytes) were imported and checksum-verified;
new source files are archived in the same transaction as a user finance save.
The organization API lists source metadata and serves authorized downloads.

The production cutover used stopped writers and paired encrypted SQL/file
backups in `backups/walletstreet-org-finance-20260927/`. Both SQL dumps restored
to isolated databases. After deployment, framework database check succeeded,
both services and the page were healthy, `qiu` members received 200 with 14
accounts and 49 assets, and the one outsider received 404. The legacy books
database had zero live application connections.

## Verdict

The current financial model is user-owned. Utarus organization membership and shared chat
do not make portfolios, broker accounts, property, cash, deposits, liabilities, or books
organization-owned. Do not pool the existing members' assets by `org_id` or turn on
shared financial access by treating organization membership as sufficient authorization.

The following review records the pre-migration findings and the intended
long-term accounting model. The production status above describes what was
actually delivered.

## What exists today

| Area | Current key / write path | Consequence |
| --- | --- | --- |
| Portfolio, cash, deposits, broker connections, option executions | `InvestorState` in the revisioned Utarus **user** aggregate; `loadInvestor` / `saveInvestor` | One user owns the snapshot and credentials. Membership is not the financial owner. |
| Property, liability, income/expense, treasury settings | `HouseholdInvestorState` extensions of the same user aggregate | “Household” is a label for a user's planning data, not a shared organization. |
| Optional books journal | `households.id = state.user.id`; every journal/account row uses `household_id` | Tenant isolation is per user, despite the household name. |
| Broker snapshot | `account_id` is parsed, but position and cash identities use `ticker@channel` and `channel+currency` | A connector's second brokerage account would collide with or replace the first account's holdings and cash. |
| Utarus organization | `orgs` and `org_memberships`; user record gets `org_id` | It enables membership and org chat, not an org financial aggregate. |
| Source files | `drive/<user-slug>/...` | Raw broker evidence remains personal even if records are later pooled. |

Evidence: `src/state/investor-store.ts`, `src/state/portfolio-state.ts`,
`src/state/household-state.ts`, `src/books/service.ts:50-59`,
`src/books/import-yaml.ts:47-56`, `src/brokers/apply-statement.ts:70-101`,
`src/brokers/statement.ts`, `src/brokers/connections.ts:486-538`, and
`node_modules/utarus/dist/database/schema.js` (`orgs`, `org_memberships`,
`user_extension_state`). The production organization cutover plan explicitly
keeps personal portfolios and books personal.

## Required invariants

1. Every financial asset, liability, brokerage account, cash sleeve, position,
   transaction, valuation, and source import has exactly one immutable `org_id`
   referencing `utarus.orgs(id)`. The organization is the financial tenant and
   reporting container. Its kind (family, company, trust, etc.) is metadata;
   a family container must not be presented as the legal title holder by default.
2. A user may access an organization's finances only through an explicit finance
   grant checked on every read and write. Org chat membership alone gives no
   financial permission. Record actor user ID and role on writes. Revocation must
   take effect on the next request, including queued sync jobs. A finance grant
   must require an active `(org_id, user_id)` organization membership.
3. A brokerage account has a stable internal `account_id`, `org_id`, connector ID,
   broker-native account ID, and custody label. Uniqueness is at least
   `(org_id, connector_id, broker_native_account_id)`. Credentials and sync state
   are attached to this account, with secrets encrypted and never returned.
4. Position identity includes `org_id` and internal account ID as well as the
   instrument or broker lot key. Cash identity includes `org_id`, account ID,
   and currency. Two accounts at the same broker can hold the same ticker and
   currency without collision. A sync replaces only its own account's snapshot.
5. Every child relationship is enforced with tenant-matching composite foreign
   keys, such as `(account_id, org_id)` to `(id, org_id)`, not merely independent
   `org_id` and `account_id` references. RLS and application authorization both
   use the authenticated actor's verified organization access.
6. Monetary amounts and quantities use exact SQL `numeric` or scaled integers;
   currency, observation time, source, and original broker identifiers are
   explicit. Missing cost, price, or ownership evidence remains unknown rather
   than zero or inferred. Valuations are observations, not ownership records.
7. A source import has stable identity and version/hash. Replaying the same
   broker snapshot must be idempotent; an older snapshot cannot silently replace
   a newer one. Keep raw evidence linked to the organization and account with
   controlled access and retention.
8. Journal entries, balances/projections, and broker apply status commit in one
   database transaction. The ledger is the source of truth for movements; a
   current snapshot is a projection. One failure cannot leave a committed journal
   with an uncommitted portfolio snapshot.

## Recommended relational shape

Use a `finance` schema in the same PostgreSQL database as Utarus so `org_id`
can reference `utarus.orgs(id)` and one transaction can commit the financial
change. Keep personal profile, chat, and personal playbook state in Utarus user
records. Do not reuse `households.id = user.id` for organization-owned books.

```text
finance.organizations(org_id PK/FK, kind, reporting_currency, created_at)
finance.access_grants(org_id, user_id, role, granted_by, revoked_at,
                      FK(org_id, user_id) -> utarus.org_memberships)
finance.accounts(id PK, org_id FK, connector_id, broker_native_account_id,
                 custody_label, status, UNIQUE(org_id, connector_id, broker_native_account_id),
                 UNIQUE(id, org_id))
finance.assets(id PK, org_id FK, kind, label, status, acquired_at,
               UNIQUE(id, org_id))
finance.positions(id PK, org_id, account_id, asset_id, instrument_id,
                  quantity NUMERIC, cost_basis NUMERIC, currency, as_of,
                  FK(account_id, org_id), FK(asset_id, org_id))
finance.cash_balances(org_id, account_id, currency, amount NUMERIC, as_of,
                      PRIMARY KEY(org_id, account_id, currency), FK(account_id, org_id))
finance.imports(id PK, org_id, account_id, connector_id, source_ref,
                source_hash, observed_at, applied_at, status,
                UNIQUE(org_id, account_id, source_hash))
finance.journal_entries(id PK, org_id, value_date, source_import_id, actor_user_id, ...)
finance.journal_lines(id PK, org_id, entry_id, account_id, currency,
                      amount_minor BIGINT, quantity NUMERIC, ...)
```

Property, deposit, and liability details can live in typed subtype tables keyed
by `(asset_id, org_id)` or separate typed records with the same ownership
contract. A liability is not an asset economically, even though both belong to
the same tenant. Keep property purchase payments and mortgage links explicit;
do not infer them from a property value. Introduce a separate `parties` and
`asset_interests` model, both scoped to the same `org_id`, when legal title or
split beneficial interests are needed. Do not substitute a free-text owner
label for that relationship. The tenant `org_id` stays singular in either case.

## Pre-migration gaps found in the review

1. **Ownership and access:** `InvestorState` and treasury writes use a user's
   state; dashboard and broker APIs use the session's user slug. There is no
   organization financial repository or finance permission check. Moving the
   data to a shared org room would not change this.
2. **Books identity:** `householdContextFromState` and the import derive the
   ledger tenant from `state.user.id`. The books schema has no FK to Utarus orgs.
   Its RLS therefore isolates users, not organizations.
3. **Broker account collisions:** the statement's `account_id` appears in logs
   and execution history, but holdings and cash are keyed by connector channel.
   Applying another account on the same connector removes the first account's
   current snapshot.
4. **Atomicity:** when optional books are enabled, broker apply posts several
   separate books transactions, then saves the user aggregate. These operations
   cannot roll back as a unit. The current v4 migration deliberately leaves
   `INVAGE_BOOKS_DATABASE_URL` unset for this reason.
5. **Database integrity:** books child tables independently reference a
   `household_id` and a parent row ID. The application checks a journal line's
   account household, but the database does not enforce matching tenant IDs
   with composite FKs for every relationship. A future org ledger must enforce
   that invariant in SQL as well as code.
6. **Documentation:** `docs/data-model.md` still describes writable YAML as the
   source of truth, while `README.md` describes the v4 SQL user aggregate. This
   should be reconciled during migration so implementers do not follow stale
   storage guidance.

## Safe migration sequence

1. Inventory every existing user aggregate and books household, all broker
   accounts and raw-source files. Record source user, current account identity,
   currency, asset class, and any unknown or duplicate ownership. No automatic
   union of members' portfolios, even when all users belong to one org.
2. Create the org finance schema, tenant-matching FKs, RLS, trusted access API,
   and read-only reconciliation views. Backfill into a staging schema using
   explicit user-to-org and account mappings. Maintain old personal records.
3. Compare per-owner counts, quantities, cash by currency/account, deposits,
   properties, liabilities, journals, and execution history. Require review of
   ambiguous account IDs or asset ownership before activation.
4. Switch one organization at a time to org-scoped reads and writes. Make broker
   sync account-scoped and transactional before allowing members to share it.
   Keep an exportable rollback snapshot and a reversible feature flag until
   reconciliation passes after cutover.
5. Test isolation between two organizations, member revocation, same ticker in
   two accounts at one broker, duplicate/reordered broker imports, rollback on
   failed apply, and exact-value reconciliation. Verify the UI and agent tools
   resolve the same authorized organization rather than a caller-supplied slug.

## Ownership decision used for implementation

Define whether the organization itself is the reporting owner of every asset,
or whether an organization is a family reporting container whose assets may be
legally titled to members or entities inside it. The recommended schema supports
the latter by keeping `org_id` as tenant and adding legal title as separate
metadata, without allowing an asset to span multiple organizations.

## Implementation started after review

The user chose to move all current financial records into `qiu` as a
family reporting container. `src/finance/schema.sql` now defines organization-
scoped finance records, account-level broker identities, explicit finance grants,
tenant-matching foreign keys, exact SQL money/quantity columns, and RLS. The
new migration command is `node --import tsx src/finance/migrate.ts`; it runs
only against an existing Utarus organization-mode database. The dry-run importer
is `node --import tsx src/finance/import-personal.ts qiu`; add `--apply` only
after backup and isolated restore/rehearsal. It refuses duplicate native broker
account IDs across members and changed source revisions. It retains source user
records for reconciliation, encrypts copied broker credentials, and stages all
financial rows in one transaction. It also refuses to proceed if an active user
outside `qiu` has financial data; this prevents a silent partial import.

On 2026-09-27, a production SQL snapshot was restored to the separate
`walletstreet_finance_rehearsal_20260927` database. The new schema applied
under the application role. The `qiu` dry run and rehearsal import reconciled
three members, 14 accounts, 42 holdings, 12 cash balances, six deposits, one
property and payment, one liability, and five cash flows. The replay returned
`already-applied`; RLS returned zero unscoped assets and 49 scoped assets.
The member viewer could read 49 assets and was denied finance writes. The
schema migration command also applied and replayed successfully on a second
fresh restore.
The one active user outside `qiu` had no finance data in the rehearsal snapshot.
This was the isolated rehearsal before the production cutover recorded above.

`GET /api/domain/invage/org-finance` requires both organization membership and
an explicit finance grant. The Organization assets tab is enabled with
`WALLETSTREET_ORG_FINANCE_ENABLED=true`. The existing personal dashboard and
agent tools still read the per-user view, which is kept in sync transactionally
with the organization finance projection. The imported historical books entries
remain immutable; new activity uses organization finance change events.
