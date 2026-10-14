# Futubull Cloud Open API

Futubull uses the same cloud REST protocol as moomoo, through `https://webapi.futunn.com`. New connections do not require OpenD or Python.

In Settings → Brokers, choose Futubull. Log in at https://open.futunn.com/dashboard, open User Center, create an AppKey, and upload an Ed25519 or RSA public key. Save the AppKey ID and matching private key in Invage; set Signature algorithm to Ed25519 (default) or RSA-SHA256. Find accounts, select the authorized trading account using its card ending, then Preview and Sync. The Futubull profile ID and account card number are not the API account_id.

The connector imports stock and listed option positions, per-currency cash, and available paginated US/HK fill and order history. Sync latest requests recent data; Full sync explicitly imports available history. Unknown fees and unavailable expired option metadata remain explicit gaps. Current option positions require authoritative contract sizes before snapshot replacement.

Futubull connections and history retain broker_id `futubull` and their distinct channels. They do not move moomoo or manual `jude_futu` holdings. The integration is read-only and never unlocks trading or submits orders. Never echo private keys.

Existing saved OpenD connections and archived OpenD snapshots remain supported. To use cloud access, configure a Futubull AppKey and matching private key. Live account access requires verification with an authorized Futubull account.

Official documentation: https://open.futunn.com/api/overview/getting-started
