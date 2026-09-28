# Broker connections: Settings as the single setup surface

| Field | Value |
| --- | --- |
| Date | 2026-09-27 |
| Status | Implemented in the current workspace; verification notes below |
| Scope | Invage broker setup, account identity, sync isolation, and retirement of the menu bar Brokers page |

## Decision

**Settings → Brokers (`/settings/brokers`) is the only user-facing place to add, configure, inspect, pause, and sync broker connections.** Remove Brokers from the product menu bar. A broker *type* (IBKR, Tiger, MooMoo, Webull) remains a catalog entry; a user may create zero or more *connections* of that type. One connection represents one selected brokerage account and owns one immutable portfolio channel.

This replaces the present one-connection-per-broker-type assumption. It does not assume one, two, or any fixed number of IBKR accounts. Existing holdings and cash remain on their channels during migration.

## Evidence from the current code

| Area | Current behavior and implication |
| --- | --- |
| Two setup surfaces | `src/webapp/invage-webui.ts` registers both nav `/brokers` and `settingsSections` Brokers. `webui/brokers/app.js` and `webui/settings/brokers/app.js` separately implement editing and sync. Settings links its guide out to `/brokers/guide`, leaving Settings. |
| Identity | `src/brokers/connections.ts` stores `broker_connections.<catalog-id>` and `src/brokers/catalog.ts` sets `channel === id`. A second account of the same broker has no distinct storage key or channel. |
| Apply | `src/brokers/apply-statement.ts` replaces every lot and cash sleeve on the catalog channel. This is safe for one account per channel only. It also writes metrics by connector id. |
| IBKR | `src/ibkr/flex-parse.ts` rejects multiple `<FlexStatement>` elements. One Activity query ID and token live together in the current credentials. `src/ibkr/flex-executions.ts` stamps every execution with channel `ibkr`. The historical Trades import accepts one Flex statement and has no connection selector. |
| Tiger | `src/tiger/tiger-client.ts` needs an explicit `account` and `license`; `accounts` is fetched during sync for account-kind classification, with a fallback based on account ID. TBHK additionally requires a token. The selected account controls live versus paper gateway and the assets request. |
| MooMoo | `src/moomoo/moomoo-client.ts` can list authorized trading accounts from an AppKey, returns safe display metadata, and requires an explicit `acc_id` when several exist. `webui/settings/brokers/app.js` already has an account picker. |
| Webull | `src/webull/webull-client.ts` lists accounts and selects one when unambiguous, or requires `account_id`. Its token creation/check flow is separate from account discovery. Current Settings has token buttons but no account picker. |
| Other consumers | `src/recon/source-connector.ts` and `src/recon/sleeves.ts` infer a connection from catalog channel. `src/webapp/dashboard-data.ts` maps metrics through catalog channel. `src/raw-data/store.ts`, `src/brokers/triage.ts`, and `src/brokers/parser-store.ts` classify or store files by broker type. Chat tools take catalog `connector_id`. All require connection-aware resolution. |

The existing unstaged edits in broker UI, MooMoo, and Webull files are unrelated work in progress. Implementation must merge with those edits; this proposal changes no such file.

## User experience in Settings

The `/settings/brokers` pane has a list of **existing account connections** and an **Add broker account** action. Each row shows user label, broker, masked account identifier where useful, enabled state, last successful sync date, current error, and actions: Manage, Sync now, Pause. Catalog types without connections appear only in the Add flow. There is no default pair of IBKR slots.

The Add flow has four stages within Settings:

1. **Choose broker.** Show what the connector imports and its timing: IBKR prior-day Flex; the other three live snapshot as implemented. State that trading is unavailable.
2. **Configure access.** Show only that broker's fields and inline, broker-specific setup steps. Save secrets through session-authenticated APIs; GET returns configured/last-four metadata, never values. Keep an optional static egress IP note where relevant.
3. **Choose account.** Discover where supported. Show account IDs or masked card metadata returned by the broker and require a choice when ambiguous. Save the selected account as the connection binding before its first sync. Once the connection has applied a snapshot, an account switch creates a new connection rather than silently retagging existing holdings.
4. **Validate and preview.** Fetch and parse without applying. Show the returned account, as-of date, lot count, cash currencies, skipped rows, and whether a prior channel snapshot would be replaced. Only an explicit first **Sync now** applies. A failed validation never changes portfolio, cash, metrics, or execution history.

