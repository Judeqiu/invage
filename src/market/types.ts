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

export interface FinancialMetrics {
  ticker: string;
  trailingPE: number | null;
  pegRatio: number | null;
  forwardPE: number | null;
  priceToBook: number | null;
  returnOnEquity: number | null;
  shortName: string;
  sector: string;
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
