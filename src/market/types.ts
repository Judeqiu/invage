export interface MarketQuote {
  ticker: string;
  price: number;
  currency: string;
  shortName: string;
}

export interface AnalystTarget {
  ticker: string;
  targetLowPrice: number | null;
  targetMedianPrice: number | null;
  targetMeanPrice: number | null;
  targetHighPrice: number | null;
}

/** Live fundamentals from Yahoo; derived yields are computed only when inputs exist (no invented defaults). */
export interface FinancialMetrics {
  ticker: string;
  shortName: string;
  sector: string;
  /** Yahoo quote / key stats */
  trailingPE: number | null;
  forwardPE: number | null;
  pegRatio: number | null;
  priceToBook: number | null;
  returnOnEquity: number | null;
  returnOnAssets: number | null;
  marketCap: number | null;
  enterpriseValue: number | null;
  /** Yahoo enterpriseToEbitda when present */
  enterpriseToEbitda: number | null;
  ebitda: number | null;
  freeCashflow: number | null;
  operatingCashflow: number | null;
  totalCash: number | null;
  totalDebt: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  profitMargins: number | null;
  operatingMargins: number | null;
  grossMargins: number | null;
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  /** freeCashflow / marketCap when both present (decimal, e.g. 0.05 = 5%) */
  fcfYield: number | null;
  /** 1 / trailingPE when PE > 0 */
  earningsYield: number | null;
  /** freeCashflow / enterpriseValue when both present */
  fcfYieldOnEv: number | null;
  /** Set when the Yahoo fetch for this ticker failed entirely */
  fetchError?: string;
}

export interface Holding {
  avg_price: number;
  units: number;
  category?: string;
}

export interface PositionAnalysis {
  ticker: string;
  company: string;
  category: string;
  price: number;
  avgCost: number;
  units: number;
  cost: number;
  value: number;
  pl: number;
  plPct: number;
  targetLow: number | null;
  targetMedian: number | null;
  targetMean: number | null;
  targetHigh: number | null;
  upsideToMedian: number | null;
  upsideToMean: number | null;
  costVsHigh: number | null;
  currentVsCost: number | null;
  recommendation?: string;
}

export interface AnalysisResult {
  laggards: PositionAnalysis[];
  overpriced: PositionAnalysis[];
  buyOpportunities: PositionAnalysis[];
  fullAnalysis: PositionAnalysis[];
}

export type CheapnessVerdict = 'YES' | 'MIXED' | 'NO' | 'UNKNOWN';
export type QualityVerdict = 'STRONG' | 'OK' | 'WEAK' | 'UNKNOWN';
export type TrapRisk = 'LOW' | 'ELEVATED' | 'HIGH' | 'UNKNOWN';

export interface ValueAssessment {
  ticker: string;
  cheapness: CheapnessVerdict;
  quality: QualityVerdict;
  trapRisk: TrapRisk;
  /** Human-readable evidence lines with numbers */
  signals: string[];
  /** One-line agent summary */
  summary: string;
}
