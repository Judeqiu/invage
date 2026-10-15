# MooMoo Cloud Open API

Catalog connector `moomoo` on skill **broker-integration**. Load that skill. Tools: `configure_broker` / `sync_broker` with `connector_id=moomoo`. Do not install OpenD. Do not unlock trade.

Read-only live snapshot: stock and listed option lots + per-ISO cash onto channel `moomoo`. Cannot trade. Dashboard marks stay Yahoo. `as_of` is the UTC date of Sync.

**Fund coverage:** Cloud `GET /api/v1.0/accounts/{acc_id}/funds` returns `funds_assets`, an aggregate fund value in the response `currency`. Sync stores it as `broker_connections.<connection>.metrics.fund_assets`; `query_data` → `broker_accounts` exposes `fund_assets`, `metrics_currency` and `metrics_as_of`. Missing is unknown; an explicit zero is zero. This is separate from per-currency free cash. Dashboard and Insights show the account total with its date/currency. The documented Cloud positions response does not provide individual fund holdings for this aggregate, so fund names, units, cost, NAV per unit and lot count remain unavailable. Never invent a fund lot, cost basis or P/L from the total. It is excluded from itemized portfolio NAV/P&L, and an empty fund positions dataset does not establish no fund assets. To record individual funds, obtain a fund statement or screenshot with the real holdings and reconcile on a separate manual channel so broker sync does not replace them. Do not add the aggregate total to those manual lots.

Coverage details belong in broker sync notifications, not page banners, metric subtitles, or Insights risk cards. Notifications append deduplicated coverage notes after the sync summary, including when the summary model fails. Page risk cards are reserved for calculated portfolio risks such as cash versus assignment obligations and near-expiry ITM options. Keep unavailable amounts unknown and partial subtotals labeled; do not fill missing data with zero to remove a note.

Research references (2026-10-15): [Cloud account funds](https://open.moomoo.com/api/trading/account/get-funds) documents `funds_assets` and its display currency; [Cloud positions](https://open.moomoo.com/api/trading/account/get-positions) documents security positions without a separate fund-holdings resource. The deployed account evidence contains a positive fund total but only stock/option position rows. No supported Cloud endpoint for individual fund holdings was found in the [API reference](https://open.moomoo.com/api/overview/api-reference).

Option lots map into the same `Holding.option` as other brokers. Exact contract sizes come from static profiles, explicit positions, or authoritative parent-order leg premium multipliers. Sizes are never guessed. A missing current-held size or malformed position list aborts replacement and preserves stored holdings. An explicit empty position list and explicit zero-quantity rows are valid broker evidence.

Sync latest requests recent data only, even when `broker_history` is absent or partial. Full sync (`full_sync:true`) explicitly imports available history. Latest requests use the retained checkpoint with overlap and preserve prior history/gaps. US and HK fills and parent orders are paginated with explicit stable bounds; parent details include old orders referenced by recent fills. Closed contracts and long protective legs are retained independently of current holdings. Unavailable expired metadata retains the record with null cash and an explicit gap, without discarding other verified history or current positions. Fees absent from the Cloud API remain null; $815 gross roll credit is not automatically $815 after fees.

**Agent data access:** use `get_data_dictionary` and the generic `query_data` datasets `positions`, `broker_executions`, `broker_orders`, `broker_order_legs`, `broker_history_sync`, and `broker_history_gaps`. Join by exact broker/channel/account. Check current positions separately from execution coverage: missing history is not missing holdings. `option_executions` is the shared verified option-cash projection. Archived raw fields remain available via `raw_files` and `source_records`. Account history and broker errors must be reported explicitly; never infer zero balances, missing holdings or no trades from null/unrecorded history.

For dashboard reports of missing Moomoo data, check stored `positions`, the selected broker/date view, and the last successful account sync before proposing restoration. An archived-date view can differ from current broker holdings.

Credentials: `app_key`, `private_key` (Ed25519 or RSA PEM). Optional `sign_alg` (`Ed25519` default, or `RSA-SHA256`). Invage discovers authorized trading accounts from the AppKey. The UI offers a selector if Moomoo returns more than one; the selected `acc_id` is stored internally.

How to get them:

1. https://open.moomoo.com/dashboard → User Center → create an AppKey. Choose Ed25519 or RSA, upload the public key, keep the private key local. Copy the AppKey ID into `app_key` and the private key into `private_key`. Set `sign_alg` to the algorithm chosen on the key.
2. Save the AppKey and private key. Invage queries Moomoo's authorized trading accounts. One account is used automatically.
3. If Moomoo authorizes several accounts, select the intended account in Manage using the account card ending, then Save and Sync. Do not ask the user to type an ID.
4. The moomoo ID (牛牛号) and universal/account card number are not the OpenAPI `account_id`.

Host is only `https://webapi.moomoo.com`. Successful account snapshots: `drive/<user UUID>/broker-sync/<channel>/`. Parse failures: `drive/<user UUID>/broker-triage/<channel>/`. Older retained archive locations can also exist. Do not generate `csv_tables` for MooMoo JSON.

## jude_futu

Connector `moomoo` fetches Cloud Open API into channel `moomoo` only. It never reads `jude_futu`.

To move Futu-tagged lots onto `moomoo`, recon the `jude_futu` sleeve (paste or `update_holding`) and the `moomoo` sleeve (connector fetch) separately. `take` on one does not delete the other.

Fixed deposits stay on their channel; broker sync does not mature or move FDs.

Manual `*@moomoo` lots are replaced on first successful moomoo sync.
