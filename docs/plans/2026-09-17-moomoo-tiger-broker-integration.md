# MooMoo / Tiger Brokers catalog ingest (read-only, IBKR Flex pattern)

| Field | Value |
|-------|--------|
| **Author** | Invage / TBD |
| **Date** | 2026-09-17 |
| **Status** | Locked (user confirmed recommendations 2026-09-17) |
| **Branch** | `feat/victor-consultant` |
| **Product** | Invage (Wallet Street) — read-only broker ingest |
| **Locked companions** | [Broker channel settings](./2026-08-22-broker-channel-settings-design.md) (KD-3/KD-4/KD-5/KD-7), [Channel recon flow](./2026-08-28-channel-recon-flow-design.md), skills `src/skills/knowledge/broker-integration.md`, `src/skills/knowledge/ibkr-flex.md` |

---

## Overview

Invage already ingests Interactive Brokers through Flex Web Service onto channel `ibkr`: Settings catalog card, Brokers nav page, `broker_connections.ibkr` YAML, `syncBrokerConnection` → parse → `applyBrokerStatement`, recon fetch without apply. MooMoo (Futu Holdings) and Tiger Brokers (UP Fintech) are **two different brokers with two different cloud APIs**. This design adds catalog connectors `moomoo` and `tiger` in the same **read-only snapshot** product shape: pull positions + per-ISO cash onto the connector channel, never place orders, never replace Yahoo marks.

The current sync and recon paths are **Flex-hardcoded** (`syncQueryFieldId` + `credentials.token` + `fetchFlexStatement`). A second vendor cannot ship until fetch/parse is behind a per-connector adapter. IBKR Flex remains one implementation. Apply, books, session APIs, and the catalog loop stay shared.

**v1 user-visible ingest is Tiger first.** MooMoo follows once REST JSON fixtures exist and Method 2 AppKey auth is proven against a live `trade:read` account. OpenD / TWS-style local gateways are rejected. Official trade SDKs are rejected.

---

## Background & Motivation

### Current IBKR pipeline (verified in tree)

| Piece | Path | Role |
|---|---|---|
| Catalog (IBKR only) | `src/brokers/catalog.ts` | `BROKER_CATALOG`, credential fields, `help_steps`, `syncQueryFieldId` |
| Connections + sync | `src/brokers/connections.ts` | `syncBrokerConnection` **requires** `def.syncQueryFieldId` and `credentials.token`, then `fetchFlexStatement` |
| Statement / apply | `src/brokers/statement.ts`, `src/brokers/apply-statement.ts` | Vendor-agnostic `BrokerStatement` → replace-channel-only |
| Flex client/parse/map | `src/ibkr/flex-*.ts` | XML → lots + cash; `yahooSymbolFromFlex`; `archiveXml` under `drive/<slug>/ibkr-flex/` |
| Recon fetch | `src/recon/source-connector.ts` | Same Flex token + query id; **does not** `applyBrokerStatement`; **does not** load `csv_tables` specs |
| Settings UI | `webui/settings/brokers/` | Loops `payload.connectors`; IP help and docs link text are IBKR-hardcoded |
| Brokers **nav** page | `webui/brokers/app.js` + `index.html` | Same GET; same Flex IP/docs copy; `UPCOMING = [{ name: 'Webull' }, { name: 'MooMoo' }, { name: 'Tiger Brokers' }]` stubs unless `display_name` **exactly** matches |
| HTTP | `src/webapp/broker-api.ts` | GET/PATCH/sync; `mapSyncError` is Flex-worded (`flex_http` / `flex_parse` / `flex_apply`) |
| Raw provenance | `src/raw-data/store.ts` `describe()` | Only `ibkr-flex` → `broker-sync`; `broker-raw/<connector>/` → `broker-triage`; anything else is `drive-file` with `channel: null` |
| Tools | `src/tools/ibkr_flex.ts`, `src/tools/broker_ingest.ts` | `configure_ibkr_flex` / `sync_ibkr_flex`; triage/parse/apply already take `connector_id` |
| Chat empty-state | `src/webapp/invage-webui.ts` | “Brokers to connect Interactive Brokers Flex” |
| Tests | `tests/broker-connections.test.ts` | Rejects YAML key `"tiger"`; `publicCatalog` `toHaveLength(1)` and `[0]` is IBKR |

`applyBrokerStatement` is already connector-id keyed: it stamps `holding.channel` from `getBrokerConnector(id).channel` and replaces **only** that channel. No vendor schema is stored (`rejectVendorShape` in `assertBrokerStatement`).

### Pain

1. `syncBrokerConnection` and `sourceReconConnector` cannot fetch a non-Flex vendor: missing `syncQueryFieldId` throws `"Broker connector \"…\" has no sync query field."`
2. Settings **and** Brokers nav hardcode Flex IP help, “Flex Web Service docs”, “Stops Flex pulls”, and IBKR-only IMPORTS copy. Nav still ships “Coming soon” stubs for MooMoo / Tiger Brokers.
3. `BrokerNotConfiguredError` / `SyncInProgressError` name Flex. A generic Tiger `Error('HTTP 401')` would map to **500 `flex_apply`**.
4. Holdings tests already use **manual** channel tags `moomoo`, `tiger`, and `jude_futu`. Catalog ids match KD-4 but **must not** auto-migrate `jude_futu`.
5. Locked 2026-08-22 forbids stub catalog rows. The Brokers nav still renders display-only stubs. Adding a live card with the wrong `displayName` would show **both** a live card and a stub.
6. Password `<input>` cannot hold multi-line PEM.

---

## Goals & Non-Goals

### Goals

1. Two catalog connectors: `id`/`channel` `tiger` and `moomoo`. `displayName` **exactly** `Tiger Brokers` and `MooMoo` so Brokers nav `UPCOMING` stubs drop. Not a combined “asia broker”.
2. Read-only **live snapshot** ingest: positions + per-ISO cash via existing `applyBrokerStatement`. Optional `metrics` for buying power / excess — never stored as cash.
3. Extract `BrokerConnectorAdapter` (`fetchRaw` → `parseToStatement` → apply) used by sync and recon. IBKR Flex is adapter `ibkr`.
4. Settings iframe **and** Brokers nav (`/brokers`) are catalog-driven siblings: per-connector IP/help, PEM textarea, disable-hint, no leftover stubs for shipped ids.
5. Chat: `configure_broker` / `sync_broker` (write through `patchBrokerConnection`); keep IBKR tools as aliases.
6. Archive raw JSON with `list_raw_data` provenance (`source_kind: 'broker-sync'`, channel set). JSON triage `looks_like: json` + refuse `csv_tables` on non-IBKR — **gate of the first JSON vendor PR**, not polish.
7. `yahooSymbolFromBroker({ market, symbol })`. Option lots use `buildOptionKey` and a complete `OptionSpec`. Unsupported → `skipped`. Duplicate map keys → skip later lot (Flex already does this).
8. Existing `jude_futu` / manual `moomoo` / `tiger` lots: replace-channel-only. `jude_futu` ≠ `moomoo`. FDs on `jude_futu` stay.

### Non-Goals

- Trading, order routing, `trade:write`, OpenD, TWS/Gateway, WebSocket push.
- Importing `@tigeropenapi/tigeropen` or `moomoo-api` (including “just HttpClient”).
- Replacing Yahoo **equity** marks with broker last prices. Option `holding.option.mark` may be seeded from vendor premium × multiplier (same as Flex `markPrice`).
- Auto-migrating `jude_futu` lots onto `moomoo`.
- Webull; a second Tiger/MooMoo account as a split of the same id.
- Encrypting YAML at rest.
- Paper as the default production path.
- v1 option **execution journal** for Tiger/MooMoo.
- Scheduled sync on enable; Clear/forget-secret; keyword routers.

---

