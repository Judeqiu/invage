# Tiger OpenAPI

Catalog connector `tiger` on skill **broker-integration**. Load that skill. Tools: `configure_broker` / `sync_broker` with `connector_id=tiger`. IBKR Flex tools do not pull Tiger.

Read-only live snapshot: stock, option, and fund positions plus per-ISO cash onto channel `tiger`. Cannot trade. Dashboard marks stay Yahoo. `as_of` is the UTC date of Sync. Option lots use the shared `Holding.option` shape (short OPT included). Tiger option `averageCost` and `latestPrice` are per share; both are multiplied by the contract multiplier when mapped to the books' per-contract `avg_price` and `mark`. **History:** Sync latest requests recent paginated orders plus STK/OPT transactions; Full sync explicitly requests all available dates. Shared `broker_history` retains every returned stock/option transaction, parent orders and legs, including expired/closed contracts independently of current holdings. Exact multipliers come from current contract metadata or authoritative order legs; unknown cash stays null. Parent IDs, source decimals, fees and timezone are preserved. Final single-contract option commission/GST is allocated only when full order fills reconcile. Multi-leg intent/fees and unsupported Global execution coverage remain gaps; Global order history is retained. Old raw snapshots remain compatible.

Operator repair: `node --import tsx scripts/backfill-tiger-executions.mjs <user>` previews historical coverage. `--apply` merges execution/event history without replacing positions or cash; add `--sync` to refresh the Tiger account snapshot when assignments or trades made stored quantities stale. Run with the service environment; backups and raw evidence are retained in the user drive.

Credentials (Settings or `configure_broker`): `tiger_id`, `account`, `license`, `private_key` (PEM). Optional TBHK `token` (paste-rotate, ~30 days). Optional institutional `secret_key`.

TBHK without a token fails before fetch. Paper accounts ingest only if that account id is what the user stored.

Parse failure writes `drive/<slug>/broker-raw/tiger/<id>/` (`raw.json` + `case.yaml`). Successful snapshots: `drive/<slug>/tiger-raw/`. Do not generate `csv_tables` for Tiger JSON.

Existing `jude_futu` lots are not Tiger. Manual `*@tiger` lots are replaced on first successful tiger sync. FDs are never touched by apply.
