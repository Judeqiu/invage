# Futubull Cloud Open API

Verified against Futu’s public documentation on 2026-10-14. Invage implements AppKey request signing at `https://webapi.futunn.com`. Futu recommends OAuth 2.1 + PKCE for new applications but retains API Key authentication. This form accepts an AppKey and private key; it does not accept an OAuth client ID or token. New cloud access requires no OpenD or Python.

## Setup

1. In Settings → Brokers, click **Add broker account → Futubull**.
2. Open the [Futu developer dashboard](https://open.futunn.com/dashboard) and sign in with the Futubull identity for the intended account. Follow the API Key / AppKey section of the official guide.
3. Generate a key pair locally. With OpenSSL installed, run these commands in a new folder in macOS/Linux Terminal or Windows PowerShell. Do not overwrite an existing account’s keys.

   ```sh
   openssl genpkey -algorithm ED25519 -out futubull-private.pem
   openssl pkey -in futubull-private.pem -pubout -out futubull-public.pem
   ```

4. In **User Center**, create an AppKey, choose **Ed25519**, and upload **futubull-public.pem**. Copy the AppKey ID. Keep the private file secure.
5. In Invage, enter **AppKey ID** and paste the complete **futubull-private.pem** contents into **AppKey private key**, including the PEM header/footer and line breaks. Set **Signature algorithm** to **Ed25519**, or leave it blank for that default. An existing RSA AppKey instead needs its corresponding RSA private key and **RSA-SHA256**. Invage has no private-key passphrase field.
6. Click **Save access → Find accounts**. Select the intended account using its card ending, enter a label, and click **Add account**. Discovery returns the API account ID; the Futubull profile ID and card number are different identifiers.
7. Click **Preview** and review positions, cash currencies, and skipped rows. **Sync latest** imports current data and recent history. **Full sync** explicitly requests available historical trades.

## Troubleshooting

- **No authorized accounts:** check the developer login and AppKey identity. Only accounts authorized by Futu for that key can be discovered. Public documentation does not establish an additional account-authorization button or guarantee every account’s eligibility; do not invent dashboard steps.
- **Invalid PEM:** paste the private-key contents, not the filename, public key, or login password. Keep its header, footer, and line breaks.
- **Signature failure:** check the AppKey, uploaded public key, private key, and chosen algorithm all belong to the same pair. After replacing a key, save the corresponding credentials in Invage before retrying.
- **Preview gaps:** review skipped rows before syncing. Current option lots require authoritative contract sizes; unavailable historical metadata and fees stay explicitly unknown.

Futubull uses its own broker ID and account channels. Sync does not move moomoo or manual `jude_futu` holdings. Invage never unlocks trading or submits orders. Never echo private keys. Existing saved OpenD connections and archived snapshots remain supported; cloud access can be configured through the AppKey fields.

## Sources and verification limits

- [Futu Getting Started — API Key authentication, dashboard and algorithms](https://open.futunn.com/api/overview/getting-started)
- [Futu authorized trading accounts — account identifiers](https://open.futunn.com/api/trading/account/get-accounts)
- [OpenSSL genpkey — key generation](https://docs.openssl.org/3.0/man1/openssl-genpkey/)
- [OpenSSL pkey — public-key export](https://docs.openssl.org/3.0/man1/openssl-pkey/)

Dashboard labels above follow the public guide. The signed-in AppKey workflow and live account discovery have not been independently verified with an authorized Futubull account.
