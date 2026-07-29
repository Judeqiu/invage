# Dashboard live FX conversion (design)

**Date:** 2026-07-29  
**Status:** agreed  
**Scope:** Portfolio Dashboard (WebUI + HTML report model) multi-currency aggregation into one reporting currency using **current** market FX.

---

## Problem

Dashboard NAV is `positionsValue + free cash + deposit principal`. Cash and deposits already carry a currency, but aggregation is **same-currency only**:

- Mixed cash currencies → throw (`Cannot sum dashboard cash across currencies…`)
- Mixed deposit currencies → throw
- Equity/fund/option marks are raw numbers with **no currency** on the live model, so multi-market books can be summed incorrectly without failing

Users with multi-broker, multi-currency books (e.g. USD equities + HKD cash + SGD deposits) need a single NAV in one currency.

---

## Decisions

| Decision | Choice |
|----------|--------|
| Display / aggregate currency | `treasury.reporting_currency` (household treasury) |
| FX source | Live Yahoo pairs `{FROM}{TO}=X` on each dashboard load |
| When conversion runs | Only when **2+ currencies** appear in the live slice |
| Single-currency books | Unchanged: no treasury required, no FX fetch |
| Stored `projection_assumptions.fx` | **Not** used for dashboard (projections stay explicit/manual) |
| Cache | None |
| Snapshot history | **Not** re-converted in v1 (stored totals remain as recorded) |
| UI currency picker | Out of scope for v1 |

Fail-fast / no silent defaults: missing reporting currency, missing FX pair, non-positive rate, or missing position quote currency when conversion is required → throw with a clear message.

---

## When conversion kicks in

| Situation | Behavior |
|-----------|----------|
| All cash, deposits, and position marks share **one** currency | Sum in that currency. No `reporting_currency` required. |
| **2+ currencies** in the live slice | Require `treasury.reporting_currency`. Fetch live FX. Convert every component into reporting ccy before summing. |
| Multi-ccy but `reporting_currency` unset | Fail: set via `set_treasury`. |
| Needed FX pair missing / invalid | Fail naming the pair (e.g. `HKD→USD`). |
| Source ccy === reporting | Passthrough (rate = 1, no network for that pair). |

### In scope (v1)

- Free cash (multi-channel, multi-ccy)
- Fixed-deposit principals (aggregated interest in reporting ccy when summed for display)
- Equity / fund / option **marks** once quote currency is known
- Merged + per-channel totals on the dashboard model
- WebUI labels + FX footnote when conversion applied

### Out of scope (v1)

- Snapshot / history series re-denominated in reporting ccy
- Replacing household projection FX map
- User-selectable display currency on the Dashboard
- Client-side FX fetch (conversion happens server-side in `loadDashboardForSlug`)

---

## Live FX module

**File:** `src/market/fetch-fx.ts`  
**Export** from `src/market/index.ts`.

### Yahoo convention

Symbol `{FROM}{TO}=X` = units of **TO** per 1 unit of **FROM**.

Example: `USDSGD=X` ≈ 1.35 → `amount_SGD = amount_USD * rate`.

### API

```ts
/** Units of `toCurrency` per 1 unit of each `from` currency. Same-ccy → 1 (no network). */
export async function fetchFxRates(
  fromCurrencies: string[],
  toCurrency: string,
): Promise<Record<string, number>>;
```

- Normalize codes to uppercase 3–4 letter codes; reject invalid.
- Deduplicate `from` list; skip network when `from === to`.
- Use existing `yf.quote` / price snapshot path; take a positive finite price as the rate.
- Fail-fast if quote missing or rate ≤ 0 / non-finite.

### Conversion helper

```ts
export function toReportingLive(
  amount: number,
  currency: string,
  reportingCurrency: string,
  rates: Record<string, number>,
  context: string,
): number;
```

Semantics match treasury `toReporting` (units of reporting per 1 foreign), but rates come from live fetch, not `projection_assumptions.fx`.

---

## Position currency plumbing

Today `resolvePortfolioMarket` returns only `equityPrices: Record<string, number>`. Yahoo snapshots already include `currency`.

**Change:**

1. Extend resolution to also return `equityCurrencies: Record<string, string>` (keyed like prices: bare equity/fund Yahoo symbol).
2. When building live positions, set `LivePosition.currency` from:
   - Yahoo quote currency for equities / yahoo funds
   - Fail-fast when conversion is required and currency cannot be determined
3. Options: use underlying quote currency when available; if conversion required and currency unknown → fail naming the option key (no silent USD default).

Manual fund marks without a currency source: fail when multi-ccy conversion is active.

---

## Dashboard model

### New / extended fields on `LiveDashboardSlice` (and channel totals as needed)

| Field | Meaning |
|-------|---------|
| `reportingCurrency` | Currency of aggregated totals when conversion applied; otherwise the single book currency (or null only if empty slice) |
| `fxRates` | Map applied (foreign → reporting); empty / omit when no conversion |
| `fxApplied` | `true` when live conversion ran |
| `cashCurrency` / `depositsCurrency` | Reporting ccy when converted; native single ccy otherwise |

