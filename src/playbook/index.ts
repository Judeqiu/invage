export {
  DEFAULT_PLAYBOOK,
  STRATEGIES,
  PHILOSOPHIES,
  RISK_PROFILES,
  REBALANCE_MODES,
  type Strategy,
  type Philosophy,
  type RiskProfile,
  type RebalanceMode,
  type AllocationConfig,
  type BuySellRules,
  type RebalancingRules,
  type RiskManagement,
  type Watchlists,
  type InvestmentPlaybook,
  type PlaybookPatch,
} from './types.js';

export {
  resolvePlaybook,
  applyPlaybookPatch,
  formatPlaybookSummary,
} from './resolve.js';

export { playbookAgentGuidance } from './guidance.js';
export { thresholdsForPlaybook, type PlaybookThresholds } from './thresholds.js';
