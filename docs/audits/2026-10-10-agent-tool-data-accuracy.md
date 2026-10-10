# Agent tool data-accuracy audit — 2026-10-10

## Scope and method

Audited `main` following explicit branch selection. Inventoried all 74 unique tools returned by the eight domain tool factories in `src/tools/index.ts`, plus the authenticated BinDrive and raw-data wrappers (six tools). Also inspected the currently unregistered `send_report` implementation. Reviewed model-visible content as well as structured details, authenticated identity binding, broker/account scope, dates, units, FX, missing-value handling, and external source labels. Inspected implementations and exercised automated tests against disposable PostgreSQL databases. This is an implementation audit, not a certification that every external source is current or complete. No production book mutations, emails, pushes, or deployments were performed for this audit.

The role table below is generated from actual factory return values, rather than tool names guessed from source filenames. Overlapping role tools count once in the 74-tool total.

## Repairs

| Area | Accuracy issue | Result |
| --- | --- | --- |
| Quotes | Previous-close fallback labeled LIVE; price rounded before valuation; missing currency defaulted to USD; failed portfolio lookup silently hidden | Preserve source precision, reject nonfinite prices, label the selected field and source time, expose unknown currency and failed overlay, suppress P/L on currency mismatch and manual funds |
| Option identity and sizing | OCC-coded Tiger underlyings missed; wrong expiry could select first returned series; overlay assumed caller's multiplier | Canonical underlying matching, verify series/row expiry, calculate each book lot using its own multiplier and currency |
| Option facts | Missing open interest treated as zero; long-call unlimited gain mislabeled naked short call; structured expiry snapshot omitted contract rows | Missing OI produces unavailable ratio; correct payoff label; include near-strike rows and quote provenance; distinguish chain fetch time from quote time |
| Portfolio totals | Added different native currencies and unlike underlying share obligations | Suppress unsupported combined totals, label native currency per lot; assignment cover requires matching currency |
| Portfolio analysis | Positions and assignment obligations summed in native units while cash could already be FX converted | Use one strict reporting-currency valuation and FX set for positions, cash, deposits, and obligations; expose price and broker/trade evidence |
| Household and projections | Absolute short-option premiums counted as positive assets; unknown holding currencies assumed reporting units; missing cash could look like zero | Signed cost basis converted with recorded assumption FX; suppress unsupported net worth; validate explicit portfolio value; explain cost basis versus live MTM |
| Opportunity cost | A holding's cost could be relabeled with another requested currency | Reject mismatched or unknown currencies instead of inventing conversion |
| Broker raw/triage/parser tools | Useful source content and parsed statement available only in `details`, not model-visible text | Include triage references and parsed statement in text; bounded, explicit character pagination for raw content, marked as source data rather than instructions |
| Broker freshness | Broker account list omitted last sync from agent text | Include account/channel and redacted sync metadata; status alone is not a freshness claim |
| IBKR NAV history | Only first XML account section parsed; conflicting NAV selected silently; hard archive cap lacked continuation | Parse all account sections, suppress conflicting marks, support archive pagination, explicitly scope coverage to returned page; no TWR claim |
| Snapshots | Capture dates and unqualified currency values could be confused with broker/trade dates | Show stored reporting currency and broker as-of evidence; return records with date-provenance caveat |
| Property intelligence | Even-sized samples used the upper middle observation as median | Average both middle observations for HDB and private-sales medians |
| URA lookup | Joining by car-park code overwrote different lot categories | Preserve all availability categories and withhold ambiguous single-category fields; validate action and row limit |
| Report tools | Web user ID omitted in dormant send-report auto mode; custom filenames could escape the user's folder | Honor authenticated user ID; require a single HTML report filename; validate newsletter calendar dates |

## Trade dates and broker evidence

The preceding trade-date fix is committed as `fe908e7` and is included in this checkout. `list_option_trades` provides filtered, paginated, dated execution records; `get_portfolio` exposes opening evidence reconciled against current lots. Analyzer output now includes the same evidence. A position snapshot, contract expiry, sync timestamp, and snapshot capture date are different facts from an execution/open date. Opening dates reconstructed from retained FIFO executions are evidence, not a new broker-reported fill date.

The earlier session investigation found 1,574 retained option records across IBKR, Tiger, MooMoo, and Webull, with opening evidence matching 415 of 417 current holdings. Two IBKR holdings lacked matching evidence and Tiger's latest sync had a lifecycle conflict. These are historical findings from that investigation, not a fresh production query during this audit. This change does not create missing fills or repair the remote Tiger data conflict. An agent must report gaps and inspect dated executions before claiming “opened in the past 30 days.”

## Tool coverage

