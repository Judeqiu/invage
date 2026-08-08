# Multi-Currency Cash Books — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make household free cash multi-currency accurate so Bookkeeper cannot invent FX, overwrite the wrong sleeve, or one-leg a transfer — books stay easy to journal and hard to corrupt.

**Architecture:** Change free-cash identity from **channel-only** to **`(channel, currency)`**. Add atomic double-entry tools (`transfer_cash`, `mature_deposit`) that enforce conservation in code. Keep `set_cash` for absolute import/correction only. Surface matured FDs and multi-ccy slots clearly in reads/reconcile. Update Bookkeeper skill so the happy path is one tool call sequence, not multi-step absolute sets.

**Tech Stack:** TypeScript, Vitest, existing Invage portfolio/household state (`src/state/portfolio-state.ts`, tools, Bookkeeper agent, dashboard).

**Status:** Implemented (core) — **v2 lossless conversion**  
**Date:** 2026-08-08  
**Incident driver:** User transferred USD 10,000 DBS → IBKR; Bookkeeper credited IBKR free cash without debiting source (double-count) and could not represent DBS USD free cash alongside DBS SGD.

**Conversion guarantee:** Existing free cash and deposits load 1:1 with no amount loss; migration is load-path + safer mutators, not a batch rewrite of user YAML.

---

## 1. Problem statement

### What the user needed

```
DBS USD (from matured FD) −10,000  →  IBKR USD +10,000
DBS SGD free cash                 →  untouched
Household net worth               →  unchanged (move, not income)
```

### What the books allowed instead

1. **One free-cash slot per channel** — `dbs` could hold SGD *or* USD, not both. Real multi-currency bank accounts are unrepresentable.
2. **Absolute `set_cash` only** — transfers are two independent writes in the LLM’s head; destination-only credit is legal and silently inflates cash.
3. **Matured FDs stay locked** — principal remains in `deposits`; unlocking into free cash of a *different* currency than the channel’s existing free cash fails or corrupts (delta has no currency identity).
4. **Soft skill rules** — “don’t invent FX / fail fast” do not create slots or double-entry; they cannot make the wrong journal impossible.

### Incident journal (incorrect)

| Step | Action | Effect |
|------|--------|--------|
| Wrong | Credit IBKR 10,000 USD free cash | +10k free cash from nowhere |
| Wrong | Leave DBS SGD and matured FD untouched | Source not reduced |
| Result | Total cash inflated; NAV inflated | Books lie |

---

## 2. Design principles (non-negotiable)

| # | Principle | Implication |
|---|-----------|-------------|
| P1 | **Fail fast, no silent FX** | No invented rates; cross-ccy needs both legs or explicit rate |
| P2 | **Double-entry for moves** | Inter-channel same-ccy transfer is one atomic op; net free cash in that ccy unchanged |
| P3 | **Identity includes currency** | Free cash key = `(channel, currency)`; SGD and USD at same bank are separate sleeves |
| P4 | **Deposits unlock by currency** | FD principal becomes free cash on **same channel + same currency** only |
| P5 | **Import ≠ transfer** | `set_cash` = absolute balance after screenshot/correction; transfers never use destination-only set |
| P6 | **Easy for Bookkeeper** | Happy path is 1–2 tools with hard failures; not multi-turn “confirm FX options” inventing rates |
| P7 | **No fallback defaults** | Missing slot / insufficient funds / currency mismatch → throw with exact error |

---

## 3. Decisions

| Topic | Choice | Rejected |
|-------|--------|----------|
| Free cash identity | `(channel, currency)` | Channel-only (current); synthetic `dbs_usd` channel names |
| Same-ccy bank→broker move | `transfer_cash` atomic tool | Two `set_cash` calls |
| FD unlock | `mature_deposit` (full or partial principal) → free cash same ccy/channel | Manual `update_deposit` + `set_cash` |
| Cross-currency | v1: **out of scope for atomic convert**; require user both-legs later via `convert_cash` | Silent live FX on journal |
| `set_cash` after change | Upsert **one** `(channel, currency)` absolute amount; other slots preserved | Overwrite all ccy on channel |
| `clear_cash` | Optional `currency`; channel-only clear removes **all ccy** on that channel | — |
| Trades `adjust_cash` | Debit/credit matching `(holding.channel, trade currency)`; trade ccy = cash slot ccy (already no silent FX) | Debit any ccy on channel |
| Reporting / NAV totals | Unchanged: mixed ccy needs `treasury.reporting_currency` + FX rates (live or assumptions) | Invent 1:1 |
| Migration of existing YAML | **Lossless, load-path only** — every existing cash row maps 1:1 to a `(channel, currency)` slot with identical `amount` / `currency` / `channel` / `updated_at`; no offline rewrite required for well-formed books | Auto-split or invent multi-ccy rows; auto-reverse bad journals |
| Key functions | Keep **channel-only** key for deposits/channel filters; add **separate** cash balance key `(channel, currency)` | Reusing/breaking `cashSlotKey(channel)` for currency (would break deposits) |
| Bad historical one-leg credits | Manual absolute repair from bank/broker screenshots; **no automatic rewrite of user money** | Auto-guess reverse journals; `mature_deposit` on top of phantom free cash |

