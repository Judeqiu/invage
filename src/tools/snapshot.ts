import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { resolveDataRoot } from 'utarus';
import { fetchPrices } from '../market/index.js';
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
      'Take a portfolio snapshot and save JSON to BinDrive. Pass telegram_user_id or slack_user_id from the message context.',
    parameters: Type.Object({ ...channelIdParams }),
    async execute(_id, raw) {
      const p = raw as ChannelIds;
      try {
        const state = resolveInvestorFromChannel(p);

        const portfolio = getPortfolio(state);
        if (Object.keys(portfolio).length === 0) {
          return fail('No portfolio saved. Use add_holding to build a portfolio first.');
        }

        const tickers = Object.keys(portfolio);
        const prices = await fetchPrices(tickers);

        const positions: SnapshotPosition[] = tickers.map((ticker) => {
          const h = portfolio[ticker];
          const price = prices[ticker];
          if (price == null) {
            throw new Error(`Missing market price for ${ticker}. Cannot save snapshot.`);
          }
          const cost = h.avg_price * h.units;
          const value = price * h.units;
          const pl = value - cost;
          return {
            ticker,
            avgCost: h.avg_price,
            units: h.units,
            price,
            cost,
            value,
            pl,
            plPct: cost > 0 ? (pl / cost) * 100 : 0,
          };
        });

        const totalValue = positions.reduce((s, pos) => s + pos.value, 0);
        const totalCost = positions.reduce((s, pos) => s + pos.cost, 0);
        const totalPL = totalValue - totalCost;

        const snapshot: Snapshot = {
          date: new Date().toISOString().slice(0, 10),
          totalValue,
          totalCost,
          totalPL,
          totalPLPct: totalCost > 0 ? (totalPL / totalCost) * 100 : 0,
          positions,
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
        return ok(
          `Snapshot saved as "${fileName}".\n` +
            `Total Value: $${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n` +
            `Total P/L: ${sign}$${totalPL.toFixed(2)} (${sign}${snapshot.totalPLPct.toFixed(1)}%)\n` +
            `${positions.length} positions recorded.`,
          {
            fileName,
            totalValue,
            totalPL,
            totalPLPct: snapshot.totalPLPct,
            positions: positions.length,
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
