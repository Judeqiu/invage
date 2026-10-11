import {
  readIbkrConnectionConfig,
  writeIbkrConnectionFromTool,
} from '../brokers/connections.js';
import type { InvestorState } from '../state/portfolio-state.js';
import { IBKR_CHANNEL } from './flex-map.js';

export interface IbkrFlexConfig {
  token: string;
  activity_query_id: string;
  tradeconf_query_id?: string;
}

export function readIbkrFlexConfig(state: InvestorState): IbkrFlexConfig {
  return readIbkrConnectionConfig(state);
}

export function writeIbkrFlexConfig(state: InvestorState, cfg: IbkrFlexConfig): void {
  writeIbkrConnectionFromTool(state, cfg);
}

export function ibkrChannel(): string {
  return IBKR_CHANNEL;
}
