import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
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
  getTreasury,
  type HouseholdInvestorState,
} from '../state/household-state.js';
import {
  loadSnapshotIndex,
  loadSnapshots,
  type Snapshot,
  type SnapshotPosition,
} from '../state/snapshot.js';
import {
  channelIdParams,
  resolveInvestorFromChannel,
  type ChannelIds,
} from './channel.js';

function ok<T>(text: string, details: T): AgentToolResult<T> {
  return { content: [{ type: 'text' as const, text }], details };
}
function fail(text: string): AgentToolResult<null> {
  return { content: [{ type: 'text' as const, text }], details: null };
}
function failFrom(error: unknown): AgentToolResult<null> {
  return fail(error instanceof Error ? error.message : String(error));
}

export function createSnapshotReadTools(): AgentTool[] {
  return createSnapshotTool().filter((t) => t.name === 'list_snapshots');
}

export function createSnapshotWriteTools(): AgentTool[] {
  return createSnapshotTool().filter((t) => t.name === 'save_snapshot');
}

/** Full snapshot tools (save + list). Bookkeeper owns save. */
export function createSnapshotTool(): AgentTool[] {
  const saveSnapshot: AgentTool = {
    name: 'save_snapshot',
    label: 'Save Snapshot',
    description:
      'Take a portfolio snapshot (equities + options MTM) and save JSON to BinDrive. ' +
      'Pass telegram_user_id or slack_user_id from the message context.',
    parameters: Type.Object({ ...channelIdParams }),
    async execute(_id, raw) {
      const p = raw as ChannelIds;
      try {
        const { state } = await resolveInvestorFromChannel(p);

        const portfolio = getPortfolio(state);
        if (Object.keys(portfolio).length === 0) {
          return fail('No portfolio saved. Use add_holding to build a portfolio first.');
        }

        const { portfolio: valued, equityPrices, optionMarks } =
          await resolvePortfolioMarket(portfolio);
        const cashes = getCashes(state);
        const deposits = getDeposits(state);
        const rep = getTreasury(state as HouseholdInvestorState)?.reporting_currency ?? null;
        const currencies = [...new Set([
          ...Object.values(valued).map((holding) => holding.currency).filter((c): c is string => !!c),
          ...cashes.filter((c) => c.amount !== 0).map((c) => c.currency),
          ...deposits.filter((d) => d.amount !== 0).map((d) => d.currency),
        ])];
        let fx: DashboardFxOptions | undefined;
        if (rep) {
          const foreign = currencies.filter((currency) => currency !== rep);
          fx = { reportingCurrency: rep, fxRates: foreign.length ? await fetchFxRates(foreign, rep) : {} };
        }
        const live = buildLivePositions(valued, equityPrices, optionMarks,
          cashes.map((c) => ({ amount: c.amount, currency: c.currency, channel: c.channel })),
          deposits, undefined, fx, { reportingCurrency: rep ?? undefined });
        if (live.navComplete === false) throw new Error('Snapshot NAV incomplete: set a reporting currency and provide all holding currencies.');
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
          date: new Date().toISOString().slice(0, 10),
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

        const sign = totalPL >= 0 ? '+' : '';
        const ccy = live.reportingCurrency ?? cash?.currency ?? '';
        const formatMoney = (amount: number) => `${amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${ccy}`.trim();
        const obligationNote =
          contingentCashObligation > 0
            ? `\nContingent cash obligation (short puts): ${formatMoney(contingentCashObligation)}`
            : '';
        const cashNote =
          cash != null
            ? `\nCash: ${cash.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${cash.currency}` +
              `\nPositions MTM: ${formatMoney(positionsValue)}`
            : `\nCash: not recorded (NAV includes positions${live.depositsAmount ? ' and fixed deposits' : ''}). Use set_cash to include dry powder.`;
        return ok(
          `Snapshot saved as "${fileName}".\n` +
          `Total Value (NAV): ${formatMoney(totalValue)}\n` +
            `Positions P/L: ${sign}${formatMoney(totalPL)} (${sign}${snapshot.totalPLPct.toFixed(1)}%)\n` +
            `${positions.length} positions recorded.` +
            cashNote +
            obligationNote,
          {
            fileName,
            totalValue,
            positionsValue,
            totalPL,
            totalPLPct: snapshot.totalPLPct,
            positions: positions.length,
            contingentCashObligation,
            cash,
          },
        );
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const listSnapshots: AgentTool = {
    name: 'list_snapshots',
    label: 'List Snapshots',
    description:
      'List all saved portfolio snapshots. Pass telegram_user_id or slack_user_id from the message context.',
    parameters: Type.Object({ ...channelIdParams }),
    async execute(_id, raw) {
      const p = raw as ChannelIds;
      try {
        const { state } = await resolveInvestorFromChannel(p);
        const files = loadSnapshotIndex(state.user.id);
        if (files.length === 0) {
          return fail('No snapshots saved yet. Use save_snapshot first.');
        }

        const snaps = loadSnapshots(state.user.id);
        const lines = snaps.map((snap, i) => {
          const sign = snap.totalPL >= 0 ? '+' : '';
          return `  ${i + 1}. ${snap.date} — Value: $${snap.totalValue.toFixed(2)}, P/L: ${sign}${snap.totalPLPct.toFixed(1)}% (${snap.positions.length} positions)`;
        });

        return ok(`${snaps.length} snapshot(s):\n${lines.join('\n')}`, {
          count: snaps.length,
          files,
        });
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  return [saveSnapshot, listSnapshots];
}
