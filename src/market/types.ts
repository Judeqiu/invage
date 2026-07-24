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

/** Equity share position or option contract position. */
export type InstrumentKind = 'equity' | 'option';
export type OptionRight = 'call' | 'put';
export type OptionSide = 'long' | 'short';
export type OptionSettlement = 'physical' | 'cash';

/**
 * Option contract fields.
 *
 * Premium convention: avg_price / mark are **total dollars per contract**
 * (what you paid or received for one contract). Multiplier only sizes
 * assignment obligation (shares), never multiplies premium again.
 *
 * Example short put: 1 contract, $265 premium total, strike $90, mult 100
 * → premium cash $265; contingent buy $9,000 if assigned; open MTM = −mark.
 */
export interface OptionSpec {
  right: OptionRight;
  side: OptionSide;
  /** Strike price per share of underlying. */
  strike: number;
  /** Expiry date YYYY-MM-DD. */
  expiry: string;
  /** Shares controlled per contract (US equity options: 100). Assignment size only. */
  multiplier: number;
  /** Underlying symbol (public ticker or private name, e.g. SPACEX). */
  underlying: string;
  /** Settlement style — required, no silent default. */
  settlement: OptionSettlement;
  /**
   * Current option premium mark in **dollars per contract** (to close).
   * Required for MTM. Set to trade premium at entry if no live quote.
   * Open short is not "triggered" until assigned — mark is option premium, not strike loss.
   */
  mark: number;
  /** Optional underlying price mark (private names / scenario work). */
  underlying_mark?: number;
}

/**
 * Portfolio holding.
 * - Equity (default when instrument omitted): avg_price = cost/share, units = shares.
 * - Option: avg_price = premium $ per contract at trade, units = contracts; option fields required.
 */
export interface Holding {
  avg_price: number;
  units: number;
  category?: string;
  /** Omit or "equity" for stocks; "option" for calls/puts. */
  instrument?: InstrumentKind;
  /** Required when instrument === "option". */
  option?: OptionSpec;
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
  /** Present when this row is an option contract. */
  instrument?: InstrumentKind;
  option?: OptionSpec;
  contingentCashObligation?: number;
  contingentShareObligation?: number;
  premiumAbsolute?: number;
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
