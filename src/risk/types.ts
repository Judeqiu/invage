/** Risk-only DTOs. Portfolio premium units remain dollars per contract. */
export const ENGINE_VERSION = 'conditional-ql-v3';
export const SCENARIO_SET = 'equity-options-standard-v1';
export type Horizon = 1 | 5 | 21;
export interface RiskRequest {
  analysisContextId: string;
  accountScope: { kind: 'all' | 'selected'; accountIds: string[] };
  horizonTradingDays: Horizon;
  scenarioSet: typeof SCENARIO_SET;
  mode: 'conditional';
  refresh: boolean;
}
export interface RiskMarketContract {
  /** Portfolio holding key; identity must also match the recorded contract. */
  id: string;
  underlying: string;
  right: 'call' | 'put';
  strike: number;
  multiplier: number;
  currency: string;
  exerciseStyle: 'american' | 'european';
  expiryAt: string;
  expiryTimezone: 'America/New_York';
  deliverable: 'standard-shares';
  spot: number;
  premiumPerContract: number;
  impliedVolatility: number;
  rate: number;
  dividends: { date: string; amount: number }[];
  /** Continuous annual cash-distribution yield proxy when no forward schedule exists. */
  dividendYield?: number;
  quoteAsOf: string;
  spotAsOf: string;
  source: string;
  rateReference: string;
  dividendReference: string;
}
/** Trusted server-side provider boundary; never accepted in an HTTP body. */
export interface RiskMarketSnapshot {
  id: string;
  portfolioRevision: number;
  metadataVersion: string;
  capturedAt: string;
  contracts: RiskMarketContract[];
  exclusions?: { id: string; reason: string }[];
}
export interface RiskContract extends RiskMarketContract {
  accountId: string;
  quantity: number;
  side: 'long' | 'short';
  shares: number;
  freeShares: number;
}
export interface Exclusion { id: string; quantity: number; reason: string }
export interface RiskInputs {
  /** Queue-only collection marker; removed before inputs are frozen/priced. */
  collectMarketData?: true;
  providerAssumptions?: string[];
  analysisContextId: string;
  portfolioRevision: string;
  marketSnapshotId: string;
  metadataVersion: string;
  marketAsOf: string | null;
  /** New York calendar date; stable within the day for request deduplication. */
  valuationDate?: string;
  accountIds: string[];
  horizonTradingDays: Horizon;
  contracts: RiskContract[];
  coverage: { totalContracts: number; supportedContracts: number; totalQuantity: number; supportedQuantity: number; exclusions: Exclusion[] };
  accounts: { accountId: string; currency: string; cash: number | null; cashAsOf: string | null }[];
}
export interface Metric { value: number | null; unit: string; reason?: string }
export interface Scenario {
  id: string; spotShock: number; volatilityPointShock: number;
  optionPnl: number | null; combinedPnl: number | null;
  byCurrency: { currency: string; optionPnl: number; combinedPnl: number }[];
}
export interface Contributor { id: string; accountId: string; currency: string; dollarDelta: number; vega: number; theta: number }
export interface Funding {
  accountId: string; currency: string; grossPutFunding: number; callShares: number;
  delivery: { underlying: string; requiredShares: number; availableShares: number }[];
  availableShares: number; cash: number | null; cashAsOf: string | null; fundingGap: number | null;
}
export interface RiskAnalysis {
  inputEvidence?: Array<Pick<RiskMarketContract,'id'|'source'|'quoteAsOf'|'spotAsOf'|'rateReference'|'dividendReference'>>;
  id: string; status: 'ready' | 'partial' | 'unavailable'; analysisContextId: string;
  portfolioRevision: string; generatedAt: string; marketAsOf: string | null; valuationDate?: string;
  marketSnapshotId: string; metadataVersion: string;
  model: { id: string; version: string; measure: 'conditional' };
  scope: { accountIds: string[]; currencies: string[]; horizonTradingDays: Horizon };
  capabilities: { stress: boolean; greeks: boolean; forecast: false; actions: false };
  coverage: RiskInputs['coverage'];
  metrics: { stressLoss: Metric; dollarDelta: Metric; expectedShortfall: Metric };
  payoffBounds: { accountId: string; currency: string; underlying: string; expiryAt: string; minPnl: number | null; maxPnl: number | null; unlimitedLoss: boolean; unlimitedGain: boolean }[];
  scenarios: Scenario[]; contributors: Contributor[]; funding: Funding[];
  actions: never[]; assumptions: string[];
  diagnostics: { maxPricingDifference: number; grid: number; elapsedMs: number } | null;
}
export interface RiskJob {
  id: string; status: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';
  result?: RiskAnalysis; error?: string;
}