## Key Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| **KD-T1** | Two connectors, `tiger` and `moomoo`. Channel === catalog id (KD-4). `displayName`: `Tiger Brokers` / `MooMoo`. | Distinct APIs. Nav `UPCOMING` matches those strings exactly. |
| **KD-T2** | Read-only live snapshot. No OpenD, no TWS, no order methods in the HTTP allow-list. | Product constraint. Capability: “Cannot trade or submit orders.” Marks stay Yahoo. |
| **KD-T3** | Adapter before second vendor. Registry `Record<string, BrokerConnectorAdapter>`. Catalog id without adapter is a 500 programmer error; unknown catalog id is 404 `UnknownConnectorError`. | Shared lock/apply/recon. |
| **KD-T4** | Ship Tiger catalog row first (first user-visible non-IBKR connector). MooMoo follows in PR 3 after AppKey smoke + REST fixtures. Do **not** wait to ship both together. | User confirmed 2026-09-17. No stub catalog rows (2026-08-22). Nav stubs remain for unshipped names only. |
| **KD-T5** | No `@tigeropenapi/tigeropen` / `moomoo-api`. Thin signed HTTP + Node `crypto`. Domain-garden GET is allow-listed; POST only to allow-listed hosts. | SDK exposes `placeOrder`. Subset HttpClient still pulls trade methods (Alternative F). |
| **KD-T6** | MooMoo v1 = paste Traditional API Key (Method 2). Do **not** register an Invage OAuth app in v1. OAuth 2.1+PKCE is v1.1 **only** if the PR 3 live AppKey checklist shows a permission failure (not bad key/clock). `trade:read` only. | User confirmed 2026-09-17. IBKR-shaped paste UX. Gate: live AppKey checklist before catalog row. |
| **KD-T7** | `as_of` = UTC date of the sync attempt, not Flex `toDate`. | Cloud APIs are snapshots. |
| **KD-T8** | Cash = per-ISO sleeves, `amount ≥ 0`. Buying power is `metrics` only. Negative vendor cash → `skipped`; zero remaining sleeves → **fail**. Prime **Fund (`F`)** cash is skipped (not double-counted with `S`). | Matches `assertBrokerStatement` and `assertBrokerConnectionMetrics`. |
| **KD-T9** | No auto-migration of `jude_futu`. Manual `tiger`/`moomoo` lots are replaced on first matching sync. FDs are never touched by apply. | Channel is identity. |
| **KD-T10** | JSON connectors never run `csv_tables`. Only the IBKR adapter may `loadBrokerParserSpec`. Recon never loads parser specs. Success JSON under `tiger-raw/` / `moomoo-raw/` with `describe()` mapping to `broker-sync`. | `csv_tables` is XML/CSV. Provenance must not look like unverified Drive files. |
| **KD-T11** | Fixture-driven mappers are a merge gate. Tiger wire is **camelCase** HTTP JSON, not SDK snake_case attributes. | `get_positions` default STK; MooMoo REST lacks OpenD option columns. |
| **KD-T12** | Paper is not default. Prefer `managed_accounts[].account_type === 'PAPER'` when that call ran; else 17-digit heuristic. Ingest paper only if that id is what the user stored. | Avoid mixing sim cash into household books. |
| **KD-T13** | Secret PEM fields use `widget: 'textarea'` + PATCH normalize (newlines / `\n` / headerless base64). | Password inputs strip PEM. |
| **KD-T14** | `fetchRaw` for multi-call vendors returns one **versioned bundle** JSON (`TigerRawBundle` / `MooMooRawBundle`), not a single vendor response body. | Archive + parse need all calls together. |
| **KD-T15** | Document all licenses. **Smoke SG first** (TBSG / Moomoo `FUTUSG`). TBHK token is paste-rotate in v1 (no auto-refresh). Ingest Futu HK (`FUTUSECURITIES`) if that `acc_id` is authorized. Do not promise HK options without fixtures. Not “SG-only” (do not refuse TBHK/Futu HK) and not first-class TBHK auto-refresh. | User confirmed 2026-09-17. |
| **KD-T16** | No option **execution journal** in v1 for Tiger/MooMoo. Positions + cash only. Option **lots** still import when `OptionSpec` is complete. IBKR Flex Trades unchanged. Journal is later work, not a v1 PR. | User confirmed 2026-09-17. |

---

## Proposed Design

### Architecture

```mermaid
flowchart TB
  subgraph ui [Catalog-driven UIs]
    Settings["webui/settings/brokers/app.js"]
    Nav["webui/brokers/app.js  /brokers"]
  end

  subgraph http [Session APIs — not agent tools]
    GET["GET /broker-connections"]
    PATCH["PATCH /broker-connections/:id"]
    SYNC["POST /broker-connections/:id/sync"]
  end

  subgraph core [Shared]
    Cat["BROKER_CATALOG"]
    Store["broker_connections YAML"]
    Adapter["adapters: Record id, BrokerConnectorAdapter"]
    Apply["applyBrokerStatement"]
  end

  subgraph adapters [Per-connector fetch+parse]
    Ibkr["src/ibkr/ Flex XML"]
    Tiger["src/tiger/ signed HTTP JSON"]
    Moo["src/moomoo/ AppKey HTTP JSON"]
  end

  Settings --> GET
  Nav --> GET
  Settings --> PATCH
  Nav --> PATCH
  Settings --> SYNC
  Nav --> SYNC
  GET --> Cat
  GET --> Store
  PATCH --> Store
  SYNC --> Adapter
  Adapter --> Ibkr
  Adapter --> Tiger
  Adapter --> Moo
  Ibkr --> Apply
  Tiger --> Apply
  Moo --> Apply
```

Utarus Settings seam does not change. Adding a vendor is adapter + catalog row + fixtures + UI copy that already loops GET.

### Sync / recon sequence

```mermaid
sequenceDiagram
  actor User
  participant UI as Settings, /brokers, or Bookkeeper
  participant Sync as syncBrokerConnection
  participant Ad as BrokerConnectorAdapter
  participant Vendor as Tiger / MooMoo / IBKR
  participant Apply as applyBrokerStatement

  User->>UI: Enable + paste creds + Sync
  UI->>Sync: id = tiger | moomoo | ibkr
  Sync->>Sync: resolveConnectionForSync
  Sync->>Ad: fetchRaw(credentials)
  Ad->>Vendor: allow-listed read-only HTTP
  Vendor-->>Ad: JSON or Flex XML
  Ad->>Ad: parseToStatement(channel)
  alt parse fails
    Sync->>Sync: archive triage raw.json/xml + case.yaml
  else parse ok
    Sync->>Sync: archive success blob (list_raw_data broker-sync)
    Sync->>Apply: replace channel lots + cash only
  end
```

Recon uses the **same** `fetchRaw` + `parseToStatement`, then `sourceReconStatement` — **no** apply, **no** `csv_tables`.

### Connector-fetch adapter (PR 1)

New `src/brokers/adapter.ts`.

```ts
export type BrokerRawKind = 'xml' | 'json' | 'text';

export interface BrokerRawPayload {
  kind: BrokerRawKind;
  body: Buffer; // IBKR: Flex XML. Tiger/MooMoo: versioned *RawBundle JSON
  meta?: Record<string, string>; // method list, gateway host — never secrets
}

export type AdapterTransport =
  | { kind: 'ibkr'; flex: FlexTransport }
  | { kind: 'http'; fetch: typeof fetch };

export interface BrokerConnectorAdapter {
  readonly id: string;
  /** Only IBKR is true. Non-IBKR adapters must not call loadBrokerParserSpec. */
  readonly usesCsvTables: boolean;
  fetchRaw(
    credentials: Record<string, string>,
    opts?: { transport?: AdapterTransport },
  ): Promise<BrokerRawPayload>;
  parseToStatement(raw: BrokerRawPayload, channel: string): BrokerStatement;
}

export const adapters: Record<string, BrokerConnectorAdapter> = {
  ibkr: ibkrFlexAdapter,
  // tiger / moomoo registered in their PRs
};

export function getBrokerAdapter(id: string): BrokerConnectorAdapter {
  getBrokerConnector(id); // UnknownConnectorError (404) if not in catalog
  const ad = adapters[id];
  if (!ad) {
    throw new Error(`Broker connector "${id}" has no fetch adapter.`); // 500 programmer error
  }
  return ad;
}
```

