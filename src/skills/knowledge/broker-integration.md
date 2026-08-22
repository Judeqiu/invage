# Broker integration

Read-only ingest from a **catalog connector** (`catalog.get(id)`) onto that connector’s channel. IBKR (`ibkr`) is the shipped channel. Load whenever books should match a brokerage statement — connect, refresh, scheduled pull, parse failure, or reconcile vs the broker.

Never invent numbers. Never echo Flex tokens. Select by catalog id + capability, not synonyms.

## Tools

- `configure_ibkr_flex` / `sync_ibkr_flex` — IBKR Flex Web Service (XML catalog parser). Call sync anytime the channel is on.
- `read_broker_raw` — archived raw after catalog parse fails.
- `save_broker_parser` — persist a **declarative** `csv_tables` spec (host interprets; **no eval**).
- `parse_broker_raw` — run that spec against archived raw → BrokerStatement (does not write books).
- `apply_broker_statement` — same apply path as catalog sync.

Settings → Brokers uses the same store. Off refuses pull; lots stay. `not_imported` must be quoted.

## Parse pipeline

1. **Catalog parser** (IBKR: Flex XML Open Positions + Cash Report).
2. If that throws: raw is archived. **Do not stop at the error text.**
3. `read_broker_raw` for connector `ibkr`. Read the text. Produce either:
   - a `csv_tables` spec (headers + column map + `skipCurrencies` such as `BASE_SUMMARY`), `save_broker_parser`, then `sync_ibkr_flex` or `parse_broker_raw` + `apply_broker_statement`; or
   - a **BrokerStatement** JSON (`accountId`, `fromDate`, `toDate`, `cash[]`, `openPositions[]`) taken only from the raw, then `apply_broker_statement`.
4. If a field is not in the raw, omit it or list it in `skipped` — never guess cost, qty, or cash.

Fatal without apply: channel off, missing creds, Flex HTTP, empty cash sleeves. Partial: unsupported lots listed in `not_imported`.

IBKR activity is prior-day. Marks stay Yahoo.

## `csv_tables` spec shape

```json
{
  "kind": "csv_tables",
  "skipCurrencies": ["BASE_SUMMARY"],
  "cash": {
    "headerMustInclude": ["EndingCash", "CurrencyPrimary"],
    "columns": {
      "accountId": "ClientAccountID",
      "fromDate": "FromDate",
      "toDate": "ToDate",
      "currency": "CurrencyPrimary",
      "endingCash": "EndingCash"
    }
  },
  "positions": {
    "headerMustInclude": ["Symbol", "AssetClass"],
    "columns": {
      "accountId": "ClientAccountID",
      "symbol": "Symbol",
      "quantity": "Quantity",
      "currency": "CurrencyPrimary",
      "assetCategory": "AssetClass",
      "markPrice": "MarkPrice",
      "costBasisPrice": "CostBasisPrice",
      "costBasisMoney": "CostBasisMoney"
    }
  }
}
```
