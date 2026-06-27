import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { resolveDataRoot } from '../config.js';
import { resolveUserByTelegramUser } from '../state/index.js';
import { fetchPrices } from '../market/index.js';
import type { Holding } from '../market/index.js';

function ok<T>(text: string, details: T): AgentToolResult<T> {
  return { content: [{ type: 'text' as const, text }], details };
}
function fail(text: string): AgentToolResult<null> {
  return { content: [{ type: 'text' as const, text }], details: null };
}
function failFrom(error: unknown): AgentToolResult<null> {
  return fail(error instanceof Error ? error.message : String(error));
}

interface SnapshotPosition {
  ticker: string;
  avgCost: number;
  units: number;
  price: number;
  cost: number;
  value: number;
  pl: number;
  plPct: number;
}

interface Snapshot {
  date: string;
  totalValue: number;
  totalCost: number;
  totalPL: number;
  totalPLPct: number;
  positions: SnapshotPosition[];
}

export function createSnapshotTool(): AgentTool[] {
  const saveSnapshot: AgentTool = {
    name: 'save_snapshot',
    label: 'Save Snapshot',
    description: 'Take a portfolio snapshot — fetches current prices, computes P/L for each position, and saves a JSON file to InvesterDrive. Use this periodically to track portfolio performance over time.',
    parameters: Type.Object({
      telegram_user_id: Type.Number({ description: 'Telegram user ID from the message context.' }),
    }),
    async execute(_id, raw) {
      const { telegram_user_id } = raw as { telegram_user_id: number };
      try {
        const state = resolveUserByTelegramUser(telegram_user_id);
        if (!state) return fail(`No user linked to Telegram ID ${telegram_user_id}.`);

        const portfolio = (state as unknown as { portfolio?: Record<string, Holding> }).portfolio;
        if (!portfolio || Object.keys(portfolio).length === 0) {
          return fail(`No portfolio saved. Use add_holding to build a portfolio first.`);
        }

        const tickers = Object.keys(portfolio);
        const prices = await fetchPrices(tickers);

        const positions: SnapshotPosition[] = tickers.map(ticker => {
          const h = portfolio[ticker];
          const price = prices[ticker] ?? 0;
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

        const totalValue = positions.reduce((s, p) => s + p.value, 0);
        const totalCost = positions.reduce((s, p) => s + p.cost, 0);
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

        // Update history index
        const indexPath = join(driveDir, 'snapshots.json');
        let history: string[] = [];
        if (existsSync(indexPath)) {
          try { history = JSON.parse(readFileSync(indexPath, 'utf-8')); } catch {}
        }
        if (!history.includes(fileName)) {
          history.push(fileName);
          writeFileSync(indexPath, JSON.stringify(history, null, 2), 'utf-8');
        }

        const sign = totalPL >= 0 ? '+' : '';
        return ok(
          `Snapshot saved as "${fileName}".\n` +
          `Total Value: $${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n` +
          `Total P/L: ${sign}${totalPL.toFixed(1)}% ($${totalPL.toFixed(2)})\n` +
          `${positions.length} positions recorded.`,
          { fileName, totalValue, totalPL, totalPLPct: snapshot.totalPLPct, positions: positions.length }
        );
      } catch (e) { return failFrom(e); }
    },
  };

  const listSnapshots: AgentTool = {
    name: 'list_snapshots',
    label: 'List Snapshots',
    description: 'List all saved portfolio snapshots. Shows dates and P/L summary for each.',
    parameters: Type.Object({
      telegram_user_id: Type.Number({ description: 'Telegram user ID from the message context.' }),
    }),
    async execute(_id, raw) {
      const { telegram_user_id } = raw as { telegram_user_id: number };
      try {
        const state = resolveUserByTelegramUser(telegram_user_id);
        if (!state) return fail(`No user linked to Telegram ID ${telegram_user_id}.`);

        const indexPath = join(resolveDataRoot(), 'drive', state.user.slug, 'snapshots.json');
        if (!existsSync(indexPath)) return fail('No snapshots saved yet. Use save_snapshot first.');

        const history: string[] = JSON.parse(readFileSync(indexPath, 'utf-8'));
        if (history.length === 0) return fail('No snapshots saved yet.');

        const lines = history.map((fileName, i) => {
          const filePath = join(resolveDataRoot(), 'drive', state.user.slug, fileName);
          if (!existsSync(filePath)) return `  ${i + 1}. ${fileName} (file missing)`;
          const snap: Snapshot = JSON.parse(readFileSync(filePath, 'utf-8'));
          const sign = snap.totalPL >= 0 ? '+' : '';
          return `  ${i + 1}. ${snap.date} — Value: $${snap.totalValue.toFixed(2)}, P/L: ${sign}${snap.totalPLPct.toFixed(1)}% (${snap.positions.length} positions)`;
        });

        return ok(`${history.length} snapshot(s):\n${lines.join('\n')}`, { count: history.length, files: history });
      } catch (e) { return failFrom(e); }
    },
  };

  return [saveSnapshot, listSnapshots];
}
