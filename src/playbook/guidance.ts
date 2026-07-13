import type { InvestmentPlaybook } from './types.js';
import { thresholdsForPlaybook, type PlaybookThresholds } from './thresholds.js';

/**
 * Compact agent-facing instructions derived from the user's playbook.
 * Injected into enrichMessage so every turn can tailor suggestions
 * without re-asking the user about process or preferences.
 */
export function playbookAgentGuidance(pb: InvestmentPlaybook): string {
  const t = thresholdsForPlaybook(pb);
  const parts: string[] = [
    '[Investment Playbook — use as hard guidance for research framing, sizing language, and trade suggestions. Do not re-interview the user about strategy/risk unless they ask to change the playbook.]',
    `Strategy=${pb.strategy}; Philosophy=${pb.philosophy}; Risk=${pb.risk.profile}; AI-style=${pb.buy_sell.ai_recommendation_style}.`,
    `Position limit ${pb.risk.position_limit_pct}% | Sector limit ${pb.risk.sector_exposure_pct}% | Cash target ${pb.allocation.cash_target_pct}% | Rebalance ${pb.rebalancing.mode}` +
      (pb.rebalancing.mode === 'threshold' ? ` @ ${pb.rebalancing.threshold_pct}pp drift` : '') +
      '.',
    `Thresholds: buy upside ≥${t.buyMinUpsidePct}% | strong-buy ≥${t.strongBuyUpsidePct}% | deep-loss SELL ≤${t.deepLossSellPct}% | take-profit premium ≥${t.takeProfitPremiumPct}% | trail-stop ≥${t.trailStopPremiumPct}%.`,
    strategyGuidance(pb),
    philosophyGuidance(pb),
    riskGuidance(pb, t),
    `Buy rules: ${pb.buy_sell.buy_criteria}`,
    `Sell rules: ${pb.buy_sell.sell_criteria}`,
  ];

  if (pb.watchlists.markets.length || pb.watchlists.sectors.length || pb.watchlists.themes.length) {
    const wl: string[] = [];
    if (pb.watchlists.markets.length) wl.push(`markets=${pb.watchlists.markets.join('/')}`);
    if (pb.watchlists.sectors.length) wl.push(`sectors=${pb.watchlists.sectors.join('/')}`);
    if (pb.watchlists.themes.length) wl.push(`themes=${pb.watchlists.themes.join('/')}`);
    parts.push(
      `Watchlists (prefer these universes for discovery when the user does not name a ticker): ${wl.join('; ')}.`,
    );
  }

  parts.push(
    'When recommending size: express as % of portfolio and respect position/sector caps; flag breaches. ' +
      'When rebalance is due by mode/drift, say so. Never invent prices — tools first.',
  );

  return parts.join(' ');
}

function strategyGuidance(pb: InvestmentPlaybook): string {
  switch (pb.strategy) {
    case 'growth':
      return 'Strategy lens: prioritize capital appreciation and earnings/revenue trajectory; income is secondary.';
    case 'income':
      return 'Strategy lens: prioritize sustainable yield, payout coverage, and dividend durability; total-return growth is secondary.';
    case 'capital_preservation':
      return 'Strategy lens: prioritize drawdown control, balance-sheet quality, and defensive cash flows; avoid speculative accumulation.';
  }
}

function philosophyGuidance(pb: InvestmentPlaybook): string {
  switch (pb.philosophy) {
    case 'value_investing':
      return 'Philosophy: value — require cheapness yardstick (PE/P/B/FCF/EV) + quality + trap gate before BUY; Street upside alone is not enough.';
    case 'growth_investing':
      return 'Philosophy: growth — accept higher multiples when growth/PEG/margins support; still run trap gate; avoid pure multiple expansion stories.';
    case 'dividend_investing':
      return 'Philosophy: dividend — require yield context, coverage, and payout sustainability; flag dividend cuts risk; prefer quality income over yield traps.';
  }
}

function riskGuidance(pb: InvestmentPlaybook, t: PlaybookThresholds): string {
  switch (pb.risk.profile) {
    case 'conservative':
      return `Risk conservative: prefer WATCH over thin-edge BUY; require ≥${t.buyMinUpsidePct}% upside and solid quality; size suggestions small (well under position cap); earlier take-profit (≥${t.takeProfitPremiumPct}% over median).`;
    case 'balanced':
      return `Risk balanced: standard gates; BUY when upside ≥${t.buyMinUpsidePct}% and trap PASS; size up to position cap only with conviction.`;
    case 'aggressive':
      return `Risk aggressive: can size toward position cap when gates pass; lower upside bar (${t.buyMinUpsidePct}%); more patience on laggards unless deep-loss (${t.deepLossSellPct}%) or thesis broken.`;
  }
}
