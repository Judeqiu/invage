/**
 * Per-user AI Investment Playbook.
 *
 * Mirrors the investment-intelligence configuration axes:
 * strategy, philosophy, allocation, buy/sell rules, rebalancing,
 * risk management, and watchlists.
 *
 * Missing playbook (or missing fields) resolve to DEFAULT_PLAYBOOK —
 * the balanced market-standard starting point.
 */

export const STRATEGIES = ['growth', 'income', 'capital_preservation'] as const;
export type Strategy = (typeof STRATEGIES)[number];

export const PHILOSOPHIES = ['growth_investing', 'value_investing', 'dividend_investing'] as const;
export type Philosophy = (typeof PHILOSOPHIES)[number];

export const RISK_PROFILES = ['conservative', 'balanced', 'aggressive'] as const;
export type RiskProfile = (typeof RISK_PROFILES)[number];

export const REBALANCE_MODES = ['monthly', 'quarterly', 'threshold'] as const;
export type RebalanceMode = (typeof REBALANCE_MODES)[number];

export interface AllocationConfig {
  /** Max single-name weight of portfolio market value, percent (e.g. 10 = 10%). */
  max_position_pct: number;
  /** Target cash weight, percent. */
  cash_target_pct: number;
  /** Max single-sector weight, percent. */
  max_sector_pct: number;
}

export interface BuySellRules {
  /** Free-text or short bullet criteria the agent must respect for BUY. */
  buy_criteria: string;
  /** Free-text or short bullet criteria for SELL / reduce. */
  sell_criteria: string;
  /**
   * How aggressively the agent turns analysis into trade language.
   * conservative → more WATCH/HOLD; aggressive → more sized BUY when gates pass.
   */
  ai_recommendation_style: RiskProfile;
}

export interface RebalancingRules {
  mode: RebalanceMode;
  /** Drift from target weight that triggers rebalance when mode=threshold (percent points). */
  threshold_pct: number;
}

export interface RiskManagement {
  profile: RiskProfile;
  /** Alias of allocation.max_position_pct for explicit risk framing. */
  position_limit_pct: number;
  /** Alias of allocation.max_sector_pct. */
  sector_exposure_pct: number;
}

export interface Watchlists {
  markets: string[];
  sectors: string[];
  themes: string[];
}

/**
 * Full investment playbook stored under top-level `playbook` in user YAML.
 * All fields optional at rest; resolvePlaybook fills defaults.
 */
export interface InvestmentPlaybook {
  strategy: Strategy;
  philosophy: Philosophy;
  allocation: AllocationConfig;
  buy_sell: BuySellRules;
  rebalancing: RebalancingRules;
  risk: RiskManagement;
  watchlists: Watchlists;
}

/** Partial update payload (any nested field optional). */
export type PlaybookPatch = {
  strategy?: Strategy;
  philosophy?: Philosophy;
  allocation?: Partial<AllocationConfig>;
  buy_sell?: Partial<BuySellRules>;
  rebalancing?: Partial<RebalancingRules>;
  risk?: Partial<RiskManagement>;
  watchlists?: Partial<Watchlists>;
};

/**
 * LexTok / product default: balanced market-standard playbook.
 * Used when the user has never configured a playbook.
 */
export const DEFAULT_PLAYBOOK: InvestmentPlaybook = {
  strategy: 'growth',
  philosophy: 'value_investing',
  allocation: {
    max_position_pct: 10,
    cash_target_pct: 5,
    max_sector_pct: 35,
  },
  buy_sell: {
    buy_criteria:
      'Cheapness or quality-growth with trap gate PASS; Street upside when available; clear thesis (why cheap / what closes gap / kill criteria).',
    sell_criteria:
      'Thesis broken, trap HIGH, deep loss with no recovery path vs targets, or material overvaluation vs median with risk-profile take-profit rules.',
    ai_recommendation_style: 'balanced',
  },
  rebalancing: {
    mode: 'quarterly',
    threshold_pct: 5,
  },
  risk: {
    profile: 'balanced',
    position_limit_pct: 10,
    sector_exposure_pct: 35,
  },
  watchlists: {
    markets: ['US'],
    sectors: [],
    themes: [],
  },
};