---

## 4. Target data model

### 4.1 Free cash

```yaml
# optional — omit when cash unknown (never invent 0)
cash:
  - amount: 30515.65
    currency: SGD
    updated_at: "2026-08-08"
    channel: dbs
  - amount: 395633.73
    currency: USD
    updated_at: "2026-08-08"
    channel: dbs
  - amount: 10000.00
    currency: USD
    updated_at: "2026-08-08"
    channel: ibkr
```

| Field | Required | Notes |
|-------|----------|--------|
| `amount` | yes | ≥ 0, finite |
| `currency` | yes | 3–4 letter; no silent default |
| `updated_at` | yes | YYYY-MM-DD |
| `channel` | no | Omit/empty = unassigned; at most one unassigned **per currency** |

**Keys (critical — do not break deposits):**

`cashSlotKey(channel)` **stays channel-only**. It is already used for deposits (`clearDeposits`, `generateDepositId`) and channel filters. **Do not** change its arity or meaning.

```ts
/** Existing — channel identity only (deposits, channel filters). Unassigned → ''. */
cashSlotKey(channel) => normalized channel string

/** New — free-cash uniqueness. Unassigned USD → '@USD'. */
cashBalanceKey(channel, currency) =>
  `${cashSlotKey(channel)}@${currency.trim().toUpperCase()}`
```

**Uniqueness:** At most one free-cash entry per `cashBalanceKey`. Two entries same channel different currency = allowed. Two USD slots different channels = allowed.

**Legacy read:** Existing single-object or array cash with one row per channel still loads **byte-for-field** (see §7). Validation **rejects** two rows that collide on `(channel, currency)`. Old rule “reject duplicate channel regardless of currency” is **removed** (only after multi-ccy is intentional).

### 4.2 Fixed deposits (unchanged shape — zero migration)

`deposits[]` already has `channel` + `currency`. **No schema change. No amount rewrite. No id rewrite.**

**New behavior only:** maturity/unlock credits free cash at `(deposit.channel, deposit.currency)`, not “whatever free cash exists on that channel.”

### 4.3 Log events (append-only)

| `action` | Meaning |
|----------|---------|
| `cash_set` | Absolute set for one slot (existing; include `currency` always) |
| `cash_cleared` | Clear slot(s) (existing) |
| `cash_transferred` | Double-entry same-ccy move |
| `deposit_matured` | Principal unlocked to free cash (partial or full) |

Example:

```yaml
- ts: "2026-08-08"
  action: cash_transferred
  amount: 10000
  currency: USD
  from_channel: dbs
  to_channel: ibkr
- ts: "2026-08-08"
  action: deposit_matured
  deposit_id: fd-dbs-20260630
  amount: 10000
  currency: USD
  channel: dbs
  remaining_principal: 395633.73
```

---

## 5. Correct journal for the incident (target happy path)

User: *“I transferred USD 10,000 from DBS to IBKR”* (source = matured FD USD).

```text
1. mature_deposit(id=fd-dbs-20260630, amount=10000)
   FD principal: 405,633.73 → 395,633.73 USD
   free cash dbs@USD: 0 → 10,000
   free cash dbs@SGD: unchanged

2. transfer_cash(from_channel=dbs, to_channel=ibkr, amount=10000, currency=USD)
   free cash dbs@USD: 10,000 → 0
   free cash ibkr@USD: 0 → 10,000

Invariants:
  - free cash USD total unchanged by step 2
  - free cash USD + FD USD principal unchanged by step 1 (move locked → free)
  - SGD free cash never touched
  - household NAV unchanged (ignoring interest not yet booked)
```

If USD already sits as free cash at DBS (FD already unlocked earlier):

```text
transfer_cash(from_channel=dbs, to_channel=ibkr, amount=10000, currency=USD)
```

---

## 6. API / tools

### 6.1 Core state API (`src/state/portfolio-state.ts`)

| Function | Change |
|----------|--------|
| `cashSlotKey(channel)` | **Unchanged** — channel-only (deposits + channel filters) |
| `cashBalanceKey(channel, currency)` | **New** — free-cash slot identity |
| `findCashForSlot(cashes, channel, currency)` | Primary lookup for ledger debit/credit |
| `findCashesForChannel(cashes, channel)` | **New** — returns **all** free-cash slots on a channel (0..N). Replaces single-slot `findCashForChannel` for multi-ccy-safe reads |
| `findCashForChannel` | Keep temporarily for tests/call-site migration: if exactly one slot on channel → return it; if 0 → null; if ≥2 → **throw** (ambiguous — do not silently pick first). Prefer migrate callers to `findCashForSlot` / `findCashesForChannel` |
| `normalizeCashes` | Allow multi-ccy per channel; reject duplicate `cashBalanceKey`; **preserve field values** (see §7 invariants) |
| `setCash` | Upsert by `cashBalanceKey` only — **must not** drop other currencies on the same channel |
| `clearCash(state, channel?, currency?)` | (a) no args → clear all; (b) channel + currency → one slot; (c) channel only → all ccy on that channel (document in tool desc — intentional multi-slot clear) |
| `applyCashDelta(..., channel, currency)` | **Currency required** when `adjustCash && cashDelta !== 0`. Fail if debit slot missing. Never change a slot’s currency. Never apply delta to a different-ccy slot on the same channel |
| `transferCash(...)` | Atomic same-ccy debit+credit |
| `matureDeposit(...)` | Partial/full unlock into free cash same channel+currency |

