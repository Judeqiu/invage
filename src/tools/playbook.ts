import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import {
  PHILOSOPHIES,
  REBALANCE_MODES,
  RISK_PROFILES,
  STRATEGIES,
  formatPlaybookSummary,
  type Philosophy,
  type PlaybookPatch,
  type RebalanceMode,
  type RiskProfile,
  type Strategy,
} from '../playbook/index.js';
import { getPlaybook, saveInvestorState, updatePlaybook } from '../state/portfolio-state.js';
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

export function createPlaybookTools(): AgentTool[] {
  const getPlaybookTool: AgentTool = {
    name: 'get_playbook',
    label: 'Get Investment Playbook',
    description:
      "Retrieve the user's investment playbook (strategy, philosophy, risk, allocation, buy/sell, rebalancing, watchlists). " +
      'Missing config returns the balanced market-standard defaults. Pass telegram_user_id or slack_user_id from message context.',
    parameters: Type.Object({ ...channelIdParams }),
    async execute(_id, raw) {
      const p = raw as ChannelIds;
      try {
        const state = resolveInvestorFromChannel(p);
        const playbook = getPlaybook(state);
        const configured = state.playbook != null;
        const text =
          formatPlaybookSummary(playbook) +
          (configured
            ? '\n(Source: user-configured playbook)'
            : '\n(Source: default balanced playbook — user has not customized)');
        return ok(text, { playbook, configured });
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const updatePlaybookTool: AgentTool = {
    name: 'update_playbook',
    label: 'Update Investment Playbook',
    description:
      "Update the user's investment playbook. Pass only fields to change. " +
      `strategy: ${STRATEGIES.join('|')}. ` +
      `philosophy: ${PHILOSOPHIES.join('|')}. ` +
      `risk_profile / ai_recommendation_style: ${RISK_PROFILES.join('|')}. ` +
      `rebalance_mode: ${REBALANCE_MODES.join('|')}. ` +
      'Pass telegram_user_id or slack_user_id from message context.',
    parameters: Type.Object({
      ...channelIdParams,
      strategy: Type.Optional(
        Type.String({ description: `One of: ${STRATEGIES.join(', ')}` }),
      ),
      philosophy: Type.Optional(
        Type.String({ description: `One of: ${PHILOSOPHIES.join(', ')}` }),
      ),
      risk_profile: Type.Optional(
        Type.String({ description: `One of: ${RISK_PROFILES.join(', ')}` }),
      ),
      max_position_pct: Type.Optional(
        Type.Number({ description: 'Max single-name portfolio weight percent (1–100).' }),
      ),
      max_sector_pct: Type.Optional(
        Type.Number({ description: 'Max single-sector weight percent (1–100).' }),
      ),
      cash_target_pct: Type.Optional(
        Type.Number({ description: 'Target cash weight percent (0–100).' }),
      ),
      buy_criteria: Type.Optional(Type.String({ description: 'Buy rule text the agent must respect.' })),
      sell_criteria: Type.Optional(Type.String({ description: 'Sell/reduce rule text.' })),
      ai_recommendation_style: Type.Optional(
        Type.String({
          description: `How assertive recommendations are: ${RISK_PROFILES.join(', ')}`,
        }),
      ),
      rebalance_mode: Type.Optional(
        Type.String({ description: `One of: ${REBALANCE_MODES.join(', ')}` }),
      ),
      rebalance_threshold_pct: Type.Optional(
        Type.Number({ description: 'Drift pp for threshold rebalancing (0.5–50).' }),
      ),
      markets: Type.Optional(
        Type.Array(Type.String(), { description: 'Market watchlist (e.g. US, HK).' }),
      ),
      sectors: Type.Optional(
        Type.Array(Type.String(), { description: 'Sector focus list.' }),
      ),
      themes: Type.Optional(
        Type.Array(Type.String(), { description: 'Theme focus list (e.g. AI, energy transition).' }),
      ),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & {
        strategy?: string;
        philosophy?: string;
        risk_profile?: string;
        max_position_pct?: number;
        max_sector_pct?: number;
        cash_target_pct?: number;
        buy_criteria?: string;
        sell_criteria?: string;
        ai_recommendation_style?: string;
        rebalance_mode?: string;
        rebalance_threshold_pct?: number;
        markets?: string[];
        sectors?: string[];
        themes?: string[];
      };
      try {
        const state = resolveInvestorFromChannel(p);
        const patch: PlaybookPatch = {};

        if (p.strategy != null) patch.strategy = p.strategy as Strategy;
        if (p.philosophy != null) patch.philosophy = p.philosophy as Philosophy;
        if (p.risk_profile != null) {
          patch.risk = { ...(patch.risk ?? {}), profile: p.risk_profile as RiskProfile };
        }
        if (p.max_position_pct != null) {
          patch.allocation = {
            ...(patch.allocation ?? {}),
            max_position_pct: p.max_position_pct,
          };
          patch.risk = {
            ...(patch.risk ?? {}),
            position_limit_pct: p.max_position_pct,
          };
        }
        if (p.max_sector_pct != null) {
          patch.allocation = {
            ...(patch.allocation ?? {}),
            max_sector_pct: p.max_sector_pct,
          };
          patch.risk = {
            ...(patch.risk ?? {}),
            sector_exposure_pct: p.max_sector_pct,
          };
        }
        if (p.cash_target_pct != null) {
          patch.allocation = {
            ...(patch.allocation ?? {}),
            cash_target_pct: p.cash_target_pct,
          };
        }
        if (p.buy_criteria != null) {
          patch.buy_sell = { ...(patch.buy_sell ?? {}), buy_criteria: p.buy_criteria };
        }
        if (p.sell_criteria != null) {
          patch.buy_sell = { ...(patch.buy_sell ?? {}), sell_criteria: p.sell_criteria };
        }
        if (p.ai_recommendation_style != null) {
          patch.buy_sell = {
            ...(patch.buy_sell ?? {}),
            ai_recommendation_style: p.ai_recommendation_style as RiskProfile,
          };
        }
        if (p.rebalance_mode != null) {
          patch.rebalancing = {
            ...(patch.rebalancing ?? {}),
            mode: p.rebalance_mode as RebalanceMode,
          };
        }
        if (p.rebalance_threshold_pct != null) {
          patch.rebalancing = {
            ...(patch.rebalancing ?? {}),
            threshold_pct: p.rebalance_threshold_pct,
          };
        }
        if (p.markets != null || p.sectors != null || p.themes != null) {
          patch.watchlists = {
            ...(p.markets != null ? { markets: p.markets } : {}),
            ...(p.sectors != null ? { sectors: p.sectors } : {}),
            ...(p.themes != null ? { themes: p.themes } : {}),
          };
        }

        if (Object.keys(patch).length === 0) {
          return fail(
            'No playbook fields provided. Pass at least one of: strategy, philosophy, risk_profile, max_position_pct, max_sector_pct, cash_target_pct, buy_criteria, sell_criteria, ai_recommendation_style, rebalance_mode, rebalance_threshold_pct, markets, sectors, themes.',
          );
        }

        const playbook = updatePlaybook(state, patch);
        state.log.push({
          ts: new Date().toISOString().slice(0, 10),
          action: 'playbook_updated',
          fields: Object.keys(patch),
        });
        saveInvestorState(state);

        return ok(`Updated playbook.\n\n${formatPlaybookSummary(playbook)}`, {
          playbook,
          patch,
        });
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  return [getPlaybookTool, updatePlaybookTool];
}
