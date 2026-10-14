# Tiger regional normalization

Reviewed 14 October 2026 against Tiger's [market enumerations](https://quant.itigerup.com/openapi/en/csharp/appendix2/overview.html) and [order/transaction API](https://docs-en.itigerup.com/docs/orderinfo-java). The published market enum lists US, HK, CN, SG, AU and NZ. Japan is retained from the existing adapter, without claiming that every Tiger account can trade it. Account entitlements and instrument coverage remain separate from parsing support.

`src/tiger/tiger-markets.ts` centralizes Tiger market aliases, quote symbols, epoch-millisecond timestamp validation and IANA timezones. Positions, full history and legacy option execution/fee handling use it. This registry is scoped to Tiger because other brokers have different native codes and timestamp formats.

| Region | Canonical code | Accepted exchange/quote aliases | Quote symbol | Timezone |
| --- | --- | --- | --- | --- |
| United States | US | US | AAPL | America/New_York |
| Hong Kong | HK | SEHK, HKEX | 0700.HK (numeric codes normalized) | Asia/Hong_Kong |
| Mainland China | CN | SH, SS, SSE, SZ, SZSE, SEHKNTL, SEHKSZSE | 600519.SS / 000001.SZ when listing verified | Asia/Shanghai |
| Singapore | SG | SI, SGX | Z74.SI | Asia/Singapore |
| Australia | AU | AX, ASX | BHP.AX | Australia/Sydney |
| New Zealand | NZ | NZX | AIR.NZ | Pacific/Auckland |
| Japan (existing compatibility) | JP | TSE | 9984.T | Asia/Tokyo |

Exchange and quote aliases are adapter compatibility rules, not additional values claimed by Tiger's Market enum. `SI` transactions were observed in the failed Singapore full-sync payload; Tiger's published order example also includes a suffixed Singapore symbol. Normalization ignores surrounding whitespace and case, removes an existing region suffix before adding it, reconciles order/transaction native identities, and leaves the raw payload untouched. US dotted share-class symbols remain intact. IANA zones apply daylight saving for the actual historical timestamp.

China requires an explicit Shanghai/Shenzhen exchange or a `.SS`/`.SZ` symbol. The `CN` market and a currency alone do not establish the listing. Unresolved executions remain in history with a null quote symbol and a metadata gap; unresolved current positions carry a skip reason. No quote ticker is fabricated from currency or a numeric-code heuristic.

An unfamiliar nonempty market no longer aborts full sync solely because its timezone is unknown. Its documented epoch timestamp is retained in UTC, with `clock: UTC`, native identity, null quote symbol and explicit metadata gaps. Coverage is partial and `full_history_synced` stays false. Market-local option projection cannot be produced without a mapped underlying. Invalid timestamps, account mismatches and inconsistent exact financial values still fail validation. Regional support does not imply futures/warrants/FX execution coverage, complete historical retention, or missing expired-option multipliers.

Regression tests cover positions and order/fill identity across every supported region, bare and suffixed tickers, both China exchanges, US/Australia/New Zealand daylight saving, Hong Kong option fees, unknown-market retention, ambiguous China listings and invalid timestamps.
