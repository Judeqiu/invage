# Financial Database — PostgreSQL Journal-First Books of Record

**Date:** 2026-08-09  
**Status:** Design approved (Sections 1–4) · **Implementation started 2026-08-09** (`src/books/`, cash/deposit/holding posts when `INVAGE_BOOKS_DATABASE_URL` set)  
**Scope:** Replace per-user YAML as system of record for household / portfolio **books** with an open-source **PostgreSQL** ledger that supports flexible (controlled) query, multi-tenant security, and compliance-grade audit.  
**Non-scope (this design):** Market quote warehouse, tax engine, multi-entity legal ownership, TigerBeetle, free-form SQL for LLMs, replacing Utarus identity entirely in v1.

**Related:**

- [Data Model](../data-model.md) — current YAML SoR
- [Family Treasury Accountant](./2026-07-29-family-treasury-accountant-design.md)
- [Multi-Currency Cash Books](./2026-08-08-multicurrency-cash-books-plan.md)
- [Broker Integration Approaches](./2026-07-28-broker-integration-approaches.md)

---

## 1. Problem

Invage today stores portfolio, multi-currency cash, deposits, and household treasury as **mutable YAML** (`data/users/<slug>.yaml`) plus BinDrive **valuation snapshots**. Tool code enforces some double-entry (e.g. `transfer_cash`) and fail-fast rules (no silent FX). Soft `log[]` is not a financial journal.

That model fails when we need:

1. **Flexible query** — filtered journals, cash by `(channel, currency)`, P/L over a range, compliance exports — without loading whole YAML blobs.
2. **Secure multi-tenant data** — row isolation, least-privilege DB roles, encryption, no LLM-supplied household authority.
3. **Compliance / auditing** — append-only economic history, who/when/what tool, corrections as reversals, retain/export books independently of chat logs.

Family treasury v1 explicitly deferred a full transaction ledger; multi-ccy cash work showed integrity must be **hard** (DB + app), not skill text.

---

## 2. Goals and non-goals

### Goals

1. **Journal-first books of record** for household money and positions: every balance explainable as Σ journal lines.
2. **Preserve domain rules:** fail-fast, missing ≠ zero, no silent FX, double-entry for moves, `(channel, currency)` cash identity, lot identity `(instrument, channel)`.
3. **Security:** RLS by household, app role without bypass, secrets out of journal memos.
4. **Audit package:** immutable journal + actor/tool audit events + export path + backup/PITR expectations.
5. **Agent-compatible surface:** keep tool semantics; add journal reads; no raw SQL from the model.
6. **Lossless migration** from existing YAML amounts (1:1 opening journals; no auto-FX; no auto-repair of bad history).

### Non-goals (v1)

- Market / research time-series warehouse (may share the same Postgres later under a separate schema).
- TigerBeetle or other specialized transfer DBs (revisit only if product needs extreme transfer TPS).
- Full general ledger for external CPA tax filing formats.
- Monte Carlo risk, estate, multi-person ownership percentages.
- Moving Utarus invites/auth off YAML in the same project (map UUID/slug → `household_id` only).
- Free-form natural-language → SQL generation.

---

## 3. Key decisions

| # | Topic | Choice | Rationale |
|---|--------|--------|-----------|
| 1 | Primary job | Household / portfolio **books of record** | User choice; drives engine and cutover |
| 2 | Engine | **PostgreSQL** app-level ledger | Query + RLS + ops fit; scale is household not exchange |
| 3 | Rejected engines | TigerBeetle-only; Beancount/Firefly as SoR; YAML + audit-only forever | TB weak on flexible query / overkill; PTA apps not multi-tenant SoR; audit-only leaves mutable balances as truth |
| 4 | Source of truth | **Append-only journal**; balances are projections | Compliance + rebuildability |
| 5 | Money representation | **Integer minor units** + ISO currency | No float in ledger |
| 6 | Multi-ccy | No silent FX; balanced per currency or via explicit clearing + rate | Aligns with multi-ccy cash plan |
| 7 | Agent access | Typed tools + fixed read views; **not** LLM SQL | Isolation + project “no keyword routing” / capability descriptions |
| 8 | Identity | `household` 1:1 Utarus user v1 | Minimal blast radius |
| 9 | YAML fate | Import → dual-write → dual-read verify → **cutover** → freeze money fields | Safe migration |
| 10 | Corrections | Reversing + optional replacement entries only | Never UPDATE/DELETE journal rows |

