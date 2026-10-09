# MooMoo Cloud Open API

Catalog connector `moomoo` on skill **broker-integration**. Load that skill. Tools: `configure_broker` / `sync_broker` with `connector_id=moomoo`. Do not install OpenD. Do not unlock trade.

Read-only live snapshot: stock and listed option lots + per-ISO cash onto channel `moomoo`. Cannot trade. Dashboard marks stay Yahoo. `as_of` is the UTC date of Sync.

Option lots map into the same `Holding.option` as IBKR/Tiger when every `OptionSpec` field is present (right, side, strike, expiry, multiplier/`lot_size`, underlying/`stock_owner`, per-share `nominal_price` × multiplier as mark). Short options import. Cloud position rows omit contract size: Sync reads exact-code static profiles from `POST /api/v1.0/quote/stock-basicinfo` and retains `option_basicinfo` in the raw bundle. `contract_size` takes precedence over `lot_size`; no multiplier is guessed. A metadata request failure aborts the snapshot before apply. Missing or ambiguous profiles remain `not_imported`. Codes like `HK.TCH260629C390000` parse when those fields (or a proven HK root such as TCH→`0700.HK`) complete the spec; otherwise `not_imported`. Combo/strategy views are not lots. **Option fill history** (`option_executions`) is not fetched — omit the field so existing IBKR journal rows stay.

Credentials: `app_key`, `private_key` (Ed25519 or RSA PEM). Optional `sign_alg` (`Ed25519` default, or `RSA-SHA256`). Invage discovers authorized trading accounts from the AppKey. The UI offers a selector if Moomoo returns more than one; the selected `acc_id` is stored internally.

How to get them:

1. https://open.moomoo.com/dashboard → User Center → create an AppKey. Choose Ed25519 or RSA, upload the public key, keep the private key local. Copy the AppKey ID into `app_key` and the private key into `private_key`. Set `sign_alg` to the algorithm chosen on the key.
2. Save the AppKey and private key. Invage queries Moomoo's authorized trading accounts. One account is used automatically.
3. If Moomoo authorizes several accounts, select the intended account in Manage using the account card ending, then Save and Sync. Do not ask the user to type an ID.
4. The moomoo ID (牛牛号) and universal/account card number are not the OpenAPI `account_id`.

Host is only `https://webapi.moomoo.com`. Successful snapshots: `drive/<slug>/moomoo-raw/`. Parse failure: `drive/<slug>/broker-raw/moomoo/<id>/raw.json`. Do not generate `csv_tables` for MooMoo JSON.

## jude_futu

Connector `moomoo` fetches Cloud Open API into channel `moomoo` only. It never reads `jude_futu`.

To move Futu-tagged lots onto `moomoo`, recon the `jude_futu` sleeve (paste or `update_holding`) and the `moomoo` sleeve (connector fetch) separately. `take` on one does not delete the other.

Fixed deposits stay on their channel; broker sync does not mature or move FDs.

Manual `*@moomoo` lots are replaced on first successful moomoo sync.