Each connection's Manage view contains its broker instructions and actions. Move the useful content from `/brokers/guide` into this pane, with expandable steps near the relevant inputs. Keep Refresh, latest raw download, and sync diagnostics in Settings. Preserve the existing behavior that a dirty form must be saved before sync and that a timed-out client request may still be running on the server; Refresh checks its outcome rather than retrying automatically. Status labels distinguish **Access incomplete**, **Ready to validate**, **Verified**, **Paused**, and **Sync error**. Merely saving credentials must not produce a “Connected” success claim.

### Broker-specific flow

| Broker | Access fields | Account selection and checks | Special Settings action |
| --- | --- | --- | --- |
| IBKR | Flex token at the access source; Activity query ID and optional Trade Confirmation query ID per connection. | Probe the Activity XML. It must have Open Positions and Cash Report with importable cash, and identify one or more Flex statement account IDs. Select one account for each connection; match that ID on every sync. A query can be scoped to one account or include several. Do not infer available accounts from the token alone. | Show Flex Web Service, XML query, required sections/Trades level, token rotation, and IP guidance inline. Trade Confirmation remains stored but unused by snapshot sync. |
| Tiger | Tiger ID, RSA private key, license, optional institutional secret and TBHK token in an access source; explicit account ID per connection. | Validate the requested account through its account-scoped assets/positions requests. The current `accounts` request is best effort and its failure is swallowed, so it cannot be the sole membership proof. Preserve Global/Prime/paper handling and gateway selection. Never auto-select or silently change a paper account. TBHK cannot validate without its token. | Show license and token requirements before validation. No account picker is promised until a trustworthy discovery endpoint exists. |
| MooMoo | AppKey, private key, signature algorithm in an access source. | Use authorized trading accounts endpoint; display security firm/card suffix and bind `acc_id`. If one account is returned, preselect it for review. If several are returned, require explicit selection. Check authorization again on sync. | Refresh authorized accounts after saving/rotating the key. Preserve Cloud Open API flow; `jude_futu` remains a separate manual channel. |
| Webull | App Key, App Secret, region, optional access token in an access source. | List accounts for that region, exclude non-trading classes for default suggestion, present available trading accounts, and bind `account_id`. Verify membership again on sync. Do not guess among multiple accounts. | Keep Create token and Check token status under the access source, since approval is tied to API access and may be required before account discovery. Show the five-minute app approval instruction. |

Broker-specific fields should be declared with roles (`source`, `connection`, or `sync query`) in the catalog or an adjacent typed schema. A generic form can render fields, but validation and discovery remain broker-specific server operations. Do not turn broker selection into a keyword router.

## Persistence model

Use stable opaque IDs for access sources and connections. Source credentials may be reused across account connections when the broker grants that access scope, so rotating one token/key updates those connections without copying secrets. Account-specific query IDs remain on the connection. A single source may be used for multiple accounts; users may also create multiple sources for the same broker. Do not assume a Webull approval token or any vendor credential covers a second account without validating that account through the broker API; create a separate source if its access scope differs.

```yaml
broker_sources:
  src_01:
    broker_id: ibkr
    credentials:
      token: "<secret>"

broker_connections:
  conn_01:
    broker_id: ibkr
    source_id: src_01
    label: "Personal IBKR"
    account_id: "U1234567"
    channel: ibkr                 # preserved for a migrated connection
    enabled: true
    config:
      activity_query_id: "111222"
      tradeconf_query_id: "333444"
    last_sync: { at: "2026-09-27T00:00:00Z", ok: true, as_of: "2026-09-26" }

  conn_02:
    broker_id: ibkr
    source_id: src_01
    label: "Family IBKR"
    account_id: "U7654321"
    channel: ibkr-c02             # generated once; never derived from label/account ID
    enabled: true
    config:
      activity_query_id: "111222" # same multi-account query is allowed
```

Invariants:

