# Webull OpenAPI

Catalog connector `webull` on skill **broker-integration**. Load that skill. Tools: `configure_broker` / `sync_broker` with `connector_id=webull`. Do not use unofficial email/password libraries. Do not place orders.

Read-only live snapshot: equity and **single-leg listed option** lots + per-ISO cash onto channel `webull`. Cannot trade. Dashboard marks stay Yahoo. `as_of` is the UTC date of Sync.

Option lots map into the same `Holding.option` as IBKR/Tiger from `instrument_type=OPTION` plus exactly one option `legs[]` (strike, expiry, type, multiplier, underlying symbol). Premiums are per-share × multiplier (dollars per contract). Multi-leg / combo strategies are `not_imported`. Sync latest requests recent order history; Full sync explicitly pages all available orders. `broker_orders` and `broker_order_legs` retain closed, multi-leg and cancelled partially filled orders independently of current holdings. Terminal single-leg cumulative order cash also enters the option journal with stable `order:` IDs, including expired or closed contracts; these are order-derived records, not individual executions. Use broker currency when reported; omitted US-option premium currency uses the approved USD interpretation. Unreported fee currency and opening/closing intent stay unknown. Missing individual executions keep history coverage partial; another full sync alone cannot repair a projection omission. Existing legacy option records remain stored. Futures/crypto/event accounts are skipped unless that `account_id` is pasted.

Credentials: `app_key`, `app_secret`, `region` (`us` `hk` `jp` `sg` `th` `au` `my` `uk` `eu`). Optional `account_id` when more than one brokerage account exists. When the API requires in-app 2FA, Settings → Brokers → Webull can create a token, save it privately, and check its status. The user must approve the request in the Webull app within five minutes; Invage does not poll the app automatically. A token may also be pasted manually into `access_token`.

Hosts are allow-listed production API endpoints only (`api.webull.com`, `api.webull.hk`, `api.webull.com.sg`, …). No sandbox. Successful snapshots: `drive/<slug>/webull-raw/`. Parse failure: `drive/<slug>/broker-raw/webull/<id>/raw.json`. Do not generate `csv_tables` for Webull JSON.

App Secret is used only to HMAC-SHA256-sign requests (`secret&`). It is never sent as an HTTP header.
