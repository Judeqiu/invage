import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { saveState } from 'utarus';
import type { Holding } from '../market/types.js';
import {
  getPortfolio,
  setPortfolio,
} from '../state/portfolio-state.js';
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

function formatPortfolio(portfolio: Record<string, Holding>): string {
  const tickers = Object.keys(portfolio);
  if (tickers.length === 0) return 'Portfolio is empty. Use add_holding to add positions.';

  let totalCost = 0;
  const lines = [`Portfolio — ${tickers.length} position${tickers.length === 1 ? '' : 's'}:`, ''];

  for (const ticker of tickers) {
    const h = portfolio[ticker];
    const cost = h.avg_price * h.units;
    totalCost += cost;
    lines.push(
      `  ${ticker.padEnd(8)} | ${h.units} shares @ $${h.avg_price.toFixed(2)} | Cost: $${cost.toFixed(2)} | ${h.category ?? 'Uncategorized'}`,
    );
  }

  lines.push('');
  lines.push(`Total cost basis: $${totalCost.toFixed(2)}`);
  return lines.join('\n');
}

export function createPortfolioTools(): AgentTool[] {
  const addHolding: AgentTool = {
    name: 'add_holding',
    label: 'Add Holding',
    description:
      "Add or update a stock position in the user's portfolio. Pass telegram_user_id (Telegram) or slack_user_id (Slack) from the message context — never ask the user for it.",
    parameters: Type.Object({
      ...channelIdParams,
      ticker: Type.String({
        description: 'Stock ticker symbol (e.g. "AAPL", "MSFT"). Case-insensitive, stored uppercase.',
      }),
      avg_price: Type.Number({ description: 'Average cost per share in USD.' }),
      units: Type.Number({ description: 'Number of shares owned.' }),
      category: Type.Optional(
        Type.String({ description: 'Fund category (e.g. "SL Technology S1", "SL Healthcare S1").' }),
      ),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & {
        ticker: string;
        avg_price: number;
        units: number;
        category?: string;
      };
      try {
        if (p.avg_price <= 0) return fail('avg_price must be positive.');
        if (p.units <= 0) return fail('units must be positive.');

        const state = resolveInvestorFromChannel(p);
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
          { ticker, avg_price: p.avg_price, units: p.units, category: p.category, isUpdate },
        );
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const removeHolding: AgentTool = {
    name: 'remove_holding',
    label: 'Remove Holding',
    description:
      "Remove a stock position from the user's portfolio. Pass telegram_user_id or slack_user_id from the message context.",
    parameters: Type.Object({
      ...channelIdParams,
      ticker: Type.String({ description: 'Stock ticker symbol to remove.' }),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & { ticker: string };
      try {
        const state = resolveInvestorFromChannel(p);
        const ticker = p.ticker.toUpperCase();
        const portfolio = getPortfolio(state);

        if (!(ticker in portfolio)) {
          return fail(
            `Ticker "${ticker}" not found in portfolio. Current holdings: ${Object.keys(portfolio).join(', ') || 'none'}`,
          );
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
          { ticker, removed },
        );
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const getPortfolioTool: AgentTool = {
    name: 'get_portfolio',
    label: 'Get Portfolio',
    description:
      "Retrieve the user's saved portfolio. Pass telegram_user_id or slack_user_id from the message context.",
    parameters: Type.Object({ ...channelIdParams }),
    async execute(_id, raw) {
      const p = raw as ChannelIds;
      try {
        const state = resolveInvestorFromChannel(p);
        const portfolio = getPortfolio(state);
        return ok(formatPortfolio(portfolio), { portfolio, count: Object.keys(portfolio).length });
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const updateHolding: AgentTool = {
    name: 'update_holding',
    label: 'Update Holding',
    description:
      'Update specific fields of an existing holding. Pass telegram_user_id or slack_user_id from the message context.',
    parameters: Type.Object({
      ...channelIdParams,
      ticker: Type.String({ description: 'Stock ticker symbol.' }),
      avg_price: Type.Optional(Type.Number({ description: 'New average cost per share.' })),
      units: Type.Optional(Type.Number({ description: 'New number of shares.' })),
      category: Type.Optional(Type.String({ description: 'New fund category.' })),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & {
        ticker: string;
        avg_price?: number;
        units?: number;
        category?: string;
      };
      try {
        const state = resolveInvestorFromChannel(p);
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
          { ticker, holding: h },
        );
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const clearPortfolio: AgentTool = {
    name: 'clear_portfolio',
    label: 'Clear Portfolio',
    description:
      "Remove all holdings. Requires confirm=true. Pass telegram_user_id or slack_user_id from the message context.",
    parameters: Type.Object({
      ...channelIdParams,
      confirm: Type.Boolean({
        description: 'Must be true to proceed. Confirm with the user first.',
      }),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & { confirm: boolean };
      try {
        if (!p.confirm) return fail('Set confirm=true to clear the portfolio. Confirm with the user first.');

        const state = resolveInvestorFromChannel(p);
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

        return ok(`Cleared portfolio — ${count} position${count === 1 ? '' : 's'} removed.`, {
          cleared: count,
        });
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  return [addHolding, removeHolding, getPortfolioTool, updateHolding, clearPortfolio];
}
