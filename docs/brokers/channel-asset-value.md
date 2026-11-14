# Channel asset-value query

The approved formula is:

**Stock market value + cash balance + money-market fund market value.**

Use `query_data` with `from: "channel_asset_values"`, filtered by the exact
custody channel returned by `broker_accounts`. The result supplies the components,
their sum, reporting currency, saved calculation time, broker statement date when
recorded, completeness and unresolved evidence. `channel_asset_components` shows
the underlying holding/balance keys, native currencies, FX rates and source paths.

```json
{
  "from": "channel_asset_values",
  "where": {"field": "channel", "op": "eq", "value": "<channel>"}
}
```

This uses the latest valid saved portfolio generation and its reporting currency,
as selected by the user. No market prices, FX or broker requests run during the
query. State changes invalidate the generation until the normal calculation
pipeline prepares its replacement. Pagination requires the existing investor
revision and saved-source version guards; use the same source version when
following summary rows to component evidence. These saved datasets are unavailable
in incognito, matching the other saved portfolio-derived query sources.

## Definition and currency treatment

- Scope is the selected custody channel's recorded stock holdings, cash and
  explicitly classified money-market funds. Options, other fund classes, fixed
  deposits and aggregate broker NAV are excluded. Stocks and funds retain their
  position units; options and their contract multipliers do not enter the formula.
- Stock/fund `value` comes directly from the saved position valuation. It is
  already converted to reporting currency and is never multiplied by FX again.
  Cost-fallback stock values cannot establish market value. Fees and cost basis
  are not deducted from current market values.
- Native cash sleeves use the same saved native-to-reporting FX rates, once per
  sleeve. When the saved broker account explicitly supplies its cash balance,
  that authoritative same-metric balance takes precedence over itemized cash;
  both are never added. Signed debit cash, rebates and explicit zeroes survive.
  Same-currency conversion is identity. A known zero needs no unused FX rate.
- Only structured `fund.product_class = "mmf"` proves money-market inclusion.
  Fund names and descriptions do not classify products. Unclassified funds or
  a broker aggregate fund amount without itemized product evidence leave the
  money-market component unavailable. A connected broker with neither itemized
  fund evidence nor an explicit aggregate fund value has unverified fund scope.
  An aggregate fund amount is never assumed to be an additional money-market lot.
- Missing cash, holdings, market values, classification, currencies or required
  FX produce null components and an unavailable total, with reasons. Completeness
  describes recorded formula inputs, not broker account reconciliation or proof
  that an API returned all real-world assets.

The arithmetic uses decimal representations of stored valuation numbers and saved
FX, preserving their precision without imposing display rounding. This does not
claim broker-exact decimal precision for previously saved binary floating-point
market valuations. Cash conversion and addition execute in code, not model prose.

`calculated_at` is the generation timestamp. It does not assert that every stock
quote, manual fund mark, broker balance and FX rate shares that timestamp. Individual
quote/FX timestamps are not present in the existing saved model and are not
invented by this query. Consult the component sources and broker date accordingly.

The change adds query datasets only; it does not modify dashboard layouts,
existing NAV metrics, source holdings or accounting balances.