### 6.2 Agent tools (`src/tools/portfolio.ts`)

| Tool | Behavior |
|------|----------|
| **`transfer_cash`** (new) | Same-currency move between channels. Params: `from_channel`, `to_channel`, `amount`, `currency`, channel user ids. Fail: amount ≤ 0, missing source, insufficient, same from/to. Creates dest slot if needed. One log `cash_transferred`. |
| **`mature_deposit`** (new) | Params: `id`, optional `amount` (default = full principal), `adjust_cash` default true. Reduce FD or remove if zero; credit free cash `(channel, currency)`. Fail if amount > principal. Log `deposit_matured`. Prefer this over raw `remove_deposit` when user says “matured / unlocked / withdrew from FD”. |
| **`set_cash`** | Description + behavior: absolute **per (channel, currency)**. Explicitly: *not for transfers — use transfer_cash*. Upsert preserves other ccy on same channel. |
| **`clear_cash`** | Add optional `currency`. If channel set and currency set → one slot. If channel set, currency omit → all currencies on that channel. |
| **`get_portfolio` / cash section** | Print every slot as `channel / currency: amount`. Group by channel optional. Flag matured FDs in deposits section (already has MATURED). |
| **`add_deposit` / `update_deposit` / `remove_deposit`** | Currency match against **slot for (channel, deposit.currency)**, not “any cash on channel”. `remove_deposit(adjust_cash=true)` full unlock remains; skill prefers `mature_deposit` for partial. |
| Holdings `adjust_cash` | Pass trade currency into `applyCashDelta` (equity cost ccy = holding/trade currency as used today; fail if cash slot ccy differs). |

### 6.3 Bookkeeper surface

- Register `transfer_cash` + `mature_deposit` on Bookkeeper tool set (via `createBookkeeperTools` / shared portfolio tools).
- Context prefix: list `channel/ccy=amount` for **all** free-cash slots; list matured deposits with “still locked — mature_deposit to unlock”.
- Purpose + `bookkeeping.md`: hard recipes (see §8).

### 6.4 Out of scope for v1 (follow-up)

| Item | Why later |
|------|-----------|
| `convert_cash` (FX both legs / rate) | Incident was same-ccy USD transfer; design only, implement after transfer+slots stable |
| Automatic reverse of bad historical journals | Money safety — human confirms balances |
| Broker API sync of multi-ccy cash | Separate broker-integration plans |
| Interest auto-credit on mature | v1 principal only (same as FD design) |

---

## 7. Data fix — lossless conversion of existing books

**Hard requirement:** upgrading code must not drop, merge, re-denominate, or invent free cash, deposits, holdings, or log history.

### 7.0 What “lossless” means

For every user YAML that loads today:

| Asset class | Conversion | Must preserve |
|-------------|------------|---------------|
| Free cash rows | 1 existing row → 1 slot keyed by `(channel, currency)` | `amount`, `currency` (normalized case only), `channel` (normalized empty→omit), `updated_at` |
| Missing `cash` | stays unknown | no invented `0` |
| `deposits[]` | **identity** — no rewrite | every field of every deposit |
| `portfolio` | **identity** | all lots |
| `log[]` | **identity** — append-only; old `cash_set` events stay as written | historical audit trail |
| Snapshots on disk | **identity** — historical JSON not rewritten | past `cashAmount` / `cashCurrency` as stored |
| Household (properties, liabilities, cash_flows, treasury, …) | **identity** | all fields |

**Allowed non-lossy normalizations (already true today via `assertCashBalance`):**

- `currency` trim + uppercase (`usd` → `USD`)
- empty `channel` → omit / unassigned key `''`
- storage shape object ↔ array only when **slot count** changes (1 slot may serialize as object; ≥2 as array) — **amounts unchanged**

**Forbidden (would be loss or invention):**

- Dropping a cash row because another row shares the same channel
- Merging SGD + USD into one amount
- Converting amounts with FX on load/save
- Auto-reducing FDs or auto-crediting free cash during migration
- Auto-reversing the IBKR one-leg incident
- Changing `cashSlotKey` to require currency (breaks deposits / clears)

### 7.1 Input shapes that must load without loss

These shapes exist (or existed) in the product; each needs a golden test.