- `broker_id` is a catalog type; `connection_id` is a user-scoped immutable identity; `channel` is a user-scoped immutable custody identity. No two connections may share a channel.
- Reject duplicate active ownership of a broker account in the same broker namespace. The namespace includes broker-specific environment/region or license as needed, so live and paper are never conflated. Compare normalized vendor account IDs, not labels.
- `account_id` may be pending during access setup, but a connection cannot sync until account binding is explicit or a unique broker result is reviewed and accepted. Save the binding before apply; once that connection has applied holdings/cash, forbid account rebinding.
- Renaming, pausing, credential rotation, and query rotation do not change channel or move holdings. Removing a connection is a separate destructive workflow, outside this design; a pause keeps data visible.
- Preserve public holdings, cash, deposits, journal, and dashboard totals. Do not add account IDs to holding keys. Existing `TICKER@channel` and `(channel,currency)` cash identity remain sufficient once channel is unique per connection.
- A saved source may not be deleted while connections refer to it. Secrets remain write-only and are redacted from responses, error text, and logs.

## Sync and parsing contract

`syncBrokerConnection(snapshot, connectionId)` resolves `connection → source → catalog adapter`. The adapter receives a broker-specific, server-assembled credential/config object; callers never pick a catalog channel. Parse produces a canonical `BrokerStatement`, then validation checks `statement.account_id === connection.account_id` before any archive success marker, execution merge, ledger post, or channel replacement. Apply takes the **connection channel**, not `catalog.channel`. Lock by user and connection, plus source/query where an external fetch or token operation could race. Revision-checked persistence remains mandatory.

For IBKR, replace the single-statement parser entry point with a parser that separates the XML into individual `FlexStatement` documents, then validates each document's own positions, cash, and optional Trades. Do not parse rows across sibling statements. Select the statement matching the bound account and fail if absent or duplicated. Parse and validate the entire response before applying the selected account. One account's sync never clears another account's channel. A shared multi-account query may be fetched for each requested connection initially; fetch reuse is an optimization, not a reason to couple their writes. Retain the current missing-section and empty-cash safeguards.

Option executions are currently stamped `ibkr` by `src/ibkr/flex-executions.ts`. The new parser must stamp the selected connection channel and retain `(channel, account_id, execution_id)` identity. Historical Trades XML import from the Trades page must either resolve exactly one matching IBKR connection by account ID or request an explicit connection choice; ambiguous or unmatched imports fail without writing. Manual `apply_broker_statement` must likewise resolve and verify a connection before writing.

Raw success archives, triage cases, and IBKR parser specs must carry connection identity in new paths/metadata, while old broker-type paths remain readable for migrated history. `latest_raw_data` must filter by connection, not merely broker type. Reconciliation must map channels to actual connection records and fetch the selected account without applying books. Dashboard `connectionMetrics` stays keyed by channel, sourced from each connection record. Disabled connections retain their existing recon channel if they still have holdings or cash; they are simply unavailable for connector fetch.

## Session API contract

Keep these routes under `/api/domain/invage` with `auth: 'user'` and `loadSessionState(req)`. Never accept a user slug from the client or register secret-bearing GET routes as agent tools.

| Route | Purpose |
| --- | --- |
| `GET /broker-catalog` | Broker types, capabilities, field roles, and inline guide content. No user secrets. |
| `GET /broker-access` and `GET /broker-accounts` | Public source/connection views, configured-secret indicators, selected account, validation/sync status, and latest connection-scoped raw file. |
| `POST /broker-access`, `PATCH /broker-access/:sourceId` | Save/rotate access fields. Omitted secret means keep; empty secret is invalid; explicit clear requires a separate deliberate operation. |
| `POST /broker-access/:sourceId/discover` | Broker-specific discovery/validation. IBKR requires a query ID in the body. Returns safe account choices and preview summaries, not raw credentials or full statement data. No portfolio apply. |
| `POST /broker-accounts`, `PATCH /broker-accounts/:connectionId` | Create a selected account connection; rename, pause, or update its account-specific configuration. An account change after first sync is rejected. |
| `POST /broker-accounts/:connectionId/preview` | Fetch and validate current connection data without applying; return account/date/count/currency/skips and replacement counts. |
| `POST /broker-accounts/:connectionId/sync` | Fetch, verify account, and apply only that channel. Return a connection view and apply summary. |
| Connection-scoped raw download and Webull source-scoped token create/check | Preserve current capabilities with explicit IDs and session authorization. |

Use distinct `unknown_broker_type`, `unknown_source`, `unknown_connection`, `account_mismatch`, `account_ambiguous`, `duplicate_account`, `needs_credentials`, `sync_in_progress`, and parse errors. Validation or preview must not log success or change books. Mutating endpoints use optimistic revision checks; no fallback that retries a failed save with stale state.

## Deprecating the menu bar Brokers page

