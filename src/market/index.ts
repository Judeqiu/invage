export { fetchPrices, fetchQuote } from './fetch-prices.js';
export { fetchTargets } from './fetch-targets.js';
export { fetchMetrics } from './fetch-metrics.js';
export {
  buildAnalysis,
  analyzeLaggards,
  analyzeOverpriced,
  analyzeBuyOpportunities,
  runFullAnalysis,
} from './analyzer.js';
export {
  assessValue,
  rankValueCandidates,
  deriveYields,
  emptyMetrics,
} from './value-assess.js';
export { COMPANIES, BENCHMARKS, THRESHOLDS } from './config.js';
export type {
  MarketQuote,
  AnalystTarget,
  FinancialMetrics,
  Holding,
  PositionAnalysis,
  AnalysisResult,
  ValueAssessment,
  CheapnessVerdict,
  QualityVerdict,
  TrapRisk,
} from './types.js';