**IBKR adapter**

- `usesCsvTables: true` — **signal only**. `parseToStatement` has no `slug` and **must not** call `loadBrokerParserSpec`.
- `fetchRaw`: today’s `fetchFlexStatement({ token, queryId })` using `syncQueryFieldId`. Transport `kind: 'ibkr'`.
- `parseToStatement`: Flex XML only (`parseFlexQueryXml` → `mapFlexDocToStatement`). Never `runCsvTablesSpec`.
- `syncQueryFieldId` remains **IBKR-only**.

**`syncBrokerConnection`** (the only place csv_tables runs)

1. Inflight lock `${slug}:${id}` (unchanged).
2. `resolveConnectionForSync`.
3. `getBrokerAdapter(id)`.
4. `raw = await adapter.fetchRaw(conn.credentials, opts)`.
5. Parse: **if** `adapter.usesCsvTables` **and** `loadBrokerParserSpec(slug, id)` then `runCsvTablesSpec(raw.body, spec, channel)`; **else** `adapter.parseToStatement(raw, channel)`. On throw → `archiveBrokerTriage` (media-aware filename).
6. `archiveBrokerSuccess(slug, id, raw, statement.as_of)` — IBKR path **unchanged**: `drive/<slug>/ibkr-flex/activity-{asOf}-{stamp}.xml`.
7. `applyBrokerStatement` + `last_sync`.

Drop shared `syncQueryFieldId` / `token` requirements. IBKR adapter enforces those.

PR 1 **keeps** Flex-worded `BrokerNotConfiguredError` / `SyncInProgressError` strings so existing tests/skills that grep “IBKR Flex” / “A Flex sync is already running” stay green. PR 2 generalizes the strings and updates those tests.

**`sourceReconConnector(state, channel, transport?: AdapterTransport)`** — replace `FlexTransport` third arg. IBKR tests pass `{ kind: 'ibkr', flex }`. Recon always calls `adapter.parseToStatement` (Flex XML for IBKR). **Never** `runCsvTablesSpec` / `loadBrokerParserSpec`. PR 1 test: a saved csv_tables spec is ignored on recon.

### Catalog schema extras

```ts
export type CredentialWidget = 'input' | 'textarea';
export type CredentialFormat = 'plain' | 'pem';

export interface CredentialFieldDef {
  id: string;
  label: string;
  type: CredentialFieldType; // 'secret' | 'text'
  required: boolean;
  help?: string;
  widget?: CredentialWidget; // default 'input'
  format?: CredentialFormat; // default 'plain'; 'pem' ⇒ textarea + PATCH normalize
}

export interface BrokerConnectorDef {
  // existing…
  ipWhitelistHelp?: boolean;
  helpHrefLabel?: string;
}
```

`publicConnectorView` emits `ip_whitelist_help`, `help_href_label`, and per-field `widget` / `format`. Tests that assume catalog length 1 must filter `id === 'ibkr'` (or look up by id) in PR 2.

PEM normalize (PATCH + `parseStoredConnection` on write):

1. Trim.
2. If the value contains `\\n` (two-char) and no real newlines, replace `\\n` → `\n`.
3. If it looks like headerless base64 (no `BEGIN`), wrap as `-----BEGIN PRIVATE KEY-----\n` + 64-col wrap + footer **only after** `crypto.createPrivateKey` accepts PKCS#8 or PKCS#1 variants; try PKCS#1 `RSA PRIVATE KEY` if PKCS#8 fails.
4. Reject empty after normalize. Store the PEM with real newlines in YAML (`|` block is fine; YAML folded strings must round-trip — fixture this).
5. `redactSecrets` already redacts secret values in errors; keep that. Never log PEM.

IBKR `token` stays `widget: 'input'`.

### Catalog rows (only when the module exists)

`assertIbkrChannelMatchesCatalog` stays. Add `assertCatalogChannelEqualsId()` for v1.

#### Interactive Brokers (existing, extras only)

- `ipWhitelistHelp: true`
- `helpHrefLabel: 'Flex Web Service docs'`

#### Tiger Brokers — copy-paste catalog (PR 2)

```ts
{
  id: 'tiger',
  displayName: 'Tiger Brokers',
  channel: 'tiger',
  capability:
    'Read-only Tiger Brokers OpenAPI. Pulls a live snapshot of stock, option, and fund positions plus per-currency cash into channel tiger. Cannot trade or submit orders. Snapshot time is the UTC date of Sync (not prior-day Flex). Dashboard marks stay Yahoo. Paper accounts ingest only if you paste a paper account id.',
  credentialFields: [
    { id: 'tiger_id', label: 'Tiger ID', type: 'text', required: true,
      help: 'Developer ID from https://developer.itigerup.com/profile.' },
    { id: 'account', label: 'Account', type: 'text', required: true,
      help: 'Global (U…), Prime (5–10 digits), or paper (17 digits). Paper only if you intend to ingest sim.' },
    { id: 'license', label: 'License', type: 'text', required: true,
      help: 'e.g. TBSG, TBHK, TBNZ. Must match the developer portal license.' },
    { id: 'private_key', label: 'RSA private key', type: 'secret', required: true,
      widget: 'textarea', format: 'pem',
      help: 'Shown once at developer registration. PKCS#1 or PKCS#8 PEM. Never echoed.' },
    { id: 'token', label: 'TBHK token', type: 'secret', required: false,
      help: 'Required for TBHK (~30-day). Paste-rotate when expired. Other licenses omit.' },
    { id: 'secret_key', label: 'Institutional secret key', type: 'secret', required: false,
      help: 'Institutional accounts only. Individuals leave blank.' },
  ],
  helpNotes: [
    'Optional IP whitelist: if Settings shows an egress IPv4, paste it on the developer portal. Rotating egress without a whitelist is fine; a stale whitelist fails like IBKR 1013.',
    'Invage never places or cancels orders. Do not paste a paper account unless you want sim lots on channel tiger.',
  ],
  helpSteps: [
    'Open a funded Tiger account and sign the API agreement at https://developer.itigerup.com/profile.',
    'Generate the RSA key pair on that page. Copy tiger_id and the private key (shown once).',
    'Copy the trading account id and license (TBSG for Singapore live; TBHK needs the extra token file).',
    'TBHK only: generate the token, paste it here, and rotate before it expires (~30 days). Invage does not auto-refresh in v1.',
  ],
  helpHref: 'https://docs-en.itigerup.com/docs/prepare',
  helpHrefLabel: 'Tiger OpenAPI docs',
  ipWhitelistHelp: true,
}
```

IBKR IP help text stays IBKR-specific. Tiger IP help (when `egress_ipv4` set): “Paste this IPv4 into Tiger developer portal IP whitelist: `{ip}`.” When null: “Leave Tiger IP whitelist blank unless ops gave you a static egress IP.”

#### MooMoo — copy-paste catalog (PR 3)

```ts
{
  id: 'moomoo',
  displayName: 'MooMoo',
  channel: 'moomoo',
  capability:
    'Read-only moomoo Cloud Open API (not the local OpenD gateway). Pulls a live snapshot of positions and per-currency cash into channel moomoo. Cannot trade or submit orders. Requests trade:read only. Snapshot time is the UTC date of Sync. Dashboard marks stay Yahoo. Channel moomoo is not jude_futu — existing Futu-tagged lots and FDs stay until you move them.',
  credentialFields: [
    { id: 'app_key', label: 'AppKey ID', type: 'text', required: true,
      help: 'From https://open.moomoo.com/dashboard User Center.' },
    { id: 'private_key', label: 'AppKey private key', type: 'secret', required: true,
      widget: 'textarea', format: 'pem',
      help: 'Local private key matching the public key uploaded for the AppKey. Ed25519 or RSA.' },
    { id: 'acc_id', label: 'Trading account ID', type: 'text', required: false,
      help: 'Optional. Required when more than one authorized trading account exists.' },
    { id: 'sign_alg', label: 'Signature algorithm', type: 'text', required: false,
      help: 'Ed25519 (default) or RSA-SHA256. Must match the AppKey.' },
  ],
  helpNotes: [
    'Do not install OpenD and do not unlock trade. Invage talks only to https://webapi.moomoo.com.',
    'jude_futu is a manual custody tag. Enabling moomoo does not move those lots or FDs.',
  ],
  helpSteps: [
    'Log in at https://open.moomoo.com/dashboard and open User Center.',
    'Create an AppKey, upload the public key, keep the private key local.',
    'Paste AppKey ID and private key here. Do not grant trading on the key if the dashboard offers a split.',
    'If Sync says multiple authorized accounts, paste acc_id from Get Authorized Trading Accounts.',
  ],
  helpHref: 'https://open.moomoo.com/api/overview/getting-started',
  helpHrefLabel: 'moomoo OpenAPI docs',
  ipWhitelistHelp: false,
}
```

