import { refreshPortfolioAfterSync } from './projection-events.js';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { resolveDataRoot } from 'utarus';
import { readBrokerAccountModel } from '../brokers/accounts.js';
import { latestSuccessfulBrokerSyncRun } from '../brokers/sync-history.js';
import { resolvePortfolioMarket } from '../market/index.js';
import { fetchFxRates } from '../market/fetch-fx.js';
import { buildLivePositions, type DashboardFxOptions } from '../report/dashboard-model.js';
import { getCashes, getDeposits, getPortfolio } from '../state/portfolio-state.js';
import {
  getReportingCurrency,
  type HouseholdInvestorState,
} from '../state/household-state.js';
import {
  type Snapshot,
  type SnapshotPosition,
} from '../state/snapshot.js';
import type { InvestorState } from '../state/portfolio-state.js';

/** Shared valuation and persistence for manual and scheduled snapshots. */
export async function capturePortfolioSnapshot(state: InvestorState, date = new Date().toISOString().slice(0, 10), options: { allowEmpty?: boolean } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))) {
    throw new Error('Invalid snapshot date.');
  }
  const portfolio = getPortfolio(state);
  if (!options.allowEmpty && Object.keys(portfolio).length === 0 && getCashes(state).length === 0 && getDeposits(state).length === 0) {
    throw new Error('No portfolio saved. Use add_holding to build a portfolio first.');
  }

  const { portfolio: valued, equityPrices, optionMarks } =
    await resolvePortfolioMarket(portfolio);
  const cashes = getCashes(state);
  const deposits = getDeposits(state);
  const rep = getReportingCurrency(state as HouseholdInvestorState);
  const currencies = [...new Set([
    ...Object.values(valued).map((holding) => holding.currency).filter((c): c is string => !!c),
    ...cashes.filter((c) => c.amount !== 0).map((c) => c.currency),
    ...deposits.filter((d) => d.amount !== 0).map((d) => d.currency),
  ])];
  const foreign = currencies.filter((currency) => currency !== rep);
  const fx: DashboardFxOptions = {
    reportingCurrency: rep, fxRates: foreign.length ? await fetchFxRates(foreign, rep) : {},
  };
  const live = buildLivePositions(valued, equityPrices, optionMarks,
    cashes.map((c) => ({ amount: c.amount, currency: c.currency, channel: c.channel })),
    deposits, undefined, fx, { reportingCurrency: rep, allowEmpty: true });
  if (live.navComplete === false) throw new Error('Snapshot NAV incomplete: provide all holding currencies.');
  const positions: SnapshotPosition[] = live.positions.map((e) => ({
    ticker: e.ticker,
    ...(e.currency ? { currency: e.currency } : {}),
    avgCost: e.avgCost,
    units: e.units,
    price: e.price,
    cost: e.cost,
    value: e.value,
    pl: e.pl,
    plPct: e.plPct,
    instrument: e.instrument,
    label: e.label,
    premiumAbsolute: e.premiumAbsolute,
    contingentCashObligation: e.contingentCashObligation,
    contingentShareObligation: e.contingentShareObligation,
    ...(e.channel != null ? { channel: e.channel } : {}),
    ...(e.option ? { option: e.option } : {}),
    ...(e.fund
      ? {
          fund: {
            quote_source: e.fund.quote_source,
            ...(e.fund.mark != null ? { mark: e.fund.mark } : {}),
            ...(e.fund.name != null ? { name: e.fund.name } : {}),
          },
          markSource: e.fund.quote_source,
        }
      : {}),
    ...(optionMarks[e.ticker]
      ? {
          markSource: optionMarks[e.ticker].source,
          contractSymbol: optionMarks[e.ticker].contractSymbol,
        }
      : {}),
  }));

  const positionsValue = live.positionsValue;
  const totalCost = live.totalCost;
  const cash = live.cashAmount == null ? null : { amount: live.cashAmount, currency: live.cashCurrency! };
  const totalValue = live.totalValue;
  // P/L is on invested positions only; cash is dry powder, not a P/L line.
  const totalPL = positionsValue - totalCost;

  let equityValue = 0;
  let equityCost = 0;
  let contingentCashObligation = 0;
  let optionsPremiumCollected = 0;
  let optionsPremiumPaid = 0;
  for (const e of live.positions) {
    if (e.instrument === 'option') {
      contingentCashObligation += e.contingentCashObligation;
      if (e.option?.side === 'short') optionsPremiumCollected += e.premiumAbsolute;
      else optionsPremiumPaid += e.premiumAbsolute;
    } else {
      // Equity + fund MTM in non-option asset totals.
      equityValue += e.value;
      equityCost += e.cost;
    }
  }

  const connections = Object.values(readBrokerAccountModel(state).connections);
  const brokerAsOf = Object.fromEntries(connections
    .filter(conn => conn.last_sync?.ok && conn.last_sync.as_of)
    .map(conn => [conn.channel, conn.last_sync!.as_of!]));
  for (const conn of connections) {
    const prior = latestSuccessfulBrokerSyncRun(state.user.id, conn.channel);
    if (prior?.as_of) brokerAsOf[conn.channel] = prior.as_of;
  }
  for (const row of [...(state.option_observations ?? [])]
    .filter(item => item.source === 'broker')
    .sort((a, b) => a.observed_at.localeCompare(b.observed_at))) {
    brokerAsOf[row.channel] = row.as_of;
  }
  const snapshot: Snapshot = {
    date,
    ...(live.reportingCurrency ? { reportingCurrency: live.reportingCurrency } : {}),
    ...(live.fxRates && Object.keys(live.fxRates).length > 0
      ? { fxRates: live.fxRates, fxCapturedAt: new Date().toISOString() } : {}),
    totalValue,
    totalCost,
    totalPL,
    totalPLPct: totalCost !== 0 ? (totalPL / Math.abs(totalCost)) * 100 : 0,
    positions,
    deposits: live.deposits,
    depositsAmount: live.depositsAmount,
    depositsCurrency: live.depositsCurrency ?? undefined,
    positionsValue,
    contingentCashObligation,
    optionsPremiumCollected,
    optionsPremiumPaid,
    equityValue,
    equityCost,
    brokerAsOf,
    ...(cash != null
      ? {
          cashAmount: cash.amount,
          cashCurrency: cash.currency,
          // Single channel only; multi-channel total omits cashChannel
          // (per-channel cash is on live dashboard byChannel, not snapshot).
          ...(cashes.length === 1 && cashes[0].channel != null
            ? { cashChannel: cashes[0].channel }
            : {}),
        }
      : {}),
  };

  const slug = state.user.id;
  const driveDir = join(resolveDataRoot(), 'drive', slug);
  mkdirSync(driveDir, { recursive: true });

  const fileName = `snapshot-${snapshot.date}.json`;
  writeFileSync(join(driveDir, fileName), JSON.stringify(snapshot, null, 2), 'utf-8');

  const indexPath = join(driveDir, 'snapshots.json');
  let history: string[] = [];
  if (existsSync(indexPath)) {
    history = JSON.parse(readFileSync(indexPath, 'utf-8')) as string[];
  }
  if (!history.includes(fileName)) {
    history.push(fileName);
    writeFileSync(indexPath, JSON.stringify(history, null, 2), 'utf-8');
  }
  const aggregation = await refreshPortfolioAfterSync(state.user.id, true);
  if (aggregation.status === 'failed') throw new Error('Snapshot saved, but portfolio calculations failed. Retry to finish preparing the saved totals.');
  return { aggregation, snapshot, fileName, live, cash, contingentCashObligation, positionsValue, totalPL, totalValue, positions };
}
