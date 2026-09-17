# Tiger OpenAPI

Catalog connector `tiger` on skill **broker-integration**. Load that skill. Tools: `configure_broker` / `sync_broker` with `connector_id=tiger`. IBKR Flex tools do not pull Tiger.

Read-only live snapshot: stock, option, and fund positions plus per-ISO cash onto channel `tiger`. Cannot trade. Dashboard marks stay Yahoo. `as_of` is the UTC date of Sync.

Credentials (Settings or `configure_broker`): `tiger_id`, `account`, `license`, `private_key` (PEM). Optional TBHK `token` (paste-rotate, ~30 days). Optional institutional `secret_key`.

TBHK without a token fails before fetch. Paper accounts ingest only if that account id is what the user stored.

Parse failure writes `drive/<slug>/broker-raw/tiger/<id>/` (`raw.json` + `case.yaml`). Successful snapshots: `drive/<slug>/tiger-raw/`. Do not generate `csv_tables` for Tiger JSON.

Existing `jude_futu` lots are not Tiger. Manual `*@tiger` lots are replaced on first successful tiger sync. FDs are never touched by apply.