---

### Tiger HTTP (PR 2) — implementable surface

Layout: `src/tiger/tiger-client.ts`, `tiger-sign.ts`, `tiger-parse.ts`, `tiger-map.ts`, `tiger-adapter.ts`.

#### Gateways (allow-list)

| Use | URL |
|---|---|
| Domain garden (GET only) | `https://cg.play-analytics.com` (US/TradeUp: `?appName=tradeup` — not v1 unless license is TBUS) |
| Live COMMON fallback | `https://openapi.tigerfintech.com/gateway` |
| Live TBSG/TBNZ/TBHK fallback | `https://openapi.tigerfintech.com/hkg/gateway` |
| Paper COMMON fallback | `https://openapi-sandbox.tigerfintech.com/gateway` |
| Paper HKG fallback | `https://openapi-sandbox.tigerfintech.com/hkg/gateway` |

**Allow-listed hosts:** `cg.play-analytics.com`, `openapi.tigerfintech.com`, `openapi-sandbox.tigerfintech.com`, `openapi.tradeup.com`.

Garden `GET` (1s timeout). Parse `items[].openapi` (live) or `items[].openapi-sandbox` (paper). Keys of interest: `COMMON`, `{LICENSE}`, `{LICENSE}-PAPER` (e.g. `TBSG`, `TBSG-PAPER`). Append `/gateway` if the garden URL has no path. **If garden returns a host not on the allow-list, ignore that URL and use the fallback table.** Never POST off-list.

Paper host: `account_type === 'PAPER'` from managed accounts when present; else 17-digit account id **and** the user stored that id.

#### HTTP `method` strings and version

POST JSON to `{gateway}` with public params. Pin **v1** as:

| Call | `method` | `version` | `biz_content` (JSON object, then stringified) |
|---|---|---|---|
| Managed accounts | `accounts` | `1.0` | `{ "account": "<id>" }` optional |
| Positions | `positions` | `1.0` | `{ "account", "sec_type": "STK"\|"OPT"\|"FUND", "currency": "ALL", "market": "ALL" }` |
| Global assets | `assets` | `1.0` | `{ "account", "segment": true, "market_value": true }` |
| Prime/paper assets | `prime_assets` | `1.0` | `{ "account", "base_currency": "USD", "consolidated": true }` |

These `method` strings match the OpenAPI wire names used by official SDKs (`accounts`, `positions`, `assets`, `prime_assets`) — **not** the Python names `get_*`. The first live TBSG smoke **must** record the request `method` + response `code`/`data` as `tests/fixtures/tiger/*.json`. If the live envelope uses a different `method` string, **the fixture wins**; update the client to the captured string, do not guess a third name.

**Allow-listed methods only.** Client `execute` takes a union of those four strings. Grep gate in tests: `src/tiger/**` must not contain `place_order`, `cancel_order`, `modify_order`, `preview_order`.

#### Signing (golden fixture required in PR 2)

Public params (all strings): `tiger_id`, `method`, `charset=UTF-8`, `sign_type=RSA`, `timestamp`, `version`, `biz_content` (compact JSON string).

**`timestamp` TZ (v1 pin):** `yyyy-MM-dd HH:mm:ss` in **`Asia/Shanghai`**, **no offset suffix**. Official SDKs default `TimeZoneId.Shanghai`; a UTC clock produces signatures the gateway rejects. The golden `sign-string.txt` fixture **must** use that zone. After live smoke, a captured request may override this pin; until then implementers do not choose UTC.

Optional public params when credentials present:

- TBHK `token` → `access_token` (and `account_type` if the captured live request includes it; do not invent `account_type` until a TBHK fixture says so)
- Institutional `secret_key` → `secret_key`

**Sign content:** sort remaining keys (exclude `sign`) lexicographically; join `key=value` with `&`; RSA-SHA1 PKCS1v15 with the user private key; Base64 → `sign`.

Check-in `tests/fixtures/tiger/sign-string.txt` + expected Base64 for a **test-only** key (never a real user key). Format the fixture `timestamp` in Asia/Shanghai.

Response: when the envelope includes `sign`, verify RSA-SHA1 with the **host-selected** Tiger public key (Python SDK constants, checked in as PEM fixtures — not imported from the npm SDK):

| Gateway host | Key |
|---|---|
| `openapi.tigerfintech.com`, `openapi.tradeup.com` | `TIGER_PUBLIC_KEY` |
| `openapi-sandbox.tigerfintech.com` | `SANDBOX_TIGER_PUBLIC_KEY` (≠ prod) |

Paper ingest is allowed if the user stored a paper account id (KD-T12), so sandbox stays on the allow-list and **must** use the sandbox PEM. If `sign` is absent, still require `code === 0` (or `"0"`).

If `license === 'TBHK'` and `token` missing → `BrokerParseError` / user message “TBHK license requires a token. Generate it on the developer portal and paste it (expires ~30 days).” Not `not_configured`.

v1 does **not** auto-refresh TBHK tokens.

#### `TigerRawBundle` (`schema: "invage.tiger.raw.v1"`)

This is `BrokerRawPayload.body` (kind `json`) for archive, triage, and `parseToStatement`.

```ts
export interface TigerGatewayEnvelope {
  code: number | string;
  message?: string;
  data: unknown;
  timestamp?: string | number;
}

export interface TigerRawBundle {
  schema: 'invage.tiger.raw.v1';
  fetched_at: string; // ISO
  gateway: string;    // actual POST origin, allow-listed
  account: string;
  license: string;
  account_kind: 'global' | 'prime' | 'paper';
  managed_accounts: TigerGatewayEnvelope | null;
  assets: { method: 'assets' | 'prime_assets'; envelope: TigerGatewayEnvelope };
  positions: {
    STK: TigerGatewayEnvelope;
    OPT: TigerGatewayEnvelope;
    FUND: TigerGatewayEnvelope;
  };
}
```

`fetchRaw` runs ≤5 POSTs (+ optional garden GET).

**Envelope `code` policy:**

| Call | Non-zero `code` |
|---|---|
| `accounts` (optional) | Log and continue with `managed_accounts: null` (account_kind falls back to id heuristic) |
| `assets` / `prime_assets` | **Fail** the sync (`BrokerHttpError`) — cash is required |
| `positions` STK | **Fail** the sync |
| `positions` OPT or FUND | **Skip that sleeve**: log vendor `code`/`message`, store `{ code, message, data: { items: [] } }` in the bundle, continue. Prime books with no options/funds must not block equity+cash. |

Empty STK with `code=0` and empty `items` is valid (flat book). If a live TBSG fixture later shows OPT/FUND missing types as `code=0` + empty `items`, keep querying them; the skip path is only for non-zero.

#### Wire JSON → books (camelCase)

Gateway `data` is **camelCase**. Published position samples are **flat `data.items[]`**, not SDK `contract.*` nesting. Mapper must work **before** TBSG smoke (unit tests use the minimized example below).

**Item list:**

```ts
const items = Array.isArray(data) ? data : data?.items;
if (!Array.isArray(items)) throw new BrokerParseError('positions data has no items array');
```

