/**
 * Connector catalog — capability descriptions keyed by id.
 * Selection is catalog.get(id), never keyword matching on user text.
 */

import { IBKR_CHANNEL } from '../ibkr/flex-map.js';

export type CredentialFieldType = 'secret' | 'text';

export interface CredentialFieldDef {
  id: string;
  label: string;
  type: CredentialFieldType;
  required: boolean;
  help?: string;
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
    syncQueryFieldId: 'activity_query_id',
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
