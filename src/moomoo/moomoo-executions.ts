import type { BrokerLot } from '../brokers/statement.js';
import { optionExecutionsFromHistory } from '../brokers/history.js';
import { mapMooMooHistory } from './moomoo-history.js';
import type { MooMooRawBundle } from './moomoo-types.js';

/** Compatibility projection; unresolved and security fills remain in shared history. */
export function mapMooMooExecutions(bundle: MooMooRawBundle, lots: BrokerLot[], channel: string) {
  const history = mapMooMooHistory(bundle, lots, channel);
  return history ? optionExecutionsFromHistory(history) : undefined;
}