**Per-item field reader** (nested SDK shape is a fallback only):

```ts
function pick(item: Record<string, unknown>, ...keys: string[]): unknown {
  const nested = item.contract && typeof item.contract === 'object' ? (item.contract as Record<string, unknown>) : undefined;
  for (const k of keys) {
    if (item[k] != null) return item[k];
    if (nested?.[k] != null) return nested[k];
  }
  return undefined;
}
// symbol = pick(item, 'symbol')  → item.symbol ?? item.contract?.symbol
// same for secType/sec_type, market, currency, expiry, strike, right/putCall, multiplier
```

| Reader | Books |
|---|---|
| `pick(item, 'symbol')` | Yahoo via `yahooSymbolFromBroker` (STK/FUND) |
| `pick(item, 'secType', 'sec_type')` | STK/OPT/FUND/FUT |
| `pick(item, 'market')` | mapping table |
| `pick(item, 'currency')` | lot currency |
| `pick(item, 'expiry')` | options yyyyMMdd |
| `pick(item, 'strike')` | options |
| `pick(item, 'right', 'putCall')` | PUT/CALL |
| `pick(item, 'multiplier')` | options |
| `item.positionQty` else `quantity` / `10^positionScale` | size; **prefer `positionQty`** |
| `item.averageCost` | `avg_price` |
| `item.latestPrice` | options/funds mark input |

**Minimized `data.items` example** (check in as `tests/fixtures/tiger/positions-stk-opt.json`; secrets-stripped):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "items": [
      {
        "symbol": "AAPL",
        "secType": "STK",
        "market": "US",
        "currency": "USD",
        "positionQty": 10,
        "averageCost": 180.5,
        "latestPrice": 232.44,
        "multiplier": 1
      },
      {
        "symbol": "AAPL",
        "secType": "OPT",
        "market": "US",
        "currency": "USD",
        "positionQty": -1,
        "averageCost": 295.8904,
        "latestPrice": 2.10,
        "multiplier": 100,
        "expiry": "20260116",
        "strike": 230,
        "right": "PUT",
        "underlyingSymbol": "AAPL"
      }
    ]
  }
}
```

Numeric strings: parse with a helper; skip the lot if non-finite.

| `secType` | Policy |
|---|---|
| `STK` | Equity. `units = qty`. Skip if `qty ≤ 0` (shorts). |
| `OPT` | See option Holding below. **Short OPT is imported** (`side: 'short'`) like Flex, not skipped. |
| `FUND` | Fund holding: `instrument: 'fund'`, `fund.quote_source: 'manual'`, `fund.mark` from `latestPrice`. Skip if mark missing. |
| `FUT` / other | `skipped` |

**Duplicate map key:** if two lots collapse to the same `ticker` (Yahoo base), **skip the later** with reason `duplicate map key` (same as `holdingsFromOpenPositions`). Do not throw `assertBrokerStatement` after a successful fetch.

#### Cash / metrics (Prime vs Global)

Parse numbers from number or numeric string. Skip non-finite.

**Prime / paper** (`prime_assets` → `data` object with `segments`):

| Vendor path | Destination |
|---|---|
| `segments.S.currencyAssets[CCY].cashBalance` (or `currency_assets` / `cash_balance` — fixture pins camelCase) | `cash[]` sleeve if `≥ 0`; else `skipped` kind cash |
| `segments.C` (futures) | skip cash |
| `segments.D` (crypto) | skip cash |
| `segments.F` (fund) | **skip cash** (KD-T8). FUND **positions** still come from `positions.FUND`. Do not double-count F cash with S |
| `segments.S.buyingPower` | `metrics.buying_power` |
| `segments.S.excessLiquidation` (wire; SDK `excess_liquidation`) | `metrics.excess_liquidity` |
| `segments.S.maintainMargin` (wire; SDK `maintain_margin`) | `metrics.maintenance_margin` |
| `segments.S.currency` or `base_currency` | `metrics.currency` (default USD if missing but numbers exist — **no**: require an ISO from the envelope; else omit entire `metrics`) |

Do **not** book `cashAvailableForTrade` / `buyingPower` as cash.

**Global** (`assets` → `data` array, take matching account):

| Vendor path | Destination |
|---|---|
| `marketValues[CCY].cashBalance` | cash sleeve if `≥ 0` |
| `summary.cash` | **do not** use as a sleeve if `marketValues` present |
| `summary.sma` | never |
| `summary.buyingPower` | `metrics.buying_power` |
| `summary.excessLiquidity` | `metrics.excess_liquidity` |
| `summary.maintenanceMarginRequirement` | `metrics.maintenance_margin` |
| `summary.currency` | `metrics.currency` |

If after skips `cash[]` is empty → parse fail (like Flex “CashReport has no currency rows”). Keep **zero** sleeves.

`as_of`: UTC date of `fetched_at`. `account_id`: stored account string.

Live TBSG smoke **collects** the first real `TigerRawBundle`; it does not replace the schema. Check in sanitized fixtures (no secrets) covering: US STK, HK padded, OPT long+short, FUND, mixed cash with negative HKD, empty positions, STK-only vs STK+OPT+FUND.

---

### Option Holding shape (Tiger + any future MooMoo option map)

Copy Flex (`flex-map.ts`). `Holding.option` requires `right`, `side`, `strike`, `expiry` (`YYYY-MM-DD`), `multiplier`, `underlying`, **`settlement`**, **`mark`** (dollars **per contract**).

| Field | Rule |
|---|---|
| `right` | PUT→`put`, CALL→`call`; else skip |
| `side` | `qty < 0` → `short`, else `long`. Import shorts (Flex). `units = abs(qty)` |
| `expiry` | yyyyMMdd or yyyy-MM-dd |
| `strike` | `> 0` |
| `multiplier` | `> 0`; skip if missing (do not assume 100 — HK options are not OCC 100) |
| `underlying` | `item.underlyingSymbol` ?? `item.contract?.underlyingSymbol` ?? `item.identifier` if that is a ticker. **Do not** use OPT `symbol` as underlying (OCC / vendor option codes are not Yahoo underlyings). If none of those fields yield a non-empty ticker, **skip** the lot (`option missing underlying`) — never guess |
| `settlement` | `'physical'` unless a fixture proves cash-settled for that market |
| `mark` | `latestPrice * multiplier` (per-contract). Skip if missing/non-finite (Flex requires mark) |
| `quote_source` | omit (auto), same as Flex |

MooMoo: **do not ship option lots** until a REST fixture fills every `OptionSpec` field. Unmapped codes (`HK.TCH260629C390000` without a proven parse) → skip `option code not mapped`.

---

### Symbol mapping

`src/brokers/yahoo-symbol.ts`:

```ts
export function yahooSymbolFromBroker(input: {
  market: string; // US, HK, SG, AU, JP, CN, SEHK, HKEX, …
  symbol: string;
}): string | { skip: string };
```

| market (upper) | symbol | Yahoo or skip |
|---|---|---|
| `US` | `AAPL` | `AAPL` |
| `HK`, `SEHK`, `HKEX` | numeric `700` / `00700` | `0700.HK` (`padHk`) |
| `SG` | `D05` | `D05.SI` |
| `AU` | `BHP` | `BHP.AX` |
| `JP` | `9984` | `9984.T` |
| `CN` / `SH` / `SZ` / other | — | `{ skip: "market … is not imported" }` |

`yahooSymbolFromFlex` becomes a wrapper: listingExchange `SEHK`/`HKEX` → market HK, else US-like bare symbol (today’s behavior).

MooMoo `MARKET.CODE`: split on first `.`; market = prefix; symbol = rest. `CA.` / `BMS.` / `CC.` / `SH.` / `SZ.` → skip unless a later fixture proves a Yahoo suffix.

Store `holding.broker_ref.listing_exchange` when market is known.

---

### MooMoo ingest (PR 3)

Host `https://webapi.moomoo.com` only.