---

## 4. Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│ Agents / tools (Bookkeeper, FinancialPlanner, portfolio tools)    │
│  transfer_cash, add_holding, mature_deposit, set_cash, …    │
└────────────────────────────┬────────────────────────────────┘
                             │ typed commands only (no raw SQL)
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ Books service (Invage domain)                               │
│  • validate domain rules (no silent FX, fail-fast)          │
│  • open transaction → write journal + lines → post balances │
│  • emit audit row (actor, channel, tool, request id)        │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ PostgreSQL — system of record                               │
│  tenants/users · chart of accounts · journal (append-only)  │
│  positions metadata · deposits · properties · liabilities   │
│  RLS by household_id · pgaudit · optional hash-chain        │
└─────────────────────────────────────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
         Current views   Audit export    Snapshots/NAV
         (balances)      (compliance)    (derived, not SoR)
```

**Layering note:** Books service lives in **Invage** (investor domain). Generic connection pooling / “set tenant GUC” patterns may later upstream to Utarus; ledger schema and posting rules stay Invage.

---

## 5. Domain schema

### 5.1 Core entities

| Entity | Role | Maps from today |
|--------|------|-----------------|
| `household` | Tenant / books unit (1:1 Utarus user v1) | `data/users/<slug>.yaml` |
| `account` | Chart of accounts leaf | Free cash sleeve, deposit, holding lot, property, liability, income/expense/equity/clearing |
| `instrument` | Position definition (equity/fund/option metadata) | Holding + option/fund blocks |
| `journal_entry` | One economic event (immutable header) | Implicit tool call |
| `journal_line` | Debit/credit on one account | Implicit double-entry |
| `audit_event` | Who/what/when around the write | Soft `log[]` |

### 5.2 Account kinds

```text
account_kind:
  cash            — free cash sleeve  → unique (household, channel, currency)
  deposit         — fixed deposit principal
  position        — equity/fund/option lot (units + cost)
  property        — real-estate mark
  liability       — mortgage/loan principal
  income | expense | equity | clearing — P&L and FX legs
```

**Cash identity:** `(household_id, channel, currency)` — same as multi-ccy plan (`cashBalanceKey`). Unassigned channel is a first-class empty channel key, not a silent default.

**Position identity:** map key style `TICKER` or `TICKER@channel` preserved as lot key; option base keys unchanged.

### 5.3 Journal shape (logical)

```text
journal_entry
  id uuid PK
  household_id uuid NOT NULL
  booked_at timestamptz NOT NULL
  value_date date NOT NULL
  type text NOT NULL
    -- transfer_cash | trade | mature_deposit | set_cash_import
    -- | property_payment | liability_payment | correction | opening_balance | …
  external_ref text NULL          -- broker fill id, import batch
  reverses_entry_id uuid NULL     -- correction chain
  memo text NULL
  created_by text NOT NULL        -- user slug / system
  tool_name text NULL
  request_id text NOT NULL        -- idempotency key (unique per household)
  prev_hash text NULL
  entry_hash text NULL

journal_line
  id uuid PK
  entry_id uuid NOT NULL
  household_id uuid NOT NULL      -- denormalized for RLS
  account_id uuid NOT NULL
  amount_minor bigint NOT NULL    -- signed minor units (convention fixed in impl)
  currency char(3–4) NOT NULL     -- must equal account.currency
  quantity numeric NULL           -- position units/contracts
  unit_cost_minor bigint NULL