| # | Shape | Example | After `getCashes` |
|---|--------|---------|-------------------|
| L0 | Missing / null | no `cash` key | `[]` (unknown) |
| L1 | Legacy single object, unassigned | `{ amount, currency, updated_at }` | one slot, channel unassigned |
| L2 | Legacy single object + channel | `{ …, channel: ibkr }` | one slot `ibkr@ccy` |
| L3 | Multi-channel array, one ccy each | `[{channel:a,USD}, {channel:b,USD}]` | two slots; both amounts intact |
| L4 | Multi-channel mixed ccy (already valid today if **different channels**) | `dbs/SGD` + `ibkr/USD` | both intact |
| L5 | **New** same-channel multi-ccy | `dbs/SGD` + `dbs/USD` | both intact (only possible after this change) |
| L6 | Corrupt: two rows same channel **and** same ccy | — | **throw** (was already throw for same channel; still fail-fast) |

**Today’s production constraint:** `normalizeCashes` rejects two free-cash rows with the same channel even if currencies differ. Therefore **no live YAML can already store same-channel multi-ccy free cash**. Conversion cannot “lose” a second ccy on a channel because it cannot exist yet. Maturity of USD FDs next to SGD free cash is the gap we are opening, not migrating.

### 7.2 Load path (automatic — no offline batch job)

On `normalizeCashes` / `getCashes` only:

1. Accept L0–L4 exactly as today (plus L5 after rule change).
2. Validate each row with existing `assertCashBalance` rules.
3. Build `cashBalanceKey(channel, currency)`; reject duplicates of that key only.
4. **Do not** rewrite YAML on read. First **write** after upgrade may re-serialize (object vs array) but must pass round-trip equality of the logical slot multiset.

**No offline YAML rewrite required** for well-formed books.

### 7.3 Round-trip invariants (must be tested)

Define equality of free cash books as multiset of:

```ts
{ channel: cashSlotKey(c.channel), currency: c.currency.toUpperCase(), amount: c.amount, updated_at: c.updated_at }
```

Invariants:

1. **Load stability:** `getCashes(load(yaml))` twice → deep equal.  
2. **Write stability:** `setCashes(state, getCashes(state)); save; reload` → free-cash multiset equal (amounts, channels, currencies, updated_at).  
3. **Upsert isolation:** given L3/L4 books, `setCash` on channel A currency X must not change amount of any other `cashBalanceKey`.  
4. **Deposit isolation:** load + save deposits without calling deposit mutators → deposits deep equal.  
5. **No FX on migration path:** `normalizeCashes` never reads `fxRates` or `reporting_currency`.

### 7.4 Persist shape compatibility

`setCashes` already:

- `length === 0` → delete `cash`
- `length === 1` → single object (legacy-friendly)
- `length ≥ 2` → array

Keep this. After multi-ccy, `dbs/SGD` + `dbs/USD` → array of 2. Readers that only accept arrays when multi-channel already go through `normalizeCashes` / `getCashes` — dashboard `normalizeDashboardCashes` already accepts array and **sums by channel filter without requiring unique channel** (mixed ccy still needs FX for a single total — same as today for multi-channel mixed ccy).

### 7.5 Call-site behavior that must not silently lose money after upgrade

These are **not** YAML conversion, but post-upgrade journal paths that could corrupt books if left channel-only:

| Call site | Risk if left as channel-only | Required fix |
|-----------|------------------------------|--------------|
| `setCash` filter by channel only | Writing `dbs/USD` **deletes** `dbs/SGD` | Filter by `cashBalanceKey` |
| `applyCashDelta` find by channel only | Debit hits wrong ccy or single-slot fallback wrong | Require `currency`; match slot |
| `remove_deposit(adjust_cash=true)` | Credits USD principal onto SGD slot amount (keeps SGD label) — **silent re-denomination** | Credit `(deposit.channel, deposit.currency)` only; fail if would mix |
| `findCashForChannel` returns first of many | Agent debits SGD when user meant USD | Ambiguous → throw; use `findCashForSlot` |
| `clear_cash` channel only | Clears **all** ccy on channel | OK if documented; optional `currency` for one slot |
| Holdings `adjust_cash` | Debit wrong sleeve | Pass trade/holding currency into delta |
| Snapshot `cashChannel` | Already omits channel when multi-slot total | Unchanged; multi-ccy total still needs reporting FX (existing rule) |

**Historical snapshots:** leave on disk. New snapshots continue to store aggregated cash when convertible; multi-ccy without FX already fails/resilient-excludes free cash on dashboard — no migration of old snapshot files.

### 7.6 Incident correction (manual — must not create a second loss)

**Do not** run `mature_deposit` if free cash was already inflated by a one-leg `set_cash` — that would **add free cash again** while FD shrinks (still wrong NAV composition).

| Real-world truth | Books today (example) | Safe repair (after multi-slot code) |
|------------------|----------------------|-------------------------------------|
| Money left FD and sits at IBKR | FD full + IBKR +10k phantom (double count) | `update_deposit(id, amount=principal−10000, adjust_cash=false)` only; leave IBKR as-is **or** set all sleeves from screenshots |
| Money never left / books wrong | IBKR +10k but bank has no IBKR cash | `set_cash(ibkr, USD, true_amount)` (maybe 0 / clear) |
| User provides full screenshots | Any mess | **Preferred:** absolute `set_cash` per `(channel, ccy)` + `update_deposit(..., adjust_cash=false)` to match bank FD principal |