**`MooMooRawBundle`** (`schema: "invage.moomoo.raw.v1"`): `{ fetched_at, acc_id, authorized, funds, positions }` where each of the last three is the raw `{ s, d, errcode?, errmsg? }` envelope.

Fetch:

1. `GET /api/v1.0/accounts/authorized_trd_accs`
2. `acc_id`: credential, else unique `d.accounts[0].account_id`, else fail (“multiple authorized accounts — paste acc_id”).
3. `GET /api/v1.0/accounts/{acc_id}/funds?currency=USD` — query param **`currency` is required** by the API (not optional). Used only as display currency for converted fields; **do not** book `cash` / `power`.
4. `GET /api/v1.0/accounts/{acc_id}/positions`

Method 2 headers: `X-Api-Key`, `X-Timestamp`, `X-Nonce`, `Authorization` (signature, **no** `Bearer`). Clock skew >5s (`errcode -12006`) → `GET /api/v1.0/server-time` once and retry. Record `X-RateLimit-*` / `Retry-After` in logs if present (vendor docs do not publish a numeric cap comparable to Tiger’s 60/min).

**Funds → cash** (string amounts → finite numbers; skip non-finite):

| REST field | ISO |
|---|---|
| `us_cash` | USD |
| `hk_cash` | HKD |
| `cn_cash` | CNH |
| `jp_cash` | JPY |
| `sg_cash` | SGD |
| `kr_cash` | KRW |

Keep zeros. Skip negatives. Do not book `cash`, `available_funds`, `power`, `*_net_cash_power`, `max_withdrawal`. Metrics: `power` → `buying_power`, `maintenance_margin` → `maintenance_margin`, `currency` from the **query** (`USD`) only if those numbers are finite.

**Positions:** parse `qty`, `cost_price`, `nominal_price` as finite numbers (REST types are **strings**). Skip non-finite. `qty ≤ 0` or `position_side === 'SHORT'` → skip (equities; no option map in v1 without fixture). `avg_price` only if `cost_price_valid === true` and `cost_price > 0`.

**AppKey smoke checklist (PR 3 owner, before catalog row):**

| Step | Pass |
|---|---|
| Entity | Funded `FUTUSG` (SG) first (KD-T15). Ingest `FUTUSECURITIES` if that `acc_id` is authorized; do not promise HK options without fixtures |
| `GET authorized_trd_accs` | envelope `s === "ok"`, `d.accounts.length ≥ 1`, `security_firm` recorded |
| `GET funds?currency=USD` | `s === "ok"`, at least one of `us_cash`/`hk_cash`/`sg_cash` present |
| `GET positions` | `s === "ok"`, `d` is an array (possibly empty) |
| Distinguish failures | `s === "error"` + `errcode`/`errmsg`: clock skew `-12006` vs 401/permission vs bad AppKey. **“AppKey cannot trade:read”** = authenticated quote call works (e.g. trading-days) **and** funds/positions return a permission/scope error. Bad key/clock is not that signal. |
| Sanitized fixtures | Check in the three envelopes with secrets stripped |

If the checklist fails on permission → **stop PR 3**; file OAuth v1.1. Do not ship OpenD.

OAuth v1.1 (not in PR 3 unless gate fails): Invage-registered client; redirect `/api/domain/invage/broker-connections/moomoo/oauth/callback`; store `refresh_token` as secret; scopes `trade:read` only.

---

### Existing lots / `jude_futu` / recon copy

| Today | After this ships |
|---|---|
| Manual `MSFT@moomoo` | First successful `moomoo` sync **replaces all `moomoo` lots** |
| Manual `*@tiger` | Same on `tiger` sync |
| `*@jude_futu` cash + lots | **Untouched** by `moomoo` sync |
| FDs on `jude_futu` | **Untouched** (`applyBrokerStatement` does not write deposits) |
| Disabled connector | Lots stay (KD-7) |

`listReconChannels` unions holdings channels **plus enabled catalog ids**. After enabling `moomoo`, a user with `jude_futu` lots sees **two** sleeves.

**Bookkeeper / recon copy (skill + `source_recon_channel` fail/help text):**

- “Connector `moomoo` fetches Cloud Open API into channel `moomoo` only. It never reads `jude_futu`.”
- “To move Futu-tagged lots onto `moomoo`, recon the `jude_futu` sleeve (paste or `update_holding`) and the `moomoo` sleeve (connector fetch) separately. `take` on one does not delete the other.”
- “Fixed deposits stay on their channel; broker sync does not mature or move FDs.”

No YAML sweep. No silent rename.

---

### Settings iframe **and** Brokers nav (PR 2)

Both `webui/settings/brokers/app.js` and `webui/brokers/app.js`:

- Loop `payload.connectors`. Disable hint: “Stops {display_name} pulls. Holdings tagged `{channel}` stay on the dashboard.”
- IP `<li>` **only** if `conn.ip_whitelist_help === true`. IBKR vs Tiger copy from `help_notes` or a small `ipHelp(conn, egress)` branch (IBKR 1013 language only for `ibkr`).
- `help_href` link text from `help_href_label`. **Iframe fallback** if the field is missing: `ibkr` → “Flex Web Service docs”; else “OpenAPI docs”. PR 2 still **stamps** IBKR catalog extras (`ipWhitelistHelp: true`, `helpHrefLabel: 'Flex Web Service docs'`) so GET is complete without relying on the fallback.
- `field.widget === 'textarea'` or `field.format === 'pem'` → `<textarea>` (secret: empty when configured, placeholder last4). PATCH still sends the secret only when the user typed a non-empty value.
- Timeout 90s unchanged.

**Nav-only:**

- `UPCOMING` keeps `{ name: 'Webull' }`. Drop `MooMoo` / `Tiger Brokers` **or** leave them — `liveNames.has(display_name)` already skips exact matches. **`displayName` must be those strings** so stubs disappear when the row ships.
- `IMPORTS` is IBKR-only today (“Prior-day books”, “Flex token”, “channel ibkr”). Replace with **per-page generic** bullets plus a one-line per live connector from `capability`, **or** hide IMPORTS when `connectors.length > 1` and show each card’s capability. Do not leave “Activity Flex updates once per business day” as the only story after Tiger ships.
- `lastSyncSub`: stop saying “no Flex account yet”; use “no account yet”.

**`webui/brokers/index.html`:** replace hardcoded IBKR capability paragraph with catalog-driven text (or a generic intro: “Read-only brokerage channels. Enable a card, paste credentials, Sync. Marks stay Yahoo.”).

**Chat empty-state** (`src/webapp/invage-webui.ts`): “Brokers to connect read-only IBKR Flex, Tiger, or MooMoo (when listed).” Update in the PR that adds the first extra catalog row (PR 2 can say “IBKR Flex or Tiger”).

---

### Errors

PR 2 adds in `src/brokers/errors.ts` (or adapter module):

```ts
export class BrokerHttpError extends Error {
  readonly errorCode = 'broker_http' as const;
  constructor(message: string, readonly vendorCode?: string) {
    super(message);
    this.name = 'BrokerHttpError';
  }
}
export class BrokerParseError extends Error {
  readonly errorCode = 'broker_parse' as const;
  constructor(message: string) {
    super(message);
    this.name = 'BrokerParseError';
  }
}
```

Tiger/MooMoo clients throw these. `mapSyncError`:

| Class | Status | `error` |
|---|---|---|
| `FlexHttpError` | 502 | `flex_http` (unchanged) |
| `FlexProtocolError` / IBKR parse regex | 400 | `flex_parse` (unchanged) |
| `BrokerHttpError` | 502 | `broker_http` |
| `BrokerParseError` | 400 | `broker_parse` |
| apply / books | 400/500 | `broker_apply` for non-IBKR; IBKR may still `flex_apply` if message matches `/IBKR Flex/` |

Do **not** regex-map Tiger messages into `flex_*`.

PR 2 generalizes:

```ts
new BrokerNotConfiguredError(displayName)
// `${displayName} is not configured. Finish Settings → Brokers.`
new SyncInProgressError()
// `A sync is already running for this connector. Wait, then Refresh.`
```

