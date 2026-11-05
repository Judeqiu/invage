import type { Holding, BrokerPositionValues } from '../market/types.js';
/** Native broker fields only. Never reconstruct an absent reported total. */
export function retainBrokerPositionValues(holding: Holding, currency: string, source: string, asOf: string,
  values: Partial<Pick<BrokerPositionValues,'mark'|'market_value'|'position_pl'|'position_pl_pct'|'unrealized_pl'|'realized_pl'>>) {
  const known = Object.fromEntries(Object.entries(values).filter(([,value]) => value !== undefined));
  if (!Object.keys(known).length) return;
  if (Object.values(known).some(value => typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Invalid reported broker position value');
  holding.broker_values = {source,as_of:asOf,currency,units:holding.units,avg_price:holding.avg_price,...(holding.option ? {option_contract:structuredClone(holding.option)} : {}),...known};
}