```text
# SAFE default — absolute truth from UI (no double-entry invention):
set_cash(channel=ibkr, currency=USD, amount=<true IBKR free cash>)
set_cash(channel=dbs,  currency=SGD, amount=<true DBS SGD free>)
set_cash(channel=dbs,  currency=USD, amount=<true DBS USD free>)   # 0 ok if none
update_deposit(id=fd-..., amount=<true remaining FD principal>, adjust_cash=false)
```

**Rule:** Prefer absolute balances from bank/broker UI. Never combine `mature_deposit` with an already-credited destination for the same physical movement.

### 7.7 Pre-deploy / post-deploy audit (required, not optional)

**Before** shipping mutators to production data:

1. Enumerate every `data/users/*.yaml` (local + production data root, e.g. lextok03 invage data).  
2. For each user, print cash multiset and deposit multiset.  
3. Run **read-only** `getCashes` / `getDeposits` under new code in a dry-run test — assert field equality vs raw YAML parse for cash amounts.  
4. Flag (do not auto-fix): matured FDs; channels where free cash ccy ≠ deposit ccy; recent `cash_set` on a new channel with no matching debit in log.

**After** first production write path is live: sample round-trip save on a **copy** of one multi-channel user file in CI fixture (never mutate prod in tests).

### 7.8 Migration non-goals

| Non-goal | Why |
|----------|-----|
| Batch rewrite of all user YAML on disk | Unnecessary; load path is enough; rewrite risk |
| Fixing the IBKR double-count automatically | Requires knowing real-world truth |
| Migrating snapshot JSON to multi-slot cash | Historical point-in-time; leave as-is |
| Renaming channels (`dbs` → `dbs_usd`) | Rejected model; multi-slot replaces this |

---

## 8. Bookkeeper UX — easy + accurate

### 8.1 Hard recipes (`src/skills/knowledge/bookkeeping.md`)

```markdown
## Cash movements (HARD — use tools that enforce double-entry)

| User said | Tools (in order) | Forbidden |
|-----------|------------------|-----------|
| Transfer same ccy A→B | `transfer_cash` only | Destination-only `set_cash` |
| Withdrew / matured FD into free cash | `mature_deposit` (partial or full) | Credit free cash without reducing FD |
| Matured FD then wired to another broker | `mature_deposit` then `transfer_cash` | Credit broker only |
| Screenshot / full balance | `set_cash` absolute for that (channel, currency) | Using set_cash for “I moved X” |
| FX convert | Ask both settlement amounts (v1); later `convert_cash` | Invent rate |

Rules:
1. Free cash is multi-currency per channel: always name **channel + currency**.
2. Never debit SGD because “dbs only shows SGD on books” — check deposits and other ccy slots.
3. Matured FD principal is **not** free cash until `mature_deposit`.
4. After writes, summarize every affected slot from tool output (not memory).
```

### 8.2 Purpose bullet (Bookkeeper)

Add to `BOOKKEEPER_PURPOSE`:

- Cash moves between banks/brokers → **`transfer_cash`** (same currency).
- Unlock term deposits → **`mature_deposit`**.
- Never destination-only free cash for a transfer.

### 8.3 Context prefix

```
Cash slots: dbs/SGD=30515.65, dbs/USD=0 (none), ibkr/USD=10000.
Deposits: fd-dbs-… 405633.73 USD channel=dbs MATURED (locked until mature_deposit).
```

### 8.4 Reconcile gaps (household or portfolio)

Extend gaps list (prefer `householdGaps` or a small `cashBooksGaps` used by `get_household` / `get_portfolio`):

| Gap id | Condition | Message |
|--------|-----------|---------|
| `matured_deposit_locked` | `end_date < today` and principal > 0 | FD id still locked; unlock with mature_deposit if funds are free |
| `multi_ccy_channel` | (info, not error) channel has ≥2 free-cash ccy | Listed for clarity |
| (optional soft) | N/A in v1 for one-leg detection | Future: log analysis |

---

## 9. Touch map (files)

| Area | Files |
|------|--------|
| State | `src/state/portfolio-state.ts` |
| Tools | `src/tools/portfolio.ts`, `src/tools/index.ts` (if tool lists explicit) |
| Household cash debit | `src/tools/household.ts` (`record_property_payment` cash_channel — match ccy) |
| Bookkeeper | `src/agents/bookkeeper.ts`, `src/skills/knowledge/bookkeeping.md` |
| Invester skill | `src/skills/knowledge/investment-analysis.md` (cash section: multi-ccy slots, transfer_cash) |
| Dashboard | `src/report/dashboard-model.ts`, `src/webapp/dashboard-data.ts`, WebUI if cash table assumes 1:1 channel |
| Docs | `docs/data-model.md` cash section |
| Tests | `tests/portfolio-state.test.ts`, new `tests/transfer-cash.test.ts` / mature tests, tool tests, `tests/bookkeeper-agent.test.ts` (tool names) |
| Payment plan | `src/treasury/payment-plan.ts` — already per-cash currency; may need multi slots per channel |