| Factory / role | Registered tools |
| --- | --- |
| `createAidealTools` | `list_aideal_sleeves`, `compute_sleeve_index`, `save_aideal_newsletter`, `get_portfolio`, `get_quote`, `portfolio_analyzer`, `save_report` |
| `createBookkeeperTools` | `add_holding`, `remove_holding`, `get_portfolio`, `update_holding`, `clear_portfolio`, `post_opening_balance`, `post_adjustment`, `clear_cash`, `transfer_cash`, `mature_deposit`, `add_deposit`, `update_deposit`, `remove_deposit`, `clear_deposits`, `list_journal_entries`, `list_option_trades`, `get_household`, `get_treasury`, `list_cash_flows`, `get_projection_assumptions`, `set_treasury`, `add_property`, `update_property`, `record_property_payment`, `remove_property`, `add_liability`, `update_liability`, `remove_liability`, `add_cash_flow`, `update_cash_flow`, `remove_cash_flow`, `set_projection_assumptions`, `save_scenario`, `get_scenario`, `list_scenarios`, `delete_scenario`, `run_projection`, `compare_scenarios`, `save_snapshot`, `list_snapshots`, `configure_ibkr_flex`, `sync_ibkr_flex`, `inspect_ibkr_nav_history`, `configure_broker`, `list_broker_accounts`, `sync_broker`, `list_broker_triage`, `read_broker_raw`, `save_broker_parser`, `parse_broker_raw`, `apply_broker_statement`, `start_recon`, `get_recon`, `source_recon_channel`, `decide_recon_line`, `apply_recon_channel`, `skip_recon_channel` |
| `createFactcheckerTools` | `get_portfolio`, `list_option_trades`, `list_journal_entries`, `get_household`, `get_treasury`, `list_cash_flows`, `get_projection_assumptions`, `get_playbook`, `get_scenario`, `list_scenarios`, `run_projection`, `compare_scenarios`, `get_quote`, `portfolio_analyzer`, `build_payment_plan`, `estimate_opportunity_cost`, `property_intel`, `ura_carpark`, `options_insight`, `inspect_ibkr_nav_history`, `submit_factcheck_verdict` |
| `createFinancialPlannerTools` | `get_portfolio`, `list_journal_entries`, `list_option_trades`, `get_household`, `get_treasury`, `list_cash_flows`, `get_projection_assumptions`, `get_scenario`, `list_scenarios`, `run_projection`, `compare_scenarios`, `optimize_payment_plan`, `build_payment_plan`, `estimate_opportunity_cost`, `get_quote`, `portfolio_analyzer`, `list_snapshots` |
| `createInvageTools` | `list_broker_accounts`, `get_playbook`, `update_playbook`, `add_watch_product`, `remove_watch_product`, `get_household`, `get_treasury`, `list_cash_flows`, `get_projection_assumptions`, `get_scenario`, `list_scenarios`, `run_projection`, `compare_scenarios` |
| `createInvestmentAdvisorTools` | `get_portfolio`, `list_option_trades`, `get_playbook`, `get_quote`, `portfolio_analyzer`, `save_report` |
| `createOptionsExpertTools` | `get_portfolio`, `list_option_trades`, `get_playbook`, `get_quote`, `portfolio_analyzer`, `options_insight`, `save_report` |
| `createRealEstateExpertTools` | `property_intel`, `ura_carpark`, `get_household`, `get_treasury`, `list_cash_flows`, `get_projection_assumptions`, `get_scenario`, `list_scenarios`, `run_projection`, `compare_scenarios`, `get_portfolio` |

Authenticated wrappers: `bindrive_list`, `bindrive_upload`, `bindrive_download`, `bindrive_delete`, `list_raw_data`, and `fetch_raw_data`. Identity is captured by their authenticated constructors; domain wrappers bind the context user ID instead of trusting model-supplied identities. Raw reads use scoped storage APIs. Write/reconciliation tools continue through the existing account model, assertion, journal, and ledger paths; this audit does not claim every mutation was manually exercised against production.

## Validation

- `node node_modules/typescript/bin/tsc --noEmit`: passed.
- Final full Vitest run using the disposable PostgreSQL test runner: **676 tests, 630 passed, 46 failed**, across 87 test files. Compared failed assertion names against a clean `git archive` of baseline `fe908e7`; **all 46 failures are identical, with no new failures**. The archived baseline run included all 17 failing files (119 tests, 46 failed). No branch or worktree was created for comparison.
- Final focused run: **66 tests passed, zero failed**, across nine files: tool-data accuracy, analyzer currency, options insight, option marks, option trade tools, property intelligence, IBKR NAV, URA car parks, and default reporting currency. This includes 19 new assertions/test cases compared with the initial full run and tests after the final source changes.
- `git diff --check`: passed.
- Existing failures involve stale identity/account fixtures, legacy state APIs, broker-catalog assumptions, and related web/ledger integration expectations. They were reproduced before this audit's fixes. They still require repair; the full suite is not green.

Failing baseline files: `add-holding-fund`, `books-tools-parity`, `broker-account-isolation`, `broker-books-pipeline`, `broker-connections`, `broker-sync-history`, `broker-sync-notification`, `broker-sync-run`, `dashboard-webui`, `execution-import`, `execution-persistence`, `option-history-backfill`, `portfolio-state`, `recon`, `watch-products-tools`, `watchlist-webui`, and `handshake` (all `.test.ts`).

## Remaining limits

- Source truth still depends on broker exports and sync success. Current-book positions cannot establish complete history by themselves. Account, execution IDs, source time, and pagination must be retained when combining evidence.
- Yahoo prices and options may be delayed, closed-session prints, or fallback marks. Option bid/ask observation time is unavailable when the feed omits it; fetch time and last-trade time do not establish bid/ask freshness. No invented Greeks, IV, OI, FX, or missing fills are introduced.
- Aggregate valuation trusts recorded holding currency. Quote overlays explicitly verify currency; broad report valuation still relies on those recorded currencies and source symbol mapping. A full independent broker/feed reconciliation was not performed.
- Household projections are assumptions and signed book-cost estimates unless an explicit portfolio value is supplied. Recorded assumption FX differs from live reporting FX. Property summaries are returned samples, not market-wide appraisals; URA availability is a fetched observation with no guaranteed feed observation time.
- IBKR NAV pagination reports coverage for each page. Combine all pages and reconcile duplicates/conflicts before computing total coverage. Missing external-flow sections do not establish zero flows; the inspector intentionally reports `twr_ready: false`.
- Shared Utarus runtime tools and third-party services were inspected at their local integration boundaries; their upstream implementation and external data have not been certified.
- The existing failing integration fixtures need a separate migration cleanup. Their presence limits full-suite assurance even though the failure-name comparison identifies no additional failures from this audit.
- The fixes are local commits on `main`. Running remote agents will need a separately authorized deployment from a clean committed source.