Update tests/skills that grep the old Flex sentences in the same PR.

---

### Tools

`configure_broker`: `connector_id` + `credentials` map. **Calls `patchBrokerConnection` then sets `enabled: true`** (or `patchBrokerConnection(..., { enabled: true, credentials })`). Not a parallel YAML writer. Unknown keys already 400 from PATCH. Never echoes secrets. PEM goes through the same normalize.

`sync_broker`: `connector_id` → `syncBrokerConnection`.

Keep `configure_ibkr_flex` / `sync_ibkr_flex` as aliases.

`save_broker_parser` / `parse_broker_raw`: **refuse** unless `getBrokerAdapter(id).usesCsvTables` (IBKR only). `read_broker_raw`: copy says raw may be JSON; do **not** tell the model to generate csv_tables for `looks_like: json`.

---

### Archive, triage, `list_raw_data`

`archiveBrokerSuccess`:

| Connector | Path | `describe()` |
|---|---|---|
| ibkr | `drive/<slug>/ibkr-flex/activity-{asOf}-{stamp}.xml` | already `broker-sync` / channel `ibkr` |
| tiger | `drive/<slug>/tiger-raw/snapshot-{asOf}-{stamp}.json` | **extend** `describe()`: `parts[0]==='tiger-raw'` → channel `tiger`, `source_kind: 'broker-sync'` |
| moomoo | `drive/<slug>/moomoo-raw/snapshot-{asOf}-{stamp}.json` | `moomoo-raw` → `moomoo` / `broker-sync` |

PR 2 **must** change `src/raw-data/store.ts` and `tests/raw-data.test.ts`. Update `broker-integration.md`: successful IBKR in `ibkr-flex/`; successful Tiger in `tiger-raw/`; triage still `broker-raw/<connector>/`.

Triage (PR 2 gate, not polish):

- `RAW_LOOKS_LIKE` add `'json'` (`trimStart` `{` or `[`, and not Flex XML/CSV).
- `raw_rel`: `raw.json` | `raw.xml` | `raw.txt`.
- JSON inventory: top-level keys / array lengths in `tags` (e.g. `positions.STK`); `position_qty_attr: 'none'`. Do not count `<OpenPosition`.

---

### Load / latency

IBKR poll unchanged (~70s worst). Tiger ≤5 POSTs + garden GET; MooMoo 3 GETs. Target **&lt; 15s** typical; UI abort 90s. Inflight 1 sync per slug+id. Tiger ~60 req/min — 5 calls is fine.

---

## API / Interface Changes

GET connector objects gain `ip_whitelist_help`, `help_href_label`, and credential field `widget` / `format`.

PATCH: PEM normalize for `format: 'pem'`.

`syncBrokerConnection(snapshot, id, opts?: { transport?: AdapterTransport })`.

REST is not an agent tool (KD-5).

---

## Data Model Changes

No new YAML types. Unknown connector keys still throw on read.

After PR 2, YAML key `tiger` is **valid**. Tests: unknown id becomes `webull` (or `not-a-connector`). `publicCatalog` length is 2; look up IBKR by `id`, do not assume `[0]`.

**Rollback of PR 2:** reverting the catalog row while `broker_connections.tiger` remains **500s GET** (`Unknown broker connector "tiger" in broker_connections` → `broker_connections_invalid`). Operator **must delete the YAML key before revert**, or leave a disabled catalog row in the revert. Do not remove the catalog id while user YAML still contains it. Catalog presence is the feature flag **forward**; rollback is not automatic.

`BrokerStatement.as_of` remains `YYYY-MM-DD` (sync UTC date for live vendors).

---

## Alternatives Considered

### A. Adapter + thin HTTP clients (chosen)

One apply/recon/lock path; no trade SDK; Settings/nav cards free. Cost: reimplement RSA-SHA1 and domain-garden allow-list. Mitigation: sign-string fixture; host allow-list.

### B. Depend on `@tigeropenapi/tigeropen` and `moomoo-api`

Trade methods in-process. **Rejected.**

### C. Combined “asia broker”

Violates KD-3/KD-4. **Rejected.**

### D. MooMoo OAuth as v1

Vendor-recommended for third-party apps. Deferred to v1.1 if AppKey checklist fails.

### E. OpenD sidecar

Same class as TWS. **Rejected.**

### F. Subset SDK HTTP helper (`HttpClient.execute` without `TradeClient.placeOrder`)

**Pros:** Domain-garden + TBHK token refresh already implemented; less signer code.

**Cons:** The npm package still ships `placeOrder` / `cancelOrder` in-process; a future import is one line; supply-chain surface is the full SDK. Garden hosts could change without our allow-list.

**Rejected.** If garden/signing cost explodes, the only acceptable middle path is a **vendored** signer+gateway file (not the npm SDK) plus a test grep that `place_order` / `cancel_order` are absent. That is still not PR 2.

---

## Security & Privacy Considerations

| Threat | Severity | Mitigation |
|--------|----------|------------|
| Trade method in-process | **High** | KD-T5; method allow-list; grep `place_order` / `unlock_trade` |
| `trade:write` | **High** | Never request |
| PEM / AppKey / token in GET, logs, tools | **High** | Public DTO last4; `redactSecrets`; no PEM in logs |
| LLM wrapping GET | **High** | Session APIs off the tool list |
| Admin `?slug=` | **High** | `loadSessionState` only |
| Garden SSRF | **High** | POST only allow-listed hosts |
| Clock-skew replay (MooMoo) | **Medium** | `X-Nonce`; one server-time retry |
| Paper mixed into live books | **Medium** | KD-T12 |
| XSS in iframes | **Medium** | `escapeHtml` / `textContent` |

---

## Observability

Logs: `broker_sync` with connector id, gateway host, method list (`positions:STK,OPT,FUND`), HTTP status, `as_of`, lots counts. Never PEM, AppKey, Flex `t=`, or `biz_content` with keys. User-visible: status chip + `not_imported`. No new metrics infra.

---

## Rollout Plan

1. **PR 1** — adapter, IBKR-only catalog, Flex error strings **unchanged**. Deploy with existing Flex `create_task`.
2. **PR 2** — Tiger + Settings/nav copy + PEM + `list_raw_data` + JSON triage + `configure_broker` + error classes. No auto-enable.
3. **PR 3** — MooMoo after AppKey checklist + fixtures. Reuses PR 2 UI/tools.
4. **No PR 4** for the former polish bucket; leftover copy nits fold into 2/3.
5. No background migration. Catalog presence is the **forward** flag.
6. Smoke: internal funded **TBSG**, then invite; MooMoo **`FUTUSG` first** (KD-T15). Do not block PR 2 on MooMoo.

**Rollback PR 2:** disable the Tiger channel (lots stay) **or** revert code **after** deleting `broker_connections.tiger` from user YAML. Reverting the catalog id first 500s Settings GET.

---

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| `positions` default STK omits options | **High** | Always STK+OPT+FUND; mixed fixture |
| Wire camelCase ≠ SDK names | **High** | Map HTTP fields; fixture is source of truth |
| MooMoo REST lacks option fields | **High** | Skip until OptionSpec-complete fixture |
| Negative cash empties `cash[]` | **High** | Skip negatives; fail if none remain |
| AppKey cannot `trade:read` | **High** | Checklist; OAuth v1.1 — not OpenD |
| `jude_futu` vs `moomoo` recon split | **Medium** | Skill + recon copy |
| Catalog revert + leftover YAML | **High** | Delete YAML key before revert |
| PEM stripped by password input | **High** | textarea + normalize |
| `list_raw_data` hides tiger-raw | **High** | extend `describe()` in PR 2 |
| Yahoo suffix wrong | **Medium** | skip unknown markets |
| TBHK 30-day token | **Medium** | paste-rotate |

---

## Open Questions

**Resolved 2026-09-17** (user took the recommendations). Not unanswered forks.