---

## 10. Implementation tasks (TDD)

### Task 1: Lossless load + free-cash key = `(channel, currency)`

**Files:**
- Modify: `src/state/portfolio-state.ts`
- Test: `tests/portfolio-state.test.ts` (add dedicated describe `lossless cash migration`)

**Step 1: Failing tests — migration fixtures (L0–L4) + multi-ccy**

```ts
describe('lossless cash migration', () => {
  it('L0 missing cash stays empty', () => {
    expect(normalizeCashes(null)).toEqual([]);
  });

  it('L1–L4 preserve amount/currency/channel/updated_at', () => {
    const legacyObject = {
      amount: 30515.65,
      currency: 'SGD',
      updated_at: '2026-07-30',
      channel: 'dbs',
    };
    const [only] = normalizeCashes(legacyObject);
    expect(only.amount).toBe(30515.65);
    expect(only.currency).toBe('SGD');
    expect(only.channel).toBe('dbs');
    expect(only.updated_at).toBe('2026-07-30');

    const multi = normalizeCashes([
      { amount: 12448.47, currency: 'USD', updated_at: '2026-07-29', channel: 'jude_futu' },
      { amount: 38758.91, currency: 'USD', updated_at: '2026-07-29', channel: 'cmbyonglong' },
    ]);
    expect(multi.map((c) => c.amount).sort()).toEqual([12448.47, 38758.91]);
  });

  it('allows two free-cash currencies on the same channel', () => {
    const cashes = normalizeCashes([
      { amount: 100, currency: 'SGD', updated_at: '2026-08-08', channel: 'dbs' },
      { amount: 200, currency: 'USD', updated_at: '2026-08-08', channel: 'dbs' },
    ]);
    expect(cashes).toHaveLength(2);
  });

  it('rejects duplicate channel+currency only', () => {
    expect(() =>
      normalizeCashes([
        { amount: 1, currency: 'USD', updated_at: '2026-08-08', channel: 'dbs' },
        { amount: 2, currency: 'USD', updated_at: '2026-08-08', channel: 'dbs' },
      ]),
    ).toThrow(/Duplicate cash/);
  });

  it('setCash upserts by channel+currency and never drops sibling ccy', () => {
    // state with dbs SGD + dbs USD; setCash dbs USD → SGD amount unchanged
  });

  it('setCashes round-trip preserves multiset', () => {
    // setCashes → getCashes → equal amounts/channels/currencies/updated_at
  });

  it('cashSlotKey remains channel-only (deposits compatibility)', () => {
    expect(cashSlotKey('dbs')).toBe('dbs');
    expect(cashSlotKey('')).toBe('');
    // cashBalanceKey is the free-cash identity
    expect(cashBalanceKey('dbs', 'usd')).toBe('dbs@USD');
  });
});
```

**Step 2: Implement** `cashBalanceKey`, update `normalizeCashes` uniqueness, `setCash` / `clearCash` to use balance key; **leave `cashSlotKey(channel)` signature unchanged**.

**Step 3: Fix free-cash call sites** that upsert/filter by channel only (`setCash`, `clearCash` with currency, `findCashForChannel` ambiguity). **Do not** change deposit uses of `cashSlotKey`.

**Step 4:** `npx vitest run tests/portfolio-state.test.ts` — pass, including existing multi-channel tests.

**Step 5:** Commit `feat(cash): multi-ccy free-cash slots with lossless legacy load`.

---

### Task 2: Currency-aware `applyCashDelta` (no silent re-denomination)

**Files:**
- Modify: `src/state/portfolio-state.ts`
- Test: `tests/portfolio-state.test.ts`

**Behavior:**

- Signature includes `currency: string` (required when `adjustCash && cashDelta !== 0`).
- Locate slot by `cashBalanceKey(channel, currency)`.
- Missing slot on **debit** → throw listing available slots as `channel/ccy`.
- Never mutate a slot’s currency field; never apply a USD delta onto an SGD amount.
- **Credit path** (transfer/mature): may create missing slot with that currency.
- Remove the unsafe “`cashes.length === 1` ignore channel” fallback when currency is provided and does not match — fail fast instead of debiting the only sleeve of another ccy.

**Regression test (existing footgun):**  
`dbs` free cash SGD only + `remove_deposit` USD with `adjust_cash=true` must **not** add USD principal into the SGD amount; must credit/create `dbs/USD` or fail clearly.

**Commit:** `fix(cash): applyCashDelta matches channel+currency`.

---

### Task 3: `transferCash` state helper + tool

**Files:**
- Modify: `src/state/portfolio-state.ts`, `src/tools/portfolio.ts`
- Test: `tests/portfolio-state.test.ts`, tool test or portfolio tool suite

**State helper:**

