# MooMoo Cloud Open API

Catalog connector `moomoo` on skill **broker-integration**. Load that skill. Tools: `configure_broker` / `sync_broker` with `connector_id=moomoo`. Do not install OpenD. Do not unlock trade.

Read-only live snapshot: stock and listed option lots + per-ISO cash onto channel `moomoo`. Cannot trade. Dashboard marks stay Yahoo. `as_of` is the UTC date of Sync.

Option lots map into the same `Holding.option` as IBKR/Tiger when every `OptionSpec` field is present (right, side, strike, expiry, multiplier/`lot_size`, underlying/`stock_owner`, per-share `nominal_price` × multiplier as mark). Short options import. Codes like `HK.TCH260629C390000` parse when those fields (or a proven HK root such as TCH→`0700.HK`) complete the spec; otherwise `not_imported`. Combo/strategy views are not lots. **Option fill history** (`option_executions`) is not fetched — omit the field so existing IBKR journal rows stay.

Credentials: `app_key`, `private_key` (Ed25519 or RSA PEM). Optional `sign_alg` (`Ed25519` default, or `RSA-SHA256`). Optional `acc_id` only when Get Authorized Trading Accounts returns more than one account.

How to get them:

1. https://open.moomoo.com/dashboard → User Center → create an AppKey. Choose Ed25519 or RSA, upload the public key, keep the private key local. Copy the AppKey ID into `app_key` and the private key into `private_key`. Set `sign_alg` to the algorithm chosen on the key.
2. Leave `acc_id` empty and sync. One authorized account is selected automatically.
3. If sync says multiple accounts, paste the long `account_id` from that message (about 18 digits, for example `281756420273981734`). The message includes the broker (`FUTUSG` and similar) and the account card’s last four digits so it can be matched to the app.
4. Do not paste the moomoo ID (牛牛号, often about 9 digits) or the universal/account card number. Those are different from `account_id` and sync fails with “not in the authorized trading accounts list.” When that happens, the error lists the `account_id` values this AppKey can read — paste one of those, or clear the field if only one is listed.

Host is only `https://webapi.moomoo.com`. Successful snapshots: `drive/<slug>/moomoo-raw/`. Parse failure: `drive/<slug>/broker-raw/moomoo/<id>/raw.json`. Do not generate `csv_tables` for MooMoo JSON.

## jude_futu

Connector `moomoo` fetches Cloud Open API into channel `moomoo` only. It never reads `jude_futu`.

To move Futu-tagged lots onto `moomoo`, recon the `jude_futu` sleeve (paste or `update_holding`) and the `moomoo` sleeve (connector fetch) separately. `take` on one does not delete the other.

Fixed deposits stay on their channel; broker sync does not mature or move FDs.

Manual `*@moomoo` lots are replaced on first successful moomoo sync.