Row-level cash/deposits keep **native** `amount` + `currency`. Aggregates (`cashAmount`, `depositsAmount`, `totalValue`, position `value`/`cost` used in NAV) are in reporting ccy when `fxApplied`.

**Position economics under FX:** convert cost, value, P/L with the same rate so weights and P/L % stay coherent within the reporting frame. Native quote price can remain on the row for display; document that `price` stays in quote currency while `value`/`cost` are reporting when converted — **or** convert consistently and expose `quoteCurrency` + `price` in quote ccy. Prefer:

- `currency` = quote / native ccy for the line
- `value`, `cost`, `pl` = reporting ccy when `fxApplied`
- rates visible on the slice for audit

### `buildLivePositions` options

```ts
{
  reportingCurrency?: string;
  fxRates?: Record<string, number>;
  positionCurrencies?: Record<string, string>; // portfolio key → ccy
}
```

Logic:

1. Resolve each position / cash / deposit currency.
2. Collect unique currencies.
3. If size ≤ 1: existing same-currency path (still fail if cash subset mixed without rates — same as today unless rates provided).
4. If size > 1:
   - require `reportingCurrency` and complete `fxRates` for every foreign ccy
   - convert before all sums (merged + per-channel)

### `filterLiveByChannel`

Uses already-converted aggregates from `byChannel` / positions; no second FX pass.

---

## Orchestration (`loadDashboardForSlug`)

1. Load portfolio, cash, deposits, treasury (`getTreasury`).
2. `resolvePortfolioMarket` → prices + currencies + option marks.
3. Collect currencies from positions, cash, deposits.
4. If multi-currency:
   - if no `treasury.reporting_currency` → throw
   - `fxRates = await fetchFxRates(foreignList, reporting)`
5. `buildLivePositions(..., { reportingCurrency, fxRates, positionCurrencies })`.
6. Payload may expose `reportingCurrency` / `fxApplied` at top level for the WebUI (or only via `model.live`).

HTML `save_report kind=dashboard` uses the same model; if the agent path builds the model without going through `loadDashboardForSlug`, it must pass FX the same way or only work for single-ccy.

---

## WebUI

- Format aggregated money with reporting currency code when `fxApplied` (avoid implying raw `$` for non-USD).
- Footnote when conversion applied, e.g.  
  `Totals in USD · live FX: HKD 0.128, SGD 0.741`
- Per-row deposits/cash can keep native amounts + ccy; optional small reporting note is nice-to-have, not required for v1.
- Channel filter continues to use server-built numbers (already reporting-denominated when converted).

---

## Errors

| Case | Behavior |
|------|----------|
| Multi-ccy + no treasury | Throw: requires `treasury.reporting_currency`; list found currencies |
| FX quote missing | Throw: missing live FX for `FROM→TO` (Yahoo symbol) |
| Invalid rate | Throw: invalid rate value |
| Position missing currency under multi-ccy | Throw: naming the holding key |
| Single-ccy mixed cash without FX (legacy path) | Keep today’s fail (or unify: if rates provided, convert) |

---

## Tests

| Area | Cases |
|------|--------|
| `fetch-fx` | same-ccy → `{ USD: 1 }` no network; mock multi pair rates; missing quote throws |
| `toReportingLive` | passthrough; multiply by rate; missing rate throws |
| `dashboard-model` | multi-cash HKD+USD with rates → reporting total; multi-deposit; multi-position currencies; fail multi without rates; single-ccy unchanged |
| `dashboard-data` | treasury + mocked FX; multi-cash without treasury throws |
| WebUI / payload shape | `fxApplied`, `reportingCurrency`, `fxRates` present when converted |

---

## Implementation touchpoints

1. `src/market/fetch-fx.ts` (new) + `src/market/index.ts`
2. `src/market/resolve-portfolio.ts` (+ price path) — equity currencies map
3. `src/report/dashboard-model.ts` — convert + model fields
4. `src/webapp/dashboard-data.ts` — treasury + live FX orchestration
5. `webui/dashboard/app.js` — reporting labels + FX footnote
6. Tests: `tests/fetch-fx.test.ts`, extend `tests/dashboard.test.ts`, `tests/dashboard-webui.test.ts`
7. Optional: short note in `docs/data-model.md` / family-treasury skill that dashboard live FX ≠ projection assumptions FX

---

## Non-goals / consistency with existing policy

- **Ledger rules** (buy/sell/deposit cash delta on a channel) still require matching currency on that channel — no silent FX on debit/credit.
- **Multi-currency cash storage is allowed** across channels; aggregated totals use live FX into `treasury.reporting_currency` (`set_cash`, `get_portfolio`, analyzer, snapshot, dashboard).
- Household **projections** still use **explicit** `projection_assumptions.fx` (not live Yahoo) for the 5-year engine; free cash is converted **per line**.
- No invented rates when Yahoo is down.

---

## Success criteria

1. User with USD stocks + HKD cash + SGD deposit, `treasury.reporting_currency: USD`, sees one USD NAV on Dashboard using live FX.
2. Same book without treasury fails with an actionable error.
3. All-USD book behaves exactly as today (no treasury, no FX call).
4. Missing Yahoo FX pair fails loudly; never silently treats 1:1.
