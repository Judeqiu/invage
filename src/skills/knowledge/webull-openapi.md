# Webull OpenAPI

Catalog connector `webull` on skill **broker-integration**. Load that skill. Tools: `configure_broker` / `sync_broker` with `connector_id=webull`. Do not use unofficial email/password libraries. Do not place orders.

Read-only live snapshot: equity and **single-leg listed option** lots + per-ISO cash onto channel `webull`. Cannot trade. Dashboard marks stay Yahoo. `as_of` is the UTC date of Sync.

Option lots map into the same `Holding.option` as IBKR/Tiger from `instrument_type=OPTION` plus exactly one option `legs[]` (strike, expiry, type, multiplier, underlying symbol). Premiums are per-share × multiplier (dollars per contract). Multi-leg / combo strategies are `not_imported`. **Option fill history** is not fetched — omit `option_executions`. Futures/crypto/event accounts are skipped unless that `account_id` is pasted.

Credentials: `app_key`, `app_secret`, `region` (`us` `hk` `jp` `sg` `th` `au` `my` `uk` `eu`). Optional `account_id` when more than one brokerage account exists. Optional `access_token` when the API requires in-app 2FA (paste-rotate; Invage does not poll the Webull app).

Hosts are allow-listed production API endpoints only (`api.webull.com`, `api.webull.hk`, `api.webull.com.sg`, …). No sandbox. Successful snapshots: `drive/<slug>/webull-raw/`. Parse failure: `drive/<slug>/broker-raw/webull/<id>/raw.json`. Do not generate `csv_tables` for Webull JSON.

App Secret is used only to HMAC-SHA256-sign requests (`secret&`). It is never sent as an HTTP header.
