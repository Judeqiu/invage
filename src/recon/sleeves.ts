import { BROKER_CATALOG, getBrokerConnector } from '../brokers/catalog.js';
import { readBrokerConnections } from '../brokers/connections.js';
import {
  cashSlotKey,
  getCashes,
  getDeposits,
  getPortfolio,
  type InvestorState,
} from '../state/portfolio-state.js';

/** Custody tags in walk order. Empty string = unassigned. */
export function listReconChannels(state: InvestorState): string[] {
  const keys = new Set<string>();
  for (const c of getCashes(state)) keys.add(cashSlotKey(c.channel));
  for (const h of Object.values(getPortfolio(state))) keys.add(cashSlotKey(h.channel));
  for (const d of getDeposits(state)) keys.add(cashSlotKey(d.channel));
  const conns = readBrokerConnections(state);
  for (const [id, conn] of Object.entries(conns)) {
    if (!conn.enabled) continue;
    const def = getBrokerConnector(id);
    keys.add(cashSlotKey(def.channel));
  }
  const catalogOrder = BROKER_CATALOG.map((c) => c.channel);
  const named = [...keys].filter((k) => k.length > 0);
  named.sort((a, b) => {
    const ia = catalogOrder.indexOf(a);
    const ib = catalogOrder.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.localeCompare(b);
  });
  if (keys.has('')) named.push('');
  return named;
}

export function formatReconChannel(channel: string): string {
  return channel.length > 0 ? channel : '(unassigned)';
}
