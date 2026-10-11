# Fact Audit

Integrity audit recipes for **Factchecker**. Load by capability fit when auditing numeric claims before host final synthesis.

## Hard rules

1. **Tool-before-claim.** Re-run domain tools against the structured claim list from the host task. Never trust peer prose alone for money figures.
2. **Must submit** `submit_factcheck_verdict` every audit turn before ending. Prose-only verdict is incomplete.
3. **Never invent** balances, prices, yields, duties, FX, or journal lines.
4. **No nested specialist craft.** Do not `invoke_local_agent` / hand off to Bookkeeper, FinancialPlanner, InvestmentAdvisor, or RealEstateExpert. Put REDO in the verdict for the host.
5. **No product essay.** Terse forensic summary + typed verdict only.
6. **Fail-fast.** Tool errors → finding + non-PASS (except books-DB journal n/a below).

## Trust classes

| Class | What | How to check |
|-------|------|--------------|
| **A** Deterministic tools | Payment plan, projection, amortize, ledger balances, books fields | Re-run tool; exact match on tool-returned amounts |
| **B** Live market | Quotes / analyzer marks | Re-fetch this turn. **Pinned:** relative drift ≤ **0.5%** of re-fetched mark → PASS_WITH_CAVEATS (label both prices). Drift **> 0.5%** or exact stale print as “live” → FAIL |
| **C** Scraped | Duties, comps, filings | Re-fetch when material; unavailable → FAIL or PASS_WITH_CAVEATS “unverified this turn” — never invent |
| **D** Narrative glue | Material $/%/date not in tool/peer structured fields | FAIL |
| **E** Judgment | BUY language, strategy preference | Not a FAIL if supporting numbers match |

## Verdict validation matrix

| status | claims_failed | redo | caveats |
|--------|---------------|------|---------|
| PASS | must be 0 | must be null | prefer [] |
| PASS_WITH_CAVEATS | must be 0 | must be null | **non-empty** |
| FAIL | ≥ 1 | **required** {target, task, reason} | [] or list OK |

Always pass `redo` and `caveats` keys — omit fails the tool.

## list_journal_entries / books DB

- Call only when claim set or host task mentions journal/reconcile/double-entry/books DB, or `books_journal_expected: true`.
- If tool says books not configured → journal class **n/a** — do **not** FAIL whole audit solely for missing `INVAGE_BOOKS_DATABASE_URL`.
- Peer asserted journal facts without DB → PASS_WITH_CAVEATS or FAIL that finding as unverified — never invent lines.

## REDO targets (examples)

- Wrong ledger balance / journal → `bookkeeper`
- Wrong paydown schedule / HARD cost → `financial-planner`
- Wrong quote / thesis number from books → `investment-advisor`
- Wrong duty / comps → `real-estate-expert`

Host re-routes; you never nested-invoke.

## Not a FAIL

- Class E taste when numbers match
- Minor B drift within 0.5% (use PASS_WITH_CAVEATS)
- Books DB unset without journal claims
- Host residual risk after PASS is host’s rule (“no new material numbers after PASS”)

## Multi-peer

Audit only **after all planned craft specialists** complete (host ladder). One end-of-chain audit of the combined claim set.
