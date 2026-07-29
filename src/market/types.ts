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

/** Equity share, option contract, or fund (ETF / open-end 基金) position. */
export type InstrumentKind = 'equity' | 'option' | 'fund';
export type OptionRight = 'call' | 'put';
export type OptionSide = 'long' | 'short';
export type OptionSettlement = 'physical' | 'cash';
/**
 * Where option MTM comes from.
 * - manual: always use stored mark (private/OTC, or force manual)
 * - yahoo: require a matching Yahoo options-chain contract (fail if missing)
 * - omit: auto — Yahoo when chain matches; otherwise stored mark (private)
 */
export type OptionQuoteSource = 'manual' | 'yahoo';

/**
 * Where fund MTM comes from (required on fund holdings — no silent default).
 * - yahoo: live Yahoo quote on portfolio base key (listed ETF / Yahoo-mapped fund)
 * - manual: stored NAV/price in fund.mark (open-end mutual funds, non-Yahoo codes)
 */
export type FundQuoteSource = 'manual' | 'yahoo';

/**
 * Fund (基金) fields — ETF or open-end mutual fund.
 * Economics match equity: avg_price / mark per unit; units = shares or fund units.
 */
export interface FundSpec {
  /** Required. yahoo = live quote; manual = fund.mark only. */
  quote_source: FundQuoteSource;
  /**
   * Current NAV / price per unit for MTM.
   * Required when quote_source is manual. Optional seed when yahoo (not used for live MTM).
   */
  mark?: number;
  /** Optional human name (e.g. open-end fund product name). */
  name?: string;
}

/**
 * Option contract fields.
 *
 * Premium convention: avg_price / mark are **total dollars per contract**
 * (what you paid or received for one contract). Multiplier only sizes
 * assignment obligation (shares), never multiplies premium again.
 *
 * Yahoo lastPrice is per share → live mark = lastPrice (or mid) × multiplier.
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
   * Required. Used for MTM when quote_source is manual or Yahoo has no match (auto).
   * Open short is not "triggered" until assigned — mark is option premium, not strike loss.
   */
  mark: number;
  /**
   * manual = stored mark only.
   * yahoo = live Yahoo chain required.
   * omit = auto (Yahoo if listed contract found, else stored mark).
   */
  quote_source?: OptionQuoteSource;
  /** Optional underlying price mark (private names / scenario work). */
  underlying_mark?: number;
}

/**
 * Portfolio holding.
 * - Equity (default when instrument omitted): avg_price = cost/share, units = shares.
 * - Option: avg_price = premium $ per contract at trade, units = contracts; option fields required.
 * - Fund: avg_price = cost per unit, units = fund units/shares; fund fields required.
 */
export interface Holding {
  avg_price: number;
  units: number;
  category?: string;
  /**
   * Broker / custody source for multi-broker portfolios (e.g. moomoo, ibkr, webull, tiger).
   * Omit or empty when unassigned — no silent default.
   */
  channel?: string;
  /** Omit or "equity" for stocks; "option" for calls/puts; "fund" for ETF/open-end 基金. */
  instrument?: InstrumentKind;
  /** Required when instrument === "option". */
  option?: OptionSpec;
  /** Required when instrument === "fund". */
  fund?: FundSpec;
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
