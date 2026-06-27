import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import {
  loadState,
  saveState,
  resolveUserByTelegramUser,
  type UserState,
} from '../state/index.js';
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

interface PortfolioState {
  portfolio: Record<string, Holding>;
}

function getPortfolio(state: UserState): Record<string, Holding> {
  return (state as unknown as PortfolioState).portfolio ?? {};
}

function setPortfolio(state: UserState, portfolio: Record<string, Holding>): void {
  (state as unknown as PortfolioState).portfolio = portfolio;
}

function resolveUser(telegramUserId: number): UserState {
  const state = resolveUserByTelegramUser(telegramUserId);
  if (!state) {
    throw new Error(`No user linked to Telegram ID ${telegramUserId}. User must register first via invite code.`);
  }
  return state;
}

function formatPortfolio(portfolio: Record<string, Holding>): string {
  const tickers = Object.keys(portfolio);
  if (tickers.length === 0) return 'Portfolio is empty. Use add_holding to add positions.';

  let totalCost = 0;
  const lines = [`Portfolio — ${tickers.length} position${tickers.length === 1 ? '' : 's'}:`, ''];

  for (const ticker of tickers) {
    const h = portfolio[ticker];
    const cost = h.avg_price * h.units;
    totalCost += cost;
    lines.push(`  ${ticker.padEnd(8)} | ${h.units} shares @ $${h.avg_price.toFixed(2)} | Cost: $${cost.toFixed(2)} | ${h.category ?? 'Uncategorized'}`);
  }

  lines.push('');
  lines.push(`Total cost basis: $${totalCost.toFixed(2)}`);
  return lines.join('\n');
}

