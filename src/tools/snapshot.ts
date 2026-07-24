import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { resolveDataRoot } from 'utarus';
import { equityKeys, fetchPrices, valuePortfolio } from '../market/index.js';
import { getPortfolio } from '../state/portfolio-state.js';
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
        const state = resolveInvestorFromChannel(p);

        const portfolio = getPortfolio(state);
        if (Object.keys(portfolio).length === 0) {
          return fail('No portfolio saved. Use add_holding to build a portfolio first.');
        }

        const eqKeys = equityKeys(portfolio);
        const prices = eqKeys.length > 0 ? await fetchPrices(eqKeys) : {};
        const economics = valuePortfolio(portfolio, prices);

        const positions: SnapshotPosition[] = economics.map((e) => ({
          ticker: e.key,
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
          ...(e.option ? { option: e.option } : {}),
        }));

        const totalValue = positions.reduce((s, pos) => s + pos.value, 0);
        const totalCost = positions.reduce((s, pos) => s + pos.cost, 0);
        const totalPL = totalValue - totalCost;

        let equityValue = 0;
        let equityCost = 0;
        let contingentCashObligation = 0;
        let optionsPremiumCollected = 0;
        let optionsPremiumPaid = 0;
        for (const e of economics) {
          if (e.instrument === 'equity') {
            equityValue += e.value;
            equityCost += e.cost;
          } else {
            contingentCashObligation += e.contingentCashObligation;
            if (e.option?.side === 'short') optionsPremiumCollected += e.premiumAbsolute;
            else optionsPremiumPaid += e.premiumAbsolute;
          }
        }

        const snapshot: Snapshot = {
          date: new Date().toISOString().slice(0, 10),
          totalValue,
          totalCost,
          totalPL,
          totalPLPct: totalCost !== 0 ? (totalPL / Math.abs(totalCost)) * 100 : 0,
          positions,
          contingentCashObligation,
          optionsPremiumCollected,
          optionsPremiumPaid,
          equityValue,
          equityCost,
        };

        const slug = state.user.slug;
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
        const obligationNote =
          contingentCashObligation > 0
            ? `\nContingent cash obligation (short puts): $${contingentCashObligation.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
            : '';
        return ok(
          `Snapshot saved as "${fileName}".\n` +
            `Total Value: $${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n` +
            `Total P/L: ${sign}$${totalPL.toFixed(2)} (${sign}${snapshot.totalPLPct.toFixed(1)}%)\n` +
            `${positions.length} positions recorded.` +
            obligationNote,
          {
            fileName,
            totalValue,
            totalPL,
            totalPLPct: snapshot.totalPLPct,
            positions: positions.length,
            contingentCashObligation,
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
        const state = resolveInvestorFromChannel(p);
        const files = loadSnapshotIndex(state.user.slug);
        if (files.length === 0) {
          return fail('No snapshots saved yet. Use save_snapshot first.');
        }

        const snaps = loadSnapshots(state.user.slug);
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
