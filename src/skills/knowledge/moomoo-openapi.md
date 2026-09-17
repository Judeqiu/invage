# MooMoo Cloud Open API

Catalog connector `moomoo` on skill **broker-integration**. Load that skill. Tools: `configure_broker` / `sync_broker` with `connector_id=moomoo`. Do not install OpenD. Do not unlock trade.

Read-only live snapshot: positions + per-ISO cash onto channel `moomoo`. Cannot trade. Dashboard marks stay Yahoo. `as_of` is the UTC date of Sync. No option lots until an OptionSpec-complete REST fixture exists (unmapped option codes are `not_imported`).

Credentials: `app_key`, `private_key` (Ed25519 or RSA PEM). Optional `acc_id` when more than one authorized trading account exists. Optional `sign_alg` (`Ed25519` default, or `RSA-SHA256`).

Host is only `https://webapi.moomoo.com`. Successful snapshots: `drive/<slug>/moomoo-raw/`. Parse failure: `drive/<slug>/broker-raw/moomoo/<id>/raw.json`. Do not generate `csv_tables` for MooMoo JSON.

## jude_futu

Connector `moomoo` fetches Cloud Open API into channel `moomoo` only. It never reads `jude_futu`.

To move Futu-tagged lots onto `moomoo`, recon the `jude_futu` sleeve (paste or `update_holding`) and the `moomoo` sleeve (connector fetch) separately. `take` on one does not delete the other.

Fixed deposits stay on their channel; broker sync does not mature or move FDs.

Manual `*@moomoo` lots are replaced on first successful moomoo sync.
