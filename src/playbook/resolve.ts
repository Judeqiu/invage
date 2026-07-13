import {
  DEFAULT_PLAYBOOK,
  PHILOSOPHIES,
  REBALANCE_MODES,
  RISK_PROFILES,
  STRATEGIES,
  type AllocationConfig,
  type BuySellRules,
  type InvestmentPlaybook,
  type Philosophy,
  type PlaybookPatch,
  type RebalanceMode,
  type RebalancingRules,
  type RiskManagement,
  type RiskProfile,
  type Strategy,
  type Watchlists,
} from './types.js';

function isStrategy(v: unknown): v is Strategy {
  return typeof v === 'string' && (STRATEGIES as readonly string[]).includes(v);
}
function isPhilosophy(v: unknown): v is Philosophy {
  return typeof v === 'string' && (PHILOSOPHIES as readonly string[]).includes(v);
}
function isRiskProfile(v: unknown): v is RiskProfile {
  return typeof v === 'string' && (RISK_PROFILES as readonly string[]).includes(v);
}
function isRebalanceMode(v: unknown): v is RebalanceMode {
  return typeof v === 'string' && (REBALANCE_MODES as readonly string[]).includes(v);
}

function assertPct(name: string, n: number, min = 0, max = 100): number {
  if (typeof n !== 'number' || Number.isNaN(n) || !Number.isFinite(n)) {
    throw new Error(`${name} must be a finite number, got: ${String(n)}`);
  }
  if (n < min || n > max) {
    throw new Error(`${name} must be between ${min} and ${max}, got: ${n}`);
  }
  return n;
}

function stringList(v: unknown, field: string): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) {
    throw new Error(`${field} must be an array of strings`);
  }
  for (const item of v) {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new Error(`${field} entries must be non-empty strings`);
    }
  }
  return v.map((s) => s.trim());
}

/**
 * Merge raw YAML playbook (possibly partial / missing) with DEFAULT_PLAYBOOK.
 * Invalid enum or range values fail fast.
 */
export function resolvePlaybook(raw: unknown): InvestmentPlaybook {
  if (raw == null) return structuredClone(DEFAULT_PLAYBOOK);
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('playbook must be a mapping object when present');
  }
  const p = raw as Record<string, unknown>;
  const d = DEFAULT_PLAYBOOK;

  const strategy = p.strategy === undefined ? d.strategy : p.strategy;
  if (!isStrategy(strategy)) {
    throw new Error(`playbook.strategy must be one of: ${STRATEGIES.join(', ')}`);
  }

  const philosophy = p.philosophy === undefined ? d.philosophy : p.philosophy;
  if (!isPhilosophy(philosophy)) {
    throw new Error(`playbook.philosophy must be one of: ${PHILOSOPHIES.join(', ')}`);
  }

  const allocRaw = (p.allocation ?? {}) as Partial<AllocationConfig>;
  if (p.allocation != null && (typeof p.allocation !== 'object' || Array.isArray(p.allocation))) {
    throw new Error('playbook.allocation must be a mapping');
  }
  const allocation: AllocationConfig = {
    max_position_pct: assertPct(
      'allocation.max_position_pct',
      allocRaw.max_position_pct ?? d.allocation.max_position_pct,
      1,
      100,
    ),
    cash_target_pct: assertPct(
      'allocation.cash_target_pct',
      allocRaw.cash_target_pct ?? d.allocation.cash_target_pct,
      0,
      100,
    ),
    max_sector_pct: assertPct(
      'allocation.max_sector_pct',
      allocRaw.max_sector_pct ?? d.allocation.max_sector_pct,
      1,
      100,
    ),
  };

  const bsRaw = (p.buy_sell ?? {}) as Partial<BuySellRules>;
  if (p.buy_sell != null && (typeof p.buy_sell !== 'object' || Array.isArray(p.buy_sell))) {
    throw new Error('playbook.buy_sell must be a mapping');
  }
  const style =
    bsRaw.ai_recommendation_style === undefined
      ? d.buy_sell.ai_recommendation_style
      : bsRaw.ai_recommendation_style;
  if (!isRiskProfile(style)) {
    throw new Error(
      `buy_sell.ai_recommendation_style must be one of: ${RISK_PROFILES.join(', ')}`,
    );
  }
  const buy_sell: BuySellRules = {
    buy_criteria:
      typeof bsRaw.buy_criteria === 'string' && bsRaw.buy_criteria.trim()
        ? bsRaw.buy_criteria.trim()
        : d.buy_sell.buy_criteria,
    sell_criteria:
      typeof bsRaw.sell_criteria === 'string' && bsRaw.sell_criteria.trim()
        ? bsRaw.sell_criteria.trim()
        : d.buy_sell.sell_criteria,
    ai_recommendation_style: style,
  };

  const rebRaw = (p.rebalancing ?? {}) as Partial<RebalancingRules>;
  if (p.rebalancing != null && (typeof p.rebalancing !== 'object' || Array.isArray(p.rebalancing))) {
    throw new Error('playbook.rebalancing must be a mapping');
  }
  const mode = rebRaw.mode === undefined ? d.rebalancing.mode : rebRaw.mode;
  if (!isRebalanceMode(mode)) {
    throw new Error(`rebalancing.mode must be one of: ${REBALANCE_MODES.join(', ')}`);
  }
  const rebalancing: RebalancingRules = {
    mode,
    threshold_pct: assertPct(
      'rebalancing.threshold_pct',
      rebRaw.threshold_pct ?? d.rebalancing.threshold_pct,
      0.5,
      50,
    ),
  };

  const riskRaw = (p.risk ?? {}) as Partial<RiskManagement>;
  if (p.risk != null && (typeof p.risk !== 'object' || Array.isArray(p.risk))) {
    throw new Error('playbook.risk must be a mapping');
  }
  const riskProfile = riskRaw.profile === undefined ? d.risk.profile : riskRaw.profile;
  if (!isRiskProfile(riskProfile)) {
    throw new Error(`risk.profile must be one of: ${RISK_PROFILES.join(', ')}`);
  }
  const risk: RiskManagement = {
    profile: riskProfile,
    position_limit_pct: assertPct(
      'risk.position_limit_pct',
      riskRaw.position_limit_pct ?? allocation.max_position_pct,
      1,
      100,
    ),
    sector_exposure_pct: assertPct(
      'risk.sector_exposure_pct',
      riskRaw.sector_exposure_pct ?? allocation.max_sector_pct,
      1,
      100,
    ),
  };

  // Keep allocation limits in sync with risk when risk was set more tightly.
  allocation.max_position_pct = Math.min(allocation.max_position_pct, risk.position_limit_pct);
  allocation.max_sector_pct = Math.min(allocation.max_sector_pct, risk.sector_exposure_pct);

  const wlRaw = (p.watchlists ?? {}) as Partial<Watchlists>;
  if (p.watchlists != null && (typeof p.watchlists !== 'object' || Array.isArray(p.watchlists))) {
    throw new Error('playbook.watchlists must be a mapping');
  }
  const watchlists: Watchlists = {
    markets:
      wlRaw.markets !== undefined
        ? stringList(wlRaw.markets, 'watchlists.markets')
        : [...d.watchlists.markets],
    sectors:
      wlRaw.sectors !== undefined
        ? stringList(wlRaw.sectors, 'watchlists.sectors')
        : [...d.watchlists.sectors],
    themes:
      wlRaw.themes !== undefined
        ? stringList(wlRaw.themes, 'watchlists.themes')
        : [...d.watchlists.themes],
  };

  return {
    strategy,
    philosophy,
    allocation,
    buy_sell,
    rebalancing,
    risk,
    watchlists,
  };
}

