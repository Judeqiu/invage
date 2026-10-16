/** Risk-only DTOs. Portfolio premium units remain dollars per contract. */
export const ENGINE_VERSION = 'risk-ql-fhs-v4';
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
  histories?: RiskHistorySeries[];
  executionQuotes?: { contractId: string; quote: RiskExecutionQuote }[];
  hedges?: RiskHedgeCandidate[];
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
  costModel?: RiskCostModel;
  histories?: RiskHistorySeries[];
  executionQuotes?: { contractId: string; quote: RiskExecutionQuote }[];
  hedges?: RiskHedgeCandidate[];
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
  capabilities: { stress: boolean; greeks: boolean; forecast: boolean; actions: boolean };
  coverage: RiskInputs['coverage'];
  metrics: { stressLoss: Metric; dollarDelta: Metric; expectedShortfall: Metric };
  payoffBounds: { accountId: string; currency: string; underlying: string; expiryAt: string; minPnl: number | null; maxPnl: number | null; unlimitedLoss: boolean; unlimitedGain: boolean }[];
  scenarios: Scenario[]; contributors: Contributor[]; funding: Funding[];
  forecast: RiskForecast;
  actions: RiskAction[]; assumptions: string[];
  diagnostics: { maxPricingDifference: number; grid: number; elapsedMs: number } | null;
}
export interface RiskJob {
  id: string; status: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';
  result?: RiskAnalysis; error?: string;
}

/** Explicit estimates approved for comparisons, never presented as broker charges. */
export interface RiskCostModel {
  basis: 'estimate'; currency: 'USD'; feePerContract: number; minimumOrderFee: number;
  slippageBps: number; reference: string;
}
export interface RiskExecutionQuote {
  bid: number; ask: number; bidSize: number | null; askSize: number | null;
  fetchedAt: string; quoteAsOf: string | null; source: string;
}
/** One observed spot/IV series per exact contract, shared across custody lots. */
export interface RiskHistorySeries {
  key: string; dates: string[]; spots: number[]; ivs: number[]; source: string;
}
export interface RiskHedgeCandidate {
  forContractId: string; contract: RiskMarketContract; quote: RiskExecutionQuote;
}
export interface ForecastValidation {
  status: 'passed' | 'failed' | 'insufficient'; reason: string;
  observations: number; trainingObservations: number; validationCases: number; holdoutCases: number;
  intervalCoverage: { level: number; observed: number; cases: number }[];
  varExceedanceRate: number | null; varIndependencePValue: number | null;
  jointTailScore: number | null; baselineTailScore: number | null;
  calibrationTarget: string;
}
export interface ForecastMetric {
  currency: string; var: number; expectedShortfall: number; probabilityOfProfit: number;
  expectedPnl: number; confidenceLevel: number; horizonTradingDays: Horizon;
  samplingInterval: { lower: number; upper: number; confidence: number; method: string };
}
export interface RiskForecast {
  status: 'ready' | 'partial' | 'unavailable'; reason: string;
  model: { id: string; measure: 'physical'; version: string }; seed: number; paths: number;
  coverage: { totalPositions: number; supportedPositions: number; exclusions: { id: string; reason: string }[] };
  validation: ForecastValidation; metrics: ForecastMetric[]; assumptions: string[];
}
export interface RiskAction {
  id: string; kind: 'hold' | 'close' | 'hedge'; status: 'ready' | 'unavailable'; label: string;
  accountId: string | null; contractId: string | null; currency: string;
  reason: string; initialCashFlow: number | null; estimatedInitialFees: number | null;
  funding: 'sufficient' | 'insufficient' | 'unknown' | 'not-required';
  liquidity: 'sufficient' | 'insufficient' | 'unknown';
  quote: RiskExecutionQuote | null; costModel: RiskCostModel;
  scenarios: { id: string; pnl: number }[]; stressLoss: number | null;
  forecast: ForecastMetric | null;
}
export const riskContractKey = (c: Pick<RiskMarketContract,'underlying'|'right'|'strike'|'expiryAt'>) =>
  `${c.underlying}|${c.right}|${c.strike}|${c.expiryAt.slice(0,10)}`;
