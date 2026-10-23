import type { InvestorState } from '../state/portfolio-state.js';
import { capturePortfolioSnapshot } from '../state/capture-snapshot.js';
import { readBrokerAccountModel } from './accounts.js';

/** Shared eligibility and identity checks for scheduled and user-triggered batches. */
export function brokerBatchAccounts(state: InvestorState): Record<string, string> {
  return Object.fromEntries(Object.entries(readBrokerAccountModel(state).connections)
    .filter(([, conn]) => conn.enabled && conn.account_id)
    .map(([id, conn]) => [id, JSON.stringify([conn.broker_id, conn.source_id, conn.account_id, conn.channel])]));
}
export const captureBrokerBatchSnapshot = (state: InvestorState, date: string) =>
  capturePortfolioSnapshot(state, date, { allowEmpty: true });

/** A partial import or changed account binding cannot publish a complete batch snapshot. */
export async function finishBrokerSyncBatch(state: InvestorState, date: string,
  synced: Record<string, string>, capture = captureBrokerBatchSnapshot) {
  const current = brokerBatchAccounts(state);
  if (!Object.keys(current).length || !Object.entries(current).every(([id, key]) => synced[id] === key)) return null;
  return await capture(state, date);
}