```ts
export function transferCash(
  state: InvestorState,
  args: {
    fromChannel?: string;
    toChannel?: string;
    amount: number;
    currency: string;
    updatedAt: string; // YYYY-MM-DD
  },
): { from: CashBalance; to: CashBalance; cashes: CashBalance[] }
```

Rules:

- `amount > 0`, finite  
- `from` and `to` channel keys must differ (normalized)  
- Debit source (fail insufficient / missing)  
- Credit dest (create if needed)  
- Same currency both legs  
- Return updated cashes; caller saves + logs  

**Tool** `transfer_cash`: channel user ids + params; `saveState`; log `cash_transferred`.

**Tests:**

- dbs/USD 10k → ibkr: balances correct; SGD untouched  
- insufficient → throw  
- same channel from/to → throw  
- conservation: sum of currency across slots unchanged  

**Commit:** `feat(cash): atomic transfer_cash double-entry`.

---

### Task 4: `matureDeposit` state helper + tool

**Files:**
- Modify: `src/state/portfolio-state.ts`, `src/tools/portfolio.ts`
- Test: `tests/portfolio-state.test.ts`

**Behavior:**

- Find deposit by id  
- `unlock = amount ?? deposit.amount`; `0 < unlock ≤ deposit.amount`  
- If unlock = full → remove deposit; else reduce `amount` (interest: leave as-is in v1 or proportional — **leave interest unchanged** unless full remove; document)  
- If `adjustCash`: credit free cash `(deposit.channel, deposit.currency)` by `unlock`  
- Log `deposit_matured`  

**Tests:** partial unlock; full unlock; unlock > principal throws; credits correct ccy slot without touching other ccy.

**Also fix** `remove_deposit` / `add_deposit` currency checks to use `(channel, currency)` slots.

**Commit:** `feat(deposits): mature_deposit unlocks principal to free cash`.

---

### Task 5: Wire tools into Bookkeeper + harden descriptions

**Files:**
- Modify: `src/tools/portfolio.ts` (export tools in factory list)
- Modify: `src/tools/index.ts` if needed
- Modify: `src/agents/bookkeeper.ts` (purpose + context prefix)
- Modify: `src/skills/knowledge/bookkeeping.md`
- Modify: `src/skills/knowledge/investment-analysis.md` (cash movement table)
- Test: `tests/bookkeeper-agent.test.ts` — expect `transfer_cash`, `mature_deposit`

**Context prefix change:** map all cashes to `channel/ccy=amount`; matured deposits one-line flag.

**Commit:** `docs(bookkeeper): multi-ccy cash recipes and tools`.

---

### Task 6: Dashboard / get_portfolio display

**Files:**
- Modify: `src/tools/portfolio.ts` `formatCashSection`
- Modify: `src/report/dashboard-model.ts`, `src/webapp/dashboard-data.ts` if channel view assumed one cash row
- Test: dashboard tests if any cash aggregation assumes 1 cash per channel

**Display:**

```
── CASH ──
  dbs / SGD: 30,515.65 (updated …)
  dbs / USD: 10,000.00 (updated …)
  ibkr / USD: 0.00 …
  Total (reporting …): … when FX available
```

Channel filter on dashboard: sum/filter all cash rows for that channel (multi-ccy → show each line; merged total still needs FX).

**Commit:** `fix(ui): show multi-currency cash per channel`.

---

### Task 7: Household / property payment / payment-plan call sites

**Files:**
- Modify: `src/tools/household.ts` — `cash_channel` debit must use property currency as slot currency  
- Modify: `src/treasury/payment-plan.ts` if it assumes one cash per channel  
- Tests: existing household/payment-plan tests green  

**Commit:** `fix(household): cash debit by channel+currency`.

---

### Task 8: Docs + data-model

**Files:**
- Modify: `docs/data-model.md` (cash multi-channel section → multi-slot channel+currency)
- This plan remains source of truth for tools

**Commit:** `docs: multi-currency free cash slots`.

---

### Task 9: Incident repair runbook + production audit harness

**Files:**
- Modify: `src/skills/knowledge/bookkeeping.md` — “Repair one-leg transfer” using **absolute screenshots only** (§7.6); forbid mature_deposit on top of phantom free cash
- Create: `tests/cash-books-migration-fixtures.test.ts` (or extend portfolio-state) with YAML string fixtures for L0–L4 round-trip
- Optional ops: read-only audit script listing matured FDs vs free-cash ccy per channel (print only)

**No automatic mutation of production YAML.**

**Commit:** `test(cash): lossless migration fixtures; docs repair runbook`.

---

### Task 10: Full regression

```bash
npx vitest run
```

Confirm: `cashSlotKey` still channel-only; deposits tests green; no test assumes “one cash per channel” for uniqueness of free cash.

---

## 11. Test matrix (acceptance)