/** Apply a partial patch onto a resolved playbook; re-validate via resolvePlaybook. */
export function applyPlaybookPatch(
  current: InvestmentPlaybook,
  patch: PlaybookPatch,
): InvestmentPlaybook {
  const merged = {
    strategy: patch.strategy ?? current.strategy,
    philosophy: patch.philosophy ?? current.philosophy,
    allocation: { ...current.allocation, ...patch.allocation },
    buy_sell: { ...current.buy_sell, ...patch.buy_sell },
    rebalancing: { ...current.rebalancing, ...patch.rebalancing },
    risk: { ...current.risk, ...patch.risk },
    watchlists: {
      markets: patch.watchlists?.markets ?? current.watchlists.markets,
      sectors: patch.watchlists?.sectors ?? current.watchlists.sectors,
      themes: patch.watchlists?.themes ?? current.watchlists.themes,
    },
  };

  // When risk limits change without allocation, keep them aligned.
  if (patch.risk?.position_limit_pct != null && patch.allocation?.max_position_pct == null) {
    merged.allocation.max_position_pct = patch.risk.position_limit_pct;
  }
  if (patch.risk?.sector_exposure_pct != null && patch.allocation?.max_sector_pct == null) {
    merged.allocation.max_sector_pct = patch.risk.sector_exposure_pct;
  }
  if (patch.allocation?.max_position_pct != null && patch.risk?.position_limit_pct == null) {
    merged.risk.position_limit_pct = patch.allocation.max_position_pct;
  }
  if (patch.allocation?.max_sector_pct != null && patch.risk?.sector_exposure_pct == null) {
    merged.risk.sector_exposure_pct = patch.allocation.max_sector_pct;
  }

  return resolvePlaybook(merged);
}

export function formatPlaybookSummary(pb: InvestmentPlaybook): string {
  const lines = [
    'Investment Playbook',
    `  Strategy: ${pb.strategy}`,
    `  Philosophy: ${pb.philosophy}`,
    `  Risk: ${pb.risk.profile} | max position ${pb.risk.position_limit_pct}% | max sector ${pb.risk.sector_exposure_pct}%`,
    `  Allocation: cash target ${pb.allocation.cash_target_pct}%`,
    `  Rebalancing: ${pb.rebalancing.mode}` +
      (pb.rebalancing.mode === 'threshold' ? ` @ ${pb.rebalancing.threshold_pct}pp` : ''),
    `  AI style: ${pb.buy_sell.ai_recommendation_style}`,
    `  Buy criteria: ${pb.buy_sell.buy_criteria}`,
    `  Sell criteria: ${pb.buy_sell.sell_criteria}`,
  ];
  if (pb.watchlists.markets.length) {
    lines.push(`  Markets: ${pb.watchlists.markets.join(', ')}`);
  }
  if (pb.watchlists.sectors.length) {
    lines.push(`  Sectors: ${pb.watchlists.sectors.join(', ')}`);
  }
  if (pb.watchlists.themes.length) {
    lines.push(`  Themes: ${pb.watchlists.themes.join(', ')}`);
  }
  return lines.join('\n');
}
