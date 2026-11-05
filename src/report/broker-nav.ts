import type { BrokerConnectionMetrics } from '../state/portfolio-state.js';
import type { LiveDashboardSlice } from './dashboard-model.js';
export interface NavSource { channel: string; basis: 'broker' | 'calculated'; amount: number; currency: string; asOf: string | null; convertedAmount: number; fxRate: number; }
/** A broker account total replaces that account's component sum, never adds to it. */
export function applyBrokerNav(live: LiveDashboardSlice, metrics: Record<string, BrokerConnectionMetrics>) {
  const rep = live.reportingCurrency;
  if (!rep) return;
  for (const [channel, m] of Object.entries(metrics)) {
    if (m.broker_net_assets === undefined || !Number.isFinite(m.broker_net_assets)) continue;
    const fx = m.currency === rep ? 1 : live.fxRates?.[m.currency];
    if (fx === undefined || !Number.isFinite(fx) || fx <= 0) continue;
    let row = live.byChannel.find(r => r.channel === channel);
    if (!row) {
      // Account totals can exist without itemized holdings or cash.
      row = { channel, positionCount: 0, equityCount: 0, optionCount: 0, fundCount: 0, positionsValue: 0, totalCost: 0, totalPL: 0, totalPLPct: 0,
        cashAmount: null, cashCurrency: null, depositsAmount: 0, depositsCurrency: null, depositCount: 0, totalValue: 0, cashWeightPct: null,
        equityValue: 0, equityCost: 0, optionsPremiumCollected: 0, optionsPremiumPaid: 0, contingentCashObligation: 0, contingentShareObligation: 0 };
      live.byChannel.push(row); if (!live.channels.includes(channel)) live.channels.push(channel);
    }
    row.itemizedTotalValue ??= row.totalValue;
    row.totalValue = m.broker_net_assets * fx;
    if (m.currency !== rep) live.fxApplied = true;
    row.navSources = [{ channel, basis: 'broker', amount: m.broker_net_assets, currency: m.currency, asOf: m.source_as_of ?? m.as_of, convertedAmount: row.totalValue, fxRate: fx }];
    row.navComplete = true;
    if (m.broker_cash !== undefined) { row.cashAmount = m.broker_cash * fx; row.cashCurrency = rep; }
    if (row.cashAmount !== null) row.cashWeightPct = row.totalValue === 0 ? 0 : row.cashAmount / row.totalValue * 100;
  }
  if (!live.byChannel.some(row => row.navSources?.length)) return;
  live.itemizedTotalValue ??= live.totalValue;
  live.totalValue = live.byChannel.reduce((sum, row) => sum + row.totalValue, 0);
  if (live.byChannel.every(row => row.cashAmount !== null)) {
    live.cashAmount = live.byChannel.reduce((sum, row) => sum + row.cashAmount!, 0); live.cashCurrency = rep;
  }
  live.navSources = live.byChannel.flatMap(row => row.navSources ?? [{ channel: row.channel, basis: 'calculated' as const, amount: row.totalValue,
    currency: rep, asOf: null, convertedAmount: row.totalValue, fxRate: 1 }]);
  live.navComplete = live.byChannel.every(row => row.navComplete !== false);
  if (live.cashAmount !== null) live.cashWeightPct = live.totalValue === 0 ? 0 : live.cashAmount / live.totalValue * 100;
}
