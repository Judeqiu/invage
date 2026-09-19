/**
 * Connector catalog — capability descriptions keyed by id.
 * Selection is catalog.get(id), never keyword matching on user text.
 */

import { IBKR_CHANNEL } from '../ibkr/flex-map.js';

export type CredentialFieldType = 'secret' | 'text';
export type CredentialWidget = 'input' | 'textarea';
export type CredentialFormat = 'plain' | 'pem';

export interface CredentialFieldDef {
  id: string;
  label: string;
  type: CredentialFieldType;
  required: boolean;
  help?: string;
  widget?: CredentialWidget;
  format?: CredentialFormat;
}

export interface BrokerConnectorDef {
  id: string;
  displayName: string;
  channel: string;
  capability: string;
  credentialFields: CredentialFieldDef[];
  helpNotes?: string[];
  /** Ordered Client Portal / vendor steps (IP note is assembled at GET time). */
  helpSteps?: string[];
  helpHref?: string;
  helpHrefLabel?: string;
  ipWhitelistHelp?: boolean;
  syncQueryFieldId?: string;
}

export const BROKER_CATALOG: readonly BrokerConnectorDef[] = [
  {
    id: 'ibkr',
    displayName: 'Interactive Brokers',
    channel: IBKR_CHANNEL,
    capability:
      'Read-only IBKR Flex Web Service. Pulls Open Positions and Cash Report into channel ibkr and imports option execution history when Trades is included. Cannot trade or submit orders. Activity data is prior-day; dashboard marks stay Yahoo.',
    credentialFields: [
      {
        id: 'token',
        label: 'Flex Web Service token',
        type: 'secret',
        required: true,
        help: 'Numeric token from Client Portal → Settings → Flex Web Service. Shown once at generation.',
      },
      {
        id: 'activity_query_id',
        label: 'Activity Flex Query ID',
        type: 'text',
        required: true,
        help: 'Info icon on the Flex Queries list. Query must include Open Positions and Cash Report, format XML. Include Trades at Executions level for the option journal: accountId, tradeID, conid, dateTime (YYYYMMDD;HHMMSS), assetCategory, levelOfDetail, buySell, openCloseIndicator, quantity, multiplier, underlyingSymbol, putCall, strike, expiry (YYYYMMDD), currency, proceeds, ibCommission and ibCommissionCurrency. Multi-currency cash is imported; BASE_SUMMARY is dropped.',
      },
      {
        id: 'tradeconf_query_id',
        label: 'Trade Confirmation Flex Query ID',
        type: 'text',
        required: false,
        help: 'Optional. Stored for later intra-day confirms. Sync now uses the Activity query only.',
      },
    ],
    helpNotes: [
      'Max token life is 1 year (IBKR 1012 when expired). Query IDs survive rotation.',
    ],
    helpSteps: [
      'Log in to Client Portal (live username that owns the Flex templates).',
      'Settings → Account Report → Flex Web Service → enable → Generate New Token. Capture the numeric token (not shown again).',
      'Performance & Reports → Flex Queries → Activity query, XML, sections Open Positions and Cash Report. Copy Query ID from the Info icon.',
      'Optional Trade Confirmation query for later; not used by Sync now in v1.',
    ],
    helpHref: 'https://www.interactivebrokers.com/campus/ibkr-api-page/flex-web-service/',
    helpHrefLabel: 'Flex Web Service docs',
    ipWhitelistHelp: true,
    syncQueryFieldId: 'activity_query_id',
  },
  {
    id: 'tiger',
    displayName: 'Tiger Brokers',
    channel: 'tiger',
    capability:
      'Read-only Tiger Brokers OpenAPI. Pulls a live snapshot of stock, option, and fund positions plus per-currency cash into channel tiger. Cannot trade or submit orders. Snapshot time is the UTC date of Sync (not prior-day Flex). Dashboard marks stay Yahoo. Option fill history is not imported (IBKR Flex Trades only). Paper accounts ingest only if you paste a paper account id.',
    credentialFields: [
      {
        id: 'tiger_id',
        label: 'Tiger ID',
        type: 'text',
        required: true,
        help: 'Developer ID from https://developer.itigerup.com/profile.',
      },
      {
        id: 'account',
        label: 'Account',
        type: 'text',
        required: true,
        help: 'Global (U…), Prime (5–10 digits), or paper (17 digits). Paper only if you intend to ingest sim.',
      },
      {
        id: 'license',
        label: 'License',
        type: 'text',
        required: true,
        help: 'e.g. TBSG, TBHK, TBNZ. Must match the developer portal license.',
      },
      {
        id: 'private_key',
        label: 'RSA private key',
        type: 'secret',
        required: true,
        widget: 'textarea',
        format: 'pem',
        help: 'Shown once at developer registration. PKCS#1 or PKCS#8 PEM. Never echoed.',
      },
      {
        id: 'token',
        label: 'TBHK token',
        type: 'secret',
        required: false,
        help: 'Required for TBHK (~30-day). Paste-rotate when expired. Other licenses omit.',
      },
      {
        id: 'secret_key',
        label: 'Institutional secret key',
        type: 'secret',
        required: false,
        help: 'Institutional accounts only. Individuals leave blank.',
      },
    ],
    helpNotes: [
      'Optional IP whitelist: if Settings shows an egress IPv4, paste it on the developer portal. Rotating egress without a whitelist is fine; a stale whitelist fails like IBKR 1013.',
      'Invage never places or cancels orders. Do not paste a paper account unless you want sim lots on channel tiger.',
    ],
    helpSteps: [
      'Open a funded Tiger account and sign the API agreement at https://developer.itigerup.com/profile.',
      'Generate the RSA key pair on that page. Copy tiger_id and the private key (shown once).',
      'Copy the trading account id and license (TBSG for Singapore live; TBHK needs the extra token file).',
      'TBHK only: generate the token, paste it here, and rotate before it expires (~30 days). Invage does not auto-refresh in v1.',
    ],
    helpHref: 'https://docs-en.itigerup.com/docs/prepare',
    helpHrefLabel: 'Tiger OpenAPI docs',
    ipWhitelistHelp: true,
  },
  {
    id: 'moomoo',
    displayName: 'MooMoo',
    channel: 'moomoo',
    capability:
      'Read-only moomoo Cloud Open API (not the local OpenD gateway). Pulls a live snapshot of stock and listed option lots plus per-currency cash into channel moomoo. Cannot trade or submit orders. Requests trade:read only. Snapshot time is the UTC date of Sync. Dashboard marks stay Yahoo. Option fill history is not imported (IBKR Flex Trades only). Channel moomoo is not jude_futu — existing Futu-tagged lots and FDs stay until you move them.',
    credentialFields: [
      {
        id: 'app_key',
        label: 'AppKey ID',
        type: 'text',
        required: true,
        help: 'From https://open.moomoo.com/dashboard User Center.',
      },
      {
        id: 'private_key',
        label: 'AppKey private key',
        type: 'secret',
        required: true,
        widget: 'textarea',
        format: 'pem',
        help: 'Local private key matching the public key uploaded for the AppKey. Ed25519 or RSA. Never echoed.',
      },
      {
        id: 'acc_id',
        label: 'Trading account ID',
        type: 'text',
        required: false,
        help: 'Optional. Required when more than one authorized trading account exists.',
      },
      {
        id: 'sign_alg',
        label: 'Signature algorithm',
        type: 'text',
        required: false,
        help: 'Ed25519 (default) or RSA-SHA256. Must match the AppKey.',
      },
    ],
    helpNotes: [
      'Do not install OpenD and do not unlock trade. Invage talks only to https://webapi.moomoo.com.',
      'jude_futu is a manual custody tag. Enabling moomoo does not move those lots or FDs.',
    ],
    helpSteps: [
      'Log in at https://open.moomoo.com/dashboard and open User Center.',
      'Create an AppKey, upload the public key, keep the private key local.',
      'Paste AppKey ID and private key here. Do not grant trading on the key if the dashboard offers a split.',
      'If Sync says multiple authorized accounts, paste acc_id from Get Authorized Trading Accounts.',
    ],
    helpHref: 'https://open.moomoo.com/api/overview/getting-started',
    helpHrefLabel: 'moomoo OpenAPI docs',
    ipWhitelistHelp: false,
  },
  {
    id: 'webull',
    displayName: 'Webull',
    channel: 'webull',
    capability:
      'Read-only Webull OpenAPI. Pulls a live snapshot of equity and single-leg listed option lots plus per-currency cash into channel webull. Cannot trade or submit orders. Snapshot time is the UTC date of Sync. Dashboard marks stay Yahoo. Combo/multi-leg options are skipped. Option fill history is not imported (IBKR Flex Trades only). Paper/sandbox hosts are not used.',
    credentialFields: [
      {
        id: 'app_key',
        label: 'App Key',
        type: 'text',
        required: true,
        help: 'From Developer Tool → API Keys Management on the Webull website for your license.',
      },
      {
        id: 'app_secret',
        label: 'App Secret',
        type: 'secret',
        required: true,
        help: 'Shown when you Generate Key. Never echoed. Used only to sign requests (not sent as a header).',
      },
      {
        id: 'region',
        label: 'Region',
        type: 'text',
        required: true,
        help: 'License host: us, hk, jp, sg, th, au, my, uk, or eu. Must match the site where you created the key.',
      },
      {
        id: 'account_id',
        label: 'Account ID',
        type: 'text',
        required: false,
        help: 'Optional. Required when more than one brokerage account is on the key.',
      },
      {
        id: 'access_token',
        label: 'Access token',
        type: 'secret',
        required: false,
        help: 'Paste if Sync says Webull requires an access token (in-app 2FA). Rotate when it expires. Invage does not poll the Webull app.',
      },
    ],
    helpNotes: [
      'Invage never places or cancels orders. App Secret is HMAC-only; it is not sent in HTTP headers.',
      'US individual API applications typically need about $100 net account value and a 1–2 business day review.',
      'Institutional IP whitelist: if Settings shows an egress IPv4, paste it in the Webull portal. Individuals usually skip the whitelist.',
    ],
    helpSteps: [
      'Open the official Webull website for your license (for example webull.com, webull.hk, or webull.com.sg) and sign in.',
      'Avatar → Developer Tool → My Application. Submit the API application and wait for approval (often 1–2 business days).',
      'API Keys Management → register the app → Generate Key. Copy App Key and App Secret (secret shown once).',
      'Paste App Key, App Secret, and region (us / hk / sg / … matching that site). Save, then Sync.',
      'If Sync says multiple accounts, paste account_id from the account list. If it asks for an access token, approve the request in the Webull app (or paste the token) and Sync again.',
    ],
    helpHref: 'https://developer.webull.com/apis/docs/getting-started',
    helpHrefLabel: 'Webull OpenAPI docs',
    ipWhitelistHelp: false,
  },
];

export function getBrokerConnector(id: string): BrokerConnectorDef {
  const found = BROKER_CATALOG.find((c) => c.id === id);
  if (!found) {
    throw new Error(`Unknown broker connector "${id}".`);
  }
  return found;
}

export function assertIbkrChannelMatchesCatalog(): void {
  const ibkr = getBrokerConnector('ibkr');
  if (ibkr.channel !== IBKR_CHANNEL) {
    throw new Error(
      `IBKR catalog channel "${ibkr.channel}" must equal IBKR_CHANNEL "${IBKR_CHANNEL}".`,
    );
  }
}

export function assertCatalogChannelEqualsId(): void {
  for (const def of BROKER_CATALOG) {
    if (def.channel !== def.id) {
      throw new Error(`Catalog connector "${def.id}" channel "${def.channel}" must equal id.`);
    }
  }
}