```

**Implementation note:** Prefer either (a) signed `amount_minor` with a single convention documented in code, or (b) separate `debit_minor` / `credit_minor` with a CHECK that exactly one is > 0. Choose one in the schema PR; do not mix.

### 5.4 Invariants (one DB transaction)

1. Entry is **balanced**: Σ lines = 0 per currency, or multi-currency via explicit `clearing` + recorded rate (no silent FX).
2. Line `currency` **equals** `account.currency` or fail.
3. Cash accounts: post-balance **≥ 0** unless entry type is explicitly allowed to overdraw (default deny).
4. **No UPDATE/DELETE** on `journal_entry` / `journal_line` (triggers raise).
5. **Idempotency:** unique `(household_id, request_id)`.
6. **RLS:** every books table `USING (household_id = current_setting('app.household_id', true)::uuid)`.

### 5.5 Projections (not SoR)

| Table / view | Meaning |
|--------------|---------|
| `balance_current` | Account balance after last post |
| `position_lot` | Units + blended avg cost (same semantics as `accumulateHoldingBuy`) |
| `deposit_open` | Open FDs + dates/interest metadata |
| `property` / `liability` / `cash_flow_schedule` | Marks and schedules; money moves still journal when cash changes |

`set_cash` remains **import/correction only**: journal type `set_cash_import` / `opening_balance` balancing against an equity/import account — absolute target, never silent multi-row overwrite without lines.

### 5.6 Out of ledger core (remain domain tables or YAML short-term)

- Investment **playbook** (policy)
- Projection **assumptions / scenarios** (overlays; not books)
- Live market marks (runtime)
- Utarus identity, invites, auth tokens

---

## 6. Security, compliance, query surface

### 6.1 Threat model

| Risk | Control |
|------|---------|
| Cross-household read/write | RLS; `app.household_id` set only after Utarus channel resolution — LLM never authoritative for household id |
| LLM raw SQL | Typed command API + fixed read views only in v1 |
| Silent balance edits | Append-only journal; projections updated only on post path |
| History tampering | Optional hash chain on entries; periodic signed export to WORM/object storage |
| Secrets leakage | Broker tokens etc. in separate secrets store; never journal memo |
| Missing treated as zero | API returns absent/null; fail-fast when required for a decision |

### 6.2 Roles

| Role | Privilege |
|------|-----------|
| `invage_app` | DML on books via app; **no** `BYPASSRLS` |
| `invage_migrator` | DDL offline |
| `invage_auditor` | `SELECT` on journal + audit views only |

### 6.3 Platform controls

- Volume encryption at rest; TLS to Postgres if not co-located.
- **pgaudit** for DDL, role changes, and optional SELECT on sensitive tables.
- **PITR** (WAL); encrypted backups; restore drills documented in ops runbook.
- Retention: policy table for chat/PII vs **money journal** (journal retained longer by default policy — exact durations are an open product decision).

### 6.4 Query surface (three layers)

```text
1. Domain reads (tools)
   get_portfolio, get_household, list_journal_entries, get_entry, account balances
   → fixed SQL, household-scoped

2. Structured query API (dashboard / admin)
   filters: date range, channel, currency, entry type, instrument
   aggregates: NAV by channel, cash by (channel, ccy), movement over range
   → parameterized + RLS

3. Analyst SQL (ops only)
   invage_auditor on primary or read replica
   → humans / compliance scripts, not agents
```

New report capabilities are added as **described tools/views** (intent + capability), not keyword routers or unconstrained SQL generation.

---

## 7. Write path

```text
channel message → resolve Utarus user → SET app.household_id
  → tool command
  → domain validate (fail-fast)
  → BEGIN
       INSERT journal_entry + journal_lines
       assert balanced; assert cash rules
       UPDATE balance / lot projections
       INSERT audit_event
  → COMMIT
  → return balances + entry id