1. Remove only the `brokers` item from `createInvageWebUi().nav`; leave Dashboard, Positions, Trades, and Insights in place.
2. Keep `/brokers` and `/brokers/guide` temporarily as lightweight compatibility routes that point users to `/settings/brokers`. They must contain no form or sync controls. Since the installed Utarus framework supports `/settings/:section` as a real Settings page, normal links can target `/settings/brokers` directly.
3. Replace Settings links that currently use `target="_parent"` to `/brokers/guide` with inline guide expansion or `/settings/brokers` links. Update product help, Bookkeeper copy, and tests that assert menu navigation. Once old bookmarks have aged out, remove the compatibility routes and `webui/brokers/` assets.

This is a deprecation of the **menu/page**, not the broker APIs, account data, or read-only sync capability. Settings is the product entry point; chat tools remain an automation path and must require `connection_id` whenever a broker type is ambiguous. Existing catalog-ID tool calls may resolve only when exactly one matching connection exists. Legacy `configure_ibkr_flex` and `sync_ibkr_flex` must never pick an arbitrary IBKR account.

## Migration and rollout

1. Add a strict reader for the new shape and a one-time conversion of each old `broker_connections.<catalog-id>` entry into one source and one connection. Preserve its current channel (`ibkr`, `tiger`, `moomoo`, or `webull`), `enabled`, `last_sync`, and metrics. Move account-specific fields (`activity_query_id`, `tradeconf_query_id`, Tiger `account`, MooMoo `acc_id`, Webull `account_id`) to connection config/binding; source holds remaining access fields. Continue to accept legacy `ibkr_flex` through the existing legacy reader before conversion. Never create two records for the same old entry.
2. If an old connection has no reliable stored account ID, leave binding pending. Show its last-sync account ID as a suggestion only; validate against a new read-only broker response before the next apply. Do not delete or retag existing holdings while binding is pending.
3. Convert in memory on read and persist on the next successful write using the existing investor revision mechanism. A malformed or conflicting old/new state fails explicitly. Keep a rollback copy of the original user YAML before bulk migration; do not rewrite every user eagerly.
4. Ship the connection-aware backend and compatibility readers before switching Settings UI. Then move guide/content and remove the nav item. Finally update chat tools, recon, raw-data indexing, historical import, and docs before allowing a second connection to sync. The feature gate for Add another account remains closed until all of these consumers are connection-aware.

## Verification gates

- Migration fixture for each broker type: exact credentials/config split, channel and metrics preserved, holdings/cash unchanged, legacy IBKR read path, malformed state rejected.
- Two IBKR accounts holding the same ticker and currency: sync either account in either order; only its own `@channel` lot, cash, margin metrics, and last-sync record change. Repeat with a multi-statement Flex XML; reject missing/duplicate account, missing sections, and account mismatch before apply.
- Tiger: Global, Prime, TBHK token requirement, paper gateway, wrong account response, and duplicate-account prevention.
- MooMoo: zero/one/multiple authorized accounts, key rotation, stale `acc_id`, and preservation of `jude_futu` holdings.
- Webull: zero/one/multiple tradable accounts, region separation, token approval/check, stale account selection, and no raw secret in GET or errors.
- Recon, dashboard metrics, raw archive/download, parser spec, Trades import, and chat tools select the correct connection or fail on ambiguity.
- Browser smoke on desktop and mobile: `/settings/brokers` supports full setup, guide, save, discovery, preview, sync, pause, refresh, token flow, and raw download; no Brokers menu item appears; old `/brokers` links lead to Settings. Check dirty-form and aborted-sync behavior.

## Explicit boundaries

This design does not add trading, automatic scheduling, automatic account switching, or deletion of broker-sourced holdings. It does not move manual `jude_futu` holdings into MooMoo. It keeps Yahoo dashboard marks and the existing canonical `BrokerStatement` shape. Existing broker documentation should be updated when implementation lands; this document records the implementation contract first.

## Implementation verification

The Settings pane, account model, connection-scoped sync, migration reader, broker discovery, historical execution import, recon, raw storage, chat tools, and compatibility redirect are implemented. The TypeScript build and focused broker suites pass. The database-backed dashboard and recon suites require `UTARUS_TEST_DATABASE_URL` and were not run in this workspace. Live broker credentials were unavailable, so the external discovery and sync flows remain unverified against vendor services.