| # | Scenario | Expected |
|---|----------|----------|
| M1 | Legacy L0–L4 load | Every amount/channel/currency/updated_at preserved |
| M2 | Round-trip setCashes/getCashes | Multiset equal; no invented rows |
| M3 | Deposit array untouched by cash code change | Deep equal after cash-only setCash |
| T1 | `dbs` SGD + `dbs` USD coexist | Both slots persist |
| T2 | `set_cash` USD on dbs does not wipe SGD | SGD unchanged |
| T3 | `transfer_cash` dbs→ibkr USD | Debit+credit; SGD untouched; log event |
| T4 | `transfer_cash` insufficient | Fail fast, no partial write |
| T5 | Destination-only narrative | Tooling cannot express as transfer; skill forbids set_cash for moves |
| T6 | Partial `mature_deposit` 10k USD | FD −10k; dbs/USD +10k |
| T7 | Then `transfer_cash` to ibkr | FD reduced; free cash moved; NAV conserved |
| T8 | Trade debit on ibkr USD with only ibkr missing USD | Fail with clear slots list |
| T9 | Deposit remove full with adjust_cash, multi-ccy channel | Credits matching ccy only; never re-denominate into SGD sleeve |
| T10 | Bookkeeper tool list includes transfer + mature | Test asserts names |
| T11 | Mixed-ccy total without FX | Still throws (existing totalCash rule) |
| T12 | Dashboard channel `dbs` | Shows both SGD and USD lines |
| T13 | `cashSlotKey('dbs')` still `'dbs'` | Deposits clear/id generation unchanged |

---

## 12. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| **Lossy migration** (drop sibling ccy, rewrite deposits) | §7 invariants + golden L0–L4 tests; `cashSlotKey` unchanged; no batch YAML rewrite |
| **Silent re-denomination** on deposit remove | Task 2: delta always currency-matched |
| Breaking `applyCashDelta` / `findCashForChannel` call sites | Grep-driven update; ambiguous multi-slot → throw |
| Dashboard assumes one cash total per channel without FX | Already mixed-ccy aware; show per-line; total needs reporting FX |
| Agents keep using `set_cash` for transfers | Tool descriptions + skill + purpose; hard double-entry tool is the easy path |
| Partial mature + interest | v1 leave interest on remaining FD; full remove drops interest with deposit |
| User data already double-counted (incident) | Absolute screenshot repair only; never mature_deposit on top of phantom credit |
| Local `data/users` empty of cash | Audit **production** data root before deploy (§7.7) |
| Payment plan multi cash same channel | Treat each cash row independently by currency |

---

## 13. Success criteria

1. **Lossless upgrade:** every existing free-cash row and every deposit survives load/round-trip with the same amounts and currencies (M1–M3, T13).  
2. User can record **DBS SGD free cash and DBS USD free cash** simultaneously.  
3. “Transfer USD 10k DBS → IBKR” is **one** `transfer_cash` (after unlock if needed) with **impossible** destination-only success via the transfer tool.  
4. Matured FD unlock is explicit and currency-safe (no SGD re-denomination).  
5. Bookkeeper context shows every slot and matured locks without guessing.  
6. All existing tests green; new tests cover M* + T1–T13.  
7. No silent FX on the journal or migration path.  
8. Production audit is read-only unless a human applies absolute screenshot repair.

---

## 14. Execution order (summary)

```
Task 1  lossless load + cashBalanceKey + set/clear/normalize (cashSlotKey unchanged)
Task 2  applyCashDelta currency (kill re-denomination)
Task 3  transfer_cash
Task 4  mature_deposit + deposit ledger fix
Task 5  Bookkeeper skill/purpose/context
Task 6  display / dashboard
Task 7  household + payment-plan call sites
Task 8  data-model docs
Task 9  repair runbook + migration fixtures + read-only audit
Task 10 full vitest
```

Do not ship Task 5-only (prompts without Tasks 1–4): that recreates the incident class.  
Do not ship mutators before M1–M3 lossless tests pass.

---

## 15. Related docs

- `docs/data-model.md` — cash / deposits / multi-channel  
- `docs/plans/2026-07-29-fixed-deposits-design.md` — FD NAV vs free cash  
- `docs/plans/2026-07-29-family-treasury-accountant-design.md` — household books  
- `src/skills/knowledge/bookkeeping.md` — agent recipes  
- `src/state/portfolio-state.ts` — source of truth for cash helpers  

---

## 16. Open points (resolve during implementation if needed)

1. **Canonical balance key form:** `dbs@USD` via `cashBalanceKey` (channel key remains separate). Prefer comparing structured `(channel, currency)` in code; string key only for Set/Map.  
2. **Unassigned multi-ccy:** allow `@SGD` and `@USD` both unassigned? **Yes** (unique per currency).  
3. **`convert_cash` schedule:** separate plan after this ships.  
4. **Interest on partial mature:** leave full-term interest field as-is (display only); do not invent pro-rata.  
5. **Production data root:** local `data/users/jude.yaml` may be empty of cash; run §7.7 audit against the **deployed** invage data root before relying on “no multi-ccy collisions in prod.”  
6. **`findCashForChannel` migration window:** throw-on-ambiguous is safer than return-first; update all call sites in the same PR as Task 1–2 so nothing depends on “first sleeve wins.”  
