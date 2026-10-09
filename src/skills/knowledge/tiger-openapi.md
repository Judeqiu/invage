# Tiger OpenAPI

Catalog connector `tiger` on skill **broker-integration**. Load that skill. Tools: `configure_broker` / `sync_broker` with `connector_id=tiger`. IBKR Flex tools do not pull Tiger.

Read-only live snapshot: stock, option, and fund positions plus per-ISO cash onto channel `tiger`. Cannot trade. Dashboard marks stay Yahoo. `as_of` is the UTC date of Sync. Option lots use the shared `Holding.option` shape (short OPT included). Tiger option `averageCost` and `latestPrice` are per share; both are multiplied by the contract multiplier when mapped to the books' per-contract `avg_price` and `mark`. **Option history** for Prime/Paper accounts is fetched with paginated `orders` (all security types, including combos and delivery records) and `order_transactions` (OPT), from 2000-01-01 through a stable sync cutoff. Transaction/order IDs retain their full wire digits. Current option contracts map using exact position metadata; prior executions and other brokers remain merged. Single-contract final order commissions plus GST are allocated across their reconciled fills; missing fees or combo-order per-leg fees remain unknown, so dashboard credits show **before fees**. Explicit assignment/exercise/expiration/cash-settlement orders become lifecycle events and reduce outstanding opening lots. Market-local dates come from epoch timestamps. Global accounts retain position-only import; their transaction-history endpoint is unsupported. Old raw snapshots remain compatible.

Operator repair: `node --import tsx scripts/backfill-tiger-executions.mjs <user>` previews historical coverage. `--apply` merges execution/event history without replacing positions or cash; add `--sync` to refresh the Tiger account snapshot when assignments or trades made stored quantities stale. Run with the service environment; backups and raw evidence are retained in the user drive.

Credentials (Settings or `configure_broker`): `tiger_id`, `account`, `license`, `private_key` (PEM). Optional TBHK `token` (paste-rotate, ~30 days). Optional institutional `secret_key`.

TBHK without a token fails before fetch. Paper accounts ingest only if that account id is what the user stored.

Parse failure writes `drive/<slug>/broker-raw/tiger/<id>/` (`raw.json` + `case.yaml`). Successful snapshots: `drive/<slug>/tiger-raw/`. Do not generate `csv_tables` for Tiger JSON.

Existing `jude_futu` lots are not Tiger. Manual `*@tiger` lots are replaced on first successful tiger sync. FDs are never touched by apply.