| # | Question | Locked choice |
|---|---|---|
| 1 | Tiger-only first user-visible release vs wait for MooMoo? | **Tiger first.** PR 1 adapter, then PR 2 Tiger catalog card. MooMoo is PR 3 after AppKey smoke + REST fixtures. Do not wait to ship both (KD-T4). |
| 2 | MooMoo AppKey vs Invage OAuth app? | **Paste AppKey (Method 2) in v1.** Do not register an Invage OAuth app in v1. OAuth 2.1+PKCE is v1.1 only if the PR 3 live checklist shows a permission failure, not bad key/clock (KD-T6). |
| 3 | SG-only vs also FUTU HK / TBHK token refresh? | **Document all licenses; smoke SG first** (TBSG / `FUTUSG`). TBHK paste-rotate, no auto-refresh. Ingest Futu HK if that `acc_id` is authorized; no HK options without fixtures (KD-T15). |
| 4 | Option execution journal in v1? | **No** for Tiger/MooMoo. Positions + cash only. Option lots may still import when `OptionSpec` is complete. Journal is later work (KD-T16). |

---

## References

- `docs/plans/2026-08-22-broker-channel-settings-design.md`, `docs/plans/2026-08-28-channel-recon-flow-design.md`, `docs/plans/2026-09-16-victor-execution-journal.md`
- `src/brokers/catalog.ts`, `connections.ts`, `statement.ts`, `apply-statement.ts`, `triage.ts`
- `src/ibkr/flex-*.ts` (`yahooSymbolFromFlex`, `archiveXml`, `IBKR_CHANNEL`)
- `src/recon/source-connector.ts`
- `src/raw-data/store.ts` `describe()`
- `src/webapp/broker-api.ts`, `src/webapp/invage-webui.ts` (`chatEmptyState`)
- `webui/settings/brokers/app.js`, `webui/brokers/app.js` (`UPCOMING`, `IMPORTS`, `ipHelp`)
- `src/tools/ibkr_flex.ts`, `broker_ingest.ts`
- `tests/broker-connections.test.ts` (`toHaveLength(1)`, unknown `"tiger"`)
- `src/market/types.ts` `OptionSpec` (`settlement`, `mark`)
- MooMoo: https://open.moomoo.com/api/overview/getting-started.md , get-accounts.md , get-funds.md , get-positions.md
- Tiger: https://docs-en.itigerup.com/docs/prepare , https://docs-en.itigerup.com/docs/accounts ; SDK garden `https://cg.play-analytics.com`, default `https://openapi.tigerfintech.com/gateway`

---

## PR Plan

Independently reviewable. **No catalog row without that vendor’s adapter + fixtures in the same merge.** Former PR 4 work is **in PR 2** except MooMoo-specific copy (PR 3). **Ship Tiger (PR 2) without waiting for MooMoo (PR 3).** No OAuth PR in v1. No execution-journal PR in v1. SG smoke first (TBSG, then `FUTUSG`).

### PR 1 — Extract connector-fetch adapter (IBKR-only catalog)

| | |
|--|--|
| **Title** | `brokers: adapter for catalog fetch/parse (IBKR Flex behind interface)` |
| **Depends on** | none |
| **Files** | `src/brokers/adapter.ts` (new); `src/brokers/connections.ts`; `src/recon/source-connector.ts`; `src/ibkr/flex-adapter.ts`; `src/ibkr/flex-apply.ts` (keep `ibkr-flex/` paths); `tests/broker-connections.test.ts`; `tests/ibkr-flex.test.ts`; `tests/recon.test.ts` (csv_tables spec **ignored** on recon; `AdapterTransport`) |
| **Description** | `adapters: Record<string, BrokerConnectorAdapter>`. IBKR only. `usesCsvTables` only on IBKR. IBKR `parseToStatement` = Flex XML map only; `runCsvTablesSpec` lives in `syncBrokerConnection` gated by `usesCsvTables` + slug. Recon never calls `runCsvTablesSpec`. Preserve Flex transport, inflight lock, last_sync, ChannelOff. **Keep Flex-worded** `BrokerNotConfiguredError` / `SyncInProgressError`. Do **not** add tiger/moomoo rows. Do **not** change catalog length tests yet. |

### PR 2 — Tiger ingest + vendor-neutral UI/tools/triage

| | |
|--|--|
| **Title** | `brokers: Tiger OpenAPI connector (positions + cash)` |
| **Depends on** | PR 1 |
| **Files** | `src/tiger/*`; `src/brokers/catalog.ts` (**stamp IBKR** `ipWhitelistHelp` / `helpHrefLabel`, add Tiger `displayName: 'Tiger Brokers'`); `src/brokers/yahoo-symbol.ts`; `src/brokers/errors.ts`; `src/brokers/connections.ts` (`publicConnectorView` extras, PEM normalize, generalized error strings); `src/brokers/triage.ts` (`looks_like: json`, `raw.json`); `src/raw-data/store.ts` + `tests/raw-data.test.ts`; `src/webapp/broker-api.ts`; `src/webapp/invage-webui.ts` empty-state; `webui/settings/brokers/app.js`; `webui/brokers/app.js` + `index.html` (UPCOMING, IMPORTS, PEM textarea, IP/help, href-label fallback); `src/tools/broker_ingest.ts` / `broker_connect.ts`; `src/tools/ibkr_flex.ts`; `src/tools/index.ts`; `src/skills/knowledge/broker-integration.md`; `src/skills/knowledge/tiger-openapi.md`; `tests/broker-connections.test.ts` (length 2, lookup by id, unknown `webull`); `tests/tiger-openapi.test.ts` + `tests/fixtures/tiger/` (`positions-stk-opt.json` flat `data.items`, Asia/Shanghai `sign-string.txt`, prod+sandbox PEMs, negative HKD, OPT short); `tests/broker-triage.test.ts`; `docs/data-model.md` |
| **Description** | Thin signed HTTP; `TigerRawBundle`; garden + allow-list; **flat `data.items` reader** (`item.symbol ?? item.contract?.symbol`); Asia/Shanghai timestamps; prod vs sandbox public keys by host; OPT/FUND non-zero `code` skips that sleeve; STK+cash still required; Prime/Global cash/metrics including skip `F` cash; option Holding with settlement+mark, skip OPT without `underlyingSymbol`; `yahooSymbolFromBroker` + duplicate skip; JSON triage + refuse csv_tables / `save_broker_parser` for non-IBKR; `list_raw_data` provenance; Settings **and** nav; IBKR catalog extras stamped; `configure_broker` via `patchBrokerConnection`; `BrokerHttpError` / `BrokerParseError`. No npm SDK. Rollback: delete YAML key before reverting catalog id. Live TBSG smoke **records** fixtures, does not skip schema. |

### PR 3 — MooMoo Cloud REST ingest

| | |
|--|--|
| **Title** | `brokers: MooMoo Cloud Open API connector (positions + cash)` |
| **Depends on** | PR 1 and PR 2 (UI/tools/triage/PEM/`describe()` already generic) |
| **Files** | `src/moomoo/*`; `src/brokers/catalog.ts` (`displayName: 'MooMoo'`); `src/raw-data/store.ts` (`moomoo-raw`); `webui/brokers/app.js` (UPCOMING already matches `MooMoo`); skills `moomoo-openapi.md` + jude_futu recon copy; `tests/moomoo-openapi.test.ts` + `tests/fixtures/moomoo/`; `tests/broker-connections.test.ts` catalog length 3 |
| **Description** | Method 2 AppKey (no OAuth app in v1). Required `funds?currency=USD`; per-ISO cash; string qty parse; no options without OptionSpec fixture; fail-if-multiple `acc_id`. **AppKey smoke on `FUTUSG` first** (KD-T15) before merge. If permission-fail → stop PR 3 and file OAuth v1.1 later, not OpenD. Positions + cash only — no execution journal (KD-T16). |

**Not a PR (v1):** Webull; Invage MooMoo OAuth app; TBHK auto-refresh; Tiger/MooMoo option execution journal; OpenD; migrating `jude_futu`; npm SDK subset.