export function createPortfolioTools(): AgentTool[] {
  const addHolding: AgentTool = {
    name: 'add_holding',
    label: 'Add Holding',
    description: 'Add or update a stock position in the user\'s portfolio. If the ticker already exists, updates the average price and units. The telegram_user_id is always from the message context — never ask the user for it.',
    parameters: Type.Object({
      telegram_user_id: Type.Number({ description: 'Telegram user ID from the message context. Used to resolve the user automatically.' }),
      ticker: Type.String({ description: 'Stock ticker symbol (e.g. "AAPL", "MSFT"). Case-insensitive, stored uppercase.' }),
      avg_price: Type.Number({ description: 'Average cost per share in USD.' }),
      units: Type.Number({ description: 'Number of shares owned.' }),
      category: Type.Optional(Type.String({ description: 'Fund category (e.g. "SL Technology S1", "SL Healthcare S1").' })),
    }),
    async execute(_id, raw) {
      const p = raw as { telegram_user_id: number; ticker: string; avg_price: number; units: number; category?: string };
      try {
        if (p.avg_price <= 0) return fail('avg_price must be positive.');
        if (p.units <= 0) return fail('units must be positive.');

        const state = resolveUser(p.telegram_user_id);
        const ticker = p.ticker.toUpperCase();
        const portfolio = getPortfolio(state);
        const isUpdate = ticker in portfolio;

        portfolio[ticker] = {
          avg_price: p.avg_price,
          units: p.units,
          category: p.category ?? portfolio[ticker]?.category,
        };

        setPortfolio(state, portfolio);
        const today = new Date().toISOString().slice(0, 10);
        state.log.push({
          ts: today,
          action: isUpdate ? 'holding_updated' : 'holding_added',
          ticker,
          avg_price: p.avg_price,
          units: p.units,
          category: p.category,
        });
        saveState(state);

        const action = isUpdate ? 'Updated' : 'Added';
        const cost = p.avg_price * p.units;
        return ok(
          `${action} ${ticker}: ${p.units} shares @ $${p.avg_price.toFixed(2)} (cost: $${cost.toFixed(2)})${p.category ? ` [${p.category}]` : ''}`,
          { ticker, avg_price: p.avg_price, units: p.units, category: p.category, isUpdate }
        );
      } catch (e) { return failFrom(e); }
    },
  };

  const removeHolding: AgentTool = {
    name: 'remove_holding',
    label: 'Remove Holding',
    description: 'Remove a stock position from the user\'s portfolio. The telegram_user_id is always from the message context.',
    parameters: Type.Object({
      telegram_user_id: Type.Number({ description: 'Telegram user ID from the message context.' }),
      ticker: Type.String({ description: 'Stock ticker symbol to remove.' }),
    }),
    async execute(_id, raw) {
      const p = raw as { telegram_user_id: number; ticker: string };
      try {
        const state = resolveUser(p.telegram_user_id);
        const ticker = p.ticker.toUpperCase();
        const portfolio = getPortfolio(state);

        if (!(ticker in portfolio)) {
          return fail(`Ticker "${ticker}" not found in portfolio. Current holdings: ${Object.keys(portfolio).join(', ') || 'none'}`);
        }

        const removed = portfolio[ticker];
        delete portfolio[ticker];
        setPortfolio(state, portfolio);
        state.log.push({
          ts: new Date().toISOString().slice(0, 10),
          action: 'holding_removed',
          ticker,
          avg_price: removed.avg_price,
          units: removed.units,
        });
        saveState(state);

        return ok(
          `Removed ${ticker} from portfolio (${removed.units} shares @ $${removed.avg_price.toFixed(2)}).`,
          { ticker, removed }
        );
      } catch (e) { return failFrom(e); }
    },
  };

  const getPortfolioTool: AgentTool = {
    name: 'get_portfolio',
    label: 'Get Portfolio',
    description: 'Retrieve the user\'s saved portfolio. Shows all positions with cost basis. The telegram_user_id is always from the message context.',
    parameters: Type.Object({
      telegram_user_id: Type.Number({ description: 'Telegram user ID from the message context.' }),
    }),
    async execute(_id, raw) {
      const p = raw as { telegram_user_id: number };
      try {
        const state = resolveUser(p.telegram_user_id);
        const portfolio = getPortfolio(state);
        const text = formatPortfolio(portfolio);
        return ok(text, { portfolio, count: Object.keys(portfolio).length });
      } catch (e) { return failFrom(e); }
    },
  };

  const updateHolding: AgentTool = {
    name: 'update_holding',
    label: 'Update Holding',
    description: 'Update specific fields of an existing holding (avg_price, units, or category) without replacing the entire position. The telegram_user_id is always from the message context.',
    parameters: Type.Object({
      telegram_user_id: Type.Number({ description: 'Telegram user ID from the message context.' }),
      ticker: Type.String({ description: 'Stock ticker symbol.' }),
      avg_price: Type.Optional(Type.Number({ description: 'New average cost per share.' })),
      units: Type.Optional(Type.Number({ description: 'New number of shares.' })),
      category: Type.Optional(Type.String({ description: 'New fund category.' })),
    }),
    async execute(_id, raw) {
      const p = raw as { telegram_user_id: number; ticker: string; avg_price?: number; units?: number; category?: string };
      try {
        const state = resolveUser(p.telegram_user_id);
        const ticker = p.ticker.toUpperCase();
        const portfolio = getPortfolio(state);

        if (!(ticker in portfolio)) {
          return fail(`Ticker "${ticker}" not found in portfolio. Use add_holding to create it first.`);
        }

        const existing = portfolio[ticker];
        if (p.avg_price != null && p.avg_price <= 0) return fail('avg_price must be positive.');
        if (p.units != null && p.units <= 0) return fail('units must be positive.');

        portfolio[ticker] = {
          avg_price: p.avg_price ?? existing.avg_price,
          units: p.units ?? existing.units,
          category: p.category ?? existing.category,
        };

        setPortfolio(state, portfolio);
        state.log.push({
          ts: new Date().toISOString().slice(0, 10),
          action: 'holding_updated',
          ticker,
          ...portfolio[ticker],
        });
        saveState(state);

        const h = portfolio[ticker];
        return ok(
          `Updated ${ticker}: ${h.units} shares @ $${h.avg_price.toFixed(2)} (cost: $${(h.avg_price * h.units).toFixed(2)})${h.category ? ` [${h.category}]` : ''}`,
          { ticker, holding: h }
        );
      } catch (e) { return failFrom(e); }
    },
  };

  const clearPortfolio: AgentTool = {
    name: 'clear_portfolio',
    label: 'Clear Portfolio',
    description: 'Remove all holdings from the user\'s portfolio. Requires confirmation — the agent should ask the user to confirm before calling this. The telegram_user_id is always from the message context.',
    parameters: Type.Object({
      telegram_user_id: Type.Number({ description: 'Telegram user ID from the message context.' }),
      confirm: Type.Boolean({ description: 'Must be true to proceed. The agent should confirm with the user first.' }),
    }),
    async execute(_id, raw) {
      const p = raw as { telegram_user_id: number; confirm: boolean };
      try {
        if (!p.confirm) return fail('Set confirm=true to clear the portfolio. Confirm with the user first.');

        const state = resolveUser(p.telegram_user_id);
        const portfolio = getPortfolio(state);
        const count = Object.keys(portfolio).length;

        if (count === 0) return fail('Portfolio is already empty.');

        setPortfolio(state, {});
        state.log.push({
          ts: new Date().toISOString().slice(0, 10),
          action: 'portfolio_cleared',
          positions_removed: count,
        });
        saveState(state);

        return ok(
          `Cleared portfolio — ${count} position${count === 1 ? '' : 's'} removed.`,
          { cleared: count }
        );
      } catch (e) { return failFrom(e); }
    },
  };

  return [addHolding, removeHolding, getPortfolioTool, updateHolding, clearPortfolio];
}
