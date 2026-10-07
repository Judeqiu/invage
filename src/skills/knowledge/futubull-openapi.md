# Futubull OpenD connector

Futubull uses the [Futu OpenAPI](https://openapi.futunn.com/futu-api-doc/en/intro/intro.html). It requires a signed-in OpenD gateway and the official `futu-api` Python SDK on the Invage host. Install the SDK into the `python3` environment used by Invage. Keep the gateway API listener on `127.0.0.1`; configure its local port and the matching securities firm in Settings → Brokers. For a remote OpenD, provide a local SSH tunnel rather than exposing the gateway listener.

The connector calls only `get_acc_list`, `accinfo_query`, and `position_list_query`. It filters discovery to live securities accounts and binds sync to the selected `acc_id`. It imports stock and ETF positions plus per-currency cash into a distinct Futubull channel. It reports option positions and unsupported markets as skipped, and rejects a snapshot if cash is missing or negative. It does not unlock trading or submit orders. The `jude_futu` manual channel remains separate.

OpenD login, device verification, and the Futu API questionnaire and agreements must be completed in OpenD. A separate OpenD instance and local port are needed for each login. Test discovery and Preview before first Sync. Live OpenD behavior requires verification with an authorized account; repository tests use synthetic snapshots only.