```

- One transaction = one economic event.
- Corrections: new entry with `reverses_entry_id`, then optional replacement.
- Non-money state (playbook, assumptions, scenarios): row versioning + `audit_event` only — no fake journal lines.

### 7.1 Tool mapping (illustrative)

| Tool / action | Journal type(s) | Notes |
|---------------|-----------------|-------|
| `transfer_cash` | `transfer_cash` | Same-ccy two cash accounts; net zero that ccy |
| `mature_deposit` | `mature_deposit` | Deposit → free cash same channel+ccy |
| `set_cash` | `set_cash_import` | Absolute; import equity leg |
| `add_holding` (adjust_cash) | `trade` | Position qty + cash leg |
| `remove_holding` | `trade` / reverse | Cost-basis rules as today unless product changes |
| `add_deposit` | `deposit_open` | Cash → deposit principal |
| `record_property_payment` | `property_payment` | Optional cash debit via channel |
| Historical import | `opening_balance` | M0 migration |

---

## 8. Migration from YAML

| Phase | Behavior |
|-------|----------|
| **M0 Bootstrap** | Create `household`, accounts, **opening journals** for every known sleeve/lot/deposit/property/liability. Missing blocks stay missing (no invented zeros). |
| **M1 Dual-write** | Postgres first; on success optionally mirror projections to YAML. PG failure → fail closed. |
| **M2 Dual-read verify** | Compare PG vs YAML samples; alert on diff; never silently prefer YAML for money. |
| **M3 Cutover** | Reads from Postgres only. YAML optional export/backup. |
| **M4 Freeze YAML books** | Stop writing money fields to YAML; identity may remain Utarus YAML. |

**Lossless:** amounts map 1:1; no auto-FX; bad historical one-leg credits fixed only by **manual** correction journals from bank/broker evidence.

---

## 9. Success criteria

1. Any current balance = rebuild from journal lines (bit-for-bit projections).
2. Cross-household access fails under RLS (tested).
3. Unbalanced entry cannot commit.
4. Same-ccy transfer cannot one-leg (app + DB).
5. Cross-currency without explicit rate/clearing fails fast.
6. `request_id` retry does not double-post.
7. Auditor role can export journal for a household without write access.
8. YAML cutover: production reads money only from Postgres.

---

## 10. Alternatives considered

| Alternative | Why not (for books SoR) |
|-------------|-------------------------|
| **TigerBeetle + Postgres metadata** | Excellent immutability/TPS; poor ad-hoc query; two systems; overkill for household books |
| **Event store only** | Flexible projections; higher complexity for agent exactly-once and balance UX |
| **Keep YAML + append audit log** | Audit without journal still allows mutable balances as “truth” |
| **Plain-text accounting (Beancount/hledger) as multi-tenant SoR** | Great personal workflows; weak multi-tenant RLS/SaaS security model |
| **QLDB / commercial ledger DBaaS** | Not required; pattern (immutable journal) implemented on Postgres |

---

## 11. Open questions

1. **Retention durations** — how long to keep money journal vs chat vs access logs (product/legal).
2. **Hash chain** — v1 required vs phase-2 optional (export + PITR may suffice initially).
3. **Dual-write duration** — minimum verify window before M3 cutover.
4. **Where Postgres runs** — co-located on invage host vs managed PG (ops choice; design is engine-agnostic).
5. **Scenarios / assumptions storage** — Postgres tables in same DB (non-ledger schema) vs remain YAML until later.
6. **Signed amount vs debit/credit columns** — pick in schema PR (Section 5.3).

---

## 12. PR plan

| PR | Title | Deliverable | Depends |
|----|--------|-------------|---------|
| **PR1** | Schema, RLS, append-only triggers | Migrations, roles, household/account/journal tables, invariant tests (unbalanced, update blocked, RLS) | — |
| **PR2** | Posting engine | Transactional post API, idempotency, balance/lot projections, unit tests | PR1 |
| **PR3** | Cash path tools | `set_cash`, `transfer_cash`, `clear_cash` via journal; wire Bookkeeper happy path | PR2 |
| **PR4** | Deposits | `add_deposit` / `mature_deposit` / `remove_deposit` journaled | PR3 |
| **PR5** | Holdings / trades | `add_holding` / `update_holding` / `remove_holding` with cash legs; cost blend | PR2 |
| **PR6** | Treasury money moves | Property payments, liability principal payments (schedules as tables) | PR2 |
| **PR7** | YAML M0–M2 | Import opening balances, dual-write, verify harness | PR3–PR6 (can stage: cash first) |
| **PR8** | Cutover M3–M4 | Read path Postgres-only; freeze YAML money fields; ops runbook | PR7 |
| **PR9** | Compliance pack | `list_journal_entries` tools, audit export, pgaudit config notes, backup restore drill doc | PR1+ |

Suggested vertical first slice for production risk reduction: **PR1 → PR2 → PR3 → cash-only YAML import/dual-write**, then expand instruments.

---

## 13. Documentation follow-ups (after implementation starts)

- Update [data-model.md](../data-model.md): Postgres as money SoR; YAML legacy/export.
- Short ops page: roles, backup, restore, export.
- Agent skill touch: Bookkeeper — journal-aware reconcile language (no keyword routers).

---

*Design validated in conversation 2026-08-09: Approach A (PostgreSQL journal-first); Sections 1–4 approved.*
