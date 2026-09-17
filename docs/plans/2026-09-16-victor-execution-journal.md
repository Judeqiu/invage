# Victor execution journal

The September 9 review requires individual option executions, not position-average premiums. The current `Holding` snapshot cannot represent fills or rolls. Add an optional `option_executions` collection to investor state and optional `option_executions` to the canonical broker statement. Store account, channel, broker trade ID, contract ID, broker-local execution timestamp, buy/sell, open/close, quantity, multiplier, strike, expiry, underlying, currency, gross proceeds and signed commission. Decimal monetary strings preserve source precision; sums use decimal integer arithmetic. Never infer execution history from holding snapshots.

Identity is (channel, account, trade ID). Identical imports are idempotent; conflicting records fail before any snapshot mutation. Absence of Trades means history unavailable, not zero activity. An explicit empty execution section means no executions supplied in that report. Only execution-level option rows enter this journal; summary and closed-lot rows must not double count. Unsupported corrections fail explicitly. Broker timestamps retain the report's clock without inventing UTC.

Normal broker sync merges executions and replaces current holdings as before. Historical XML upload merges executions only, without applying old cash or positions. The journal shows each execution, exact signed commission and net premium; daily short-option premium groups sell-to-open and buy-to-close by account, channel, date and currency. Cumulative totals are secondary references and cover imported records only. Historical spot prices, roll pairing and position lifecycle are not inferred from incomplete history.

Validation: parser errors, decimal precision, opening/closing cash signs, idempotent overlapping statements, conflicting IDs, account isolation, daily totals, old-statement upload, authenticated API and rendered journal. Existing holdings remain authoritative for exposure. NLV and full cash/dividend/interest reconciliation are follow-up work and cannot be asserted from this journal.

IBKR field reference: https://www.ibkrguides.com/reportingreference/reportguide/tradesfq.htm
