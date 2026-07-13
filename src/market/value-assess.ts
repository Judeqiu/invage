import { THRESHOLDS } from './config.js';
import type { PlaybookThresholds } from '../playbook/thresholds.js';
import type {
  FinancialMetrics,
  ValueAssessment,
  CheapnessVerdict,
  QualityVerdict,
  TrapRisk,
} from './types.js';

/** Multiples used by assessValue; playbook can override PE/PEG/FCF cheapness bars. */
export type ValueThresholds = {
  peAttractive: number;
  peExpensive: number;
  forwardPeAttractive: number;
  forwardPeExpensive: number;
  pegAttractive: number;
  pegExpensive: number;
  fcfYieldAttractive: number;
  fcfYieldWeak: number;
  evEbitdaAttractive: number;
  evEbitdaExpensive: number;
  pbAttractiveFinancials: number;
  pbExpensiveFinancials: number;
  roeGood: number;
  roeWeak: number;
  roaGood: number;
  opMarginGood: number;
  revenueGrowthCollapse: number;
  debtToEquityHigh: number;
};

export function defaultValueThresholds(): ValueThresholds {
  return {
    peAttractive: THRESHOLDS.peAttractive,
    peExpensive: THRESHOLDS.peExpensive,
    forwardPeAttractive: THRESHOLDS.forwardPeAttractive,
    forwardPeExpensive: THRESHOLDS.forwardPeExpensive,
    pegAttractive: THRESHOLDS.pegAttractive,
    pegExpensive: THRESHOLDS.pegExpensive,
    fcfYieldAttractive: THRESHOLDS.fcfYieldAttractive,
    fcfYieldWeak: THRESHOLDS.fcfYieldWeak,
    evEbitdaAttractive: THRESHOLDS.evEbitdaAttractive,
    evEbitdaExpensive: THRESHOLDS.evEbitdaExpensive,
    pbAttractiveFinancials: THRESHOLDS.pbAttractiveFinancials,
    pbExpensiveFinancials: THRESHOLDS.pbExpensiveFinancials,
    roeGood: THRESHOLDS.roeGood,
    roeWeak: THRESHOLDS.roeWeak,
    roaGood: THRESHOLDS.roaGood,
    opMarginGood: THRESHOLDS.opMarginGood,
    revenueGrowthCollapse: THRESHOLDS.revenueGrowthCollapse,
    debtToEquityHigh: THRESHOLDS.debtToEquityHigh,
  };
}

/** Overlay playbook-derived PE/PEG/FCF bars onto base value thresholds. */
export function valueThresholdsFromPlaybook(pb: PlaybookThresholds): ValueThresholds {
  const base = defaultValueThresholds();
  return {
    ...base,
    peAttractive: pb.peAttractive,
    peExpensive: pb.peExpensive,
    forwardPeAttractive: pb.forwardPeAttractive,
    forwardPeExpensive: pb.forwardPeExpensive,
    pegAttractive: pb.pegAttractive,
    pegExpensive: pb.pegExpensive,
    fcfYieldAttractive: pb.fcfYieldAttractive,
  };
}

function isFinancialOrUtility(sector: string): boolean {
  const s = sector.toLowerCase();
  return (
    s.includes('financial') ||
    s.includes('bank') ||
    s.includes('insurance') ||
    s.includes('utilit') ||
    s.includes('real estate')
  );
}

function fmtPct(decimal: number): string {
  return `${(decimal * 100).toFixed(1)}%`;
}

function fmtNum(n: number, digits = 1): string {
  return n.toFixed(digits);
}

/**
 * Score undervaluation inputs from metrics only.
 * Missing fields are skipped (not invented). UNKNOWN when too little data.
 * Optional thresholds (from playbook) tilt PE/PEG/FCF cheapness bars.
 */
export function assessValue(
  m: FinancialMetrics,
  thresholds: ValueThresholds = defaultValueThresholds(),
): ValueAssessment {
  const T = thresholds;
  const signals: string[] = [];
  let cheapScore = 0;
  let cheapVotes = 0;
  let qualityScore = 0;
  let qualityVotes = 0;
  let trapScore = 0;

  if (m.fetchError) {
    return {
      ticker: m.ticker,
      cheapness: 'UNKNOWN',
      quality: 'UNKNOWN',
      trapRisk: 'UNKNOWN',
      signals: [`fetch failed: ${m.fetchError}`],
      summary: `${m.ticker}: metrics unavailable (${m.fetchError})`,
    };
  }

  const finUtil = isFinancialOrUtility(m.sector);

  // --- Cheapness ---
  if (m.trailingPE != null && m.trailingPE > 0) {
    cheapVotes++;
    if (m.trailingPE < T.peAttractive) {
      cheapScore++;
      signals.push(`trailing PE ${fmtNum(m.trailingPE)} < ${T.peAttractive} (cheap signal)`);
    } else if (m.trailingPE > T.peExpensive) {
      cheapScore--;
      signals.push(`trailing PE ${fmtNum(m.trailingPE)} > ${T.peExpensive} (expensive signal)`);
    } else {
      signals.push(`trailing PE ${fmtNum(m.trailingPE)} mid-range`);
    }
  }

  if (m.forwardPE != null && m.forwardPE > 0) {
    cheapVotes++;
    if (m.forwardPE < T.forwardPeAttractive) {
      cheapScore++;
      signals.push(`forward PE ${fmtNum(m.forwardPE)} < ${T.forwardPeAttractive} (cheap signal)`);
    } else if (m.forwardPE > T.forwardPeExpensive) {
      cheapScore--;
      signals.push(`forward PE ${fmtNum(m.forwardPE)} > ${T.forwardPeExpensive} (expensive signal)`);
    } else {
      signals.push(`forward PE ${fmtNum(m.forwardPE)} mid-range`);
    }
  }

  if (m.pegRatio != null && m.pegRatio > 0) {
    cheapVotes++;
    if (m.pegRatio < T.pegAttractive) {
      cheapScore++;
      signals.push(`PEG ${fmtNum(m.pegRatio, 2)} < ${T.pegAttractive} (GARP-cheap)`);
    } else if (m.pegRatio > T.pegExpensive) {
      cheapScore--;
      signals.push(`PEG ${fmtNum(m.pegRatio, 2)} > ${T.pegExpensive} (growth-expensive)`);
    } else {
      signals.push(`PEG ${fmtNum(m.pegRatio, 2)} mid-range`);
    }
  }

  if (m.fcfYield != null) {
    cheapVotes++;
    if (m.fcfYield >= T.fcfYieldAttractive) {
      cheapScore++;
      signals.push(`FCF yield ${fmtPct(m.fcfYield)} ≥ ${fmtPct(T.fcfYieldAttractive)} (cash cheap)`);
    } else if (m.fcfYield < T.fcfYieldWeak) {
      cheapScore--;
      signals.push(`FCF yield ${fmtPct(m.fcfYield)} < ${fmtPct(T.fcfYieldWeak)} (weak cash yield)`);
    } else {
      signals.push(`FCF yield ${fmtPct(m.fcfYield)} mid-range`);
    }
  }

  if (m.enterpriseToEbitda != null && m.enterpriseToEbitda > 0 && !finUtil) {
    cheapVotes++;
    if (m.enterpriseToEbitda < T.evEbitdaAttractive) {
      cheapScore++;
      signals.push(
        `EV/EBITDA ${fmtNum(m.enterpriseToEbitda)} < ${T.evEbitdaAttractive} (operating cheap)`,
      );
    } else if (m.enterpriseToEbitda > T.evEbitdaExpensive) {
      cheapScore--;
      signals.push(
        `EV/EBITDA ${fmtNum(m.enterpriseToEbitda)} > ${T.evEbitdaExpensive} (operating expensive)`,
      );
    } else {
      signals.push(`EV/EBITDA ${fmtNum(m.enterpriseToEbitda)} mid-range`);
    }
  }

  if (m.priceToBook != null && m.priceToBook > 0 && finUtil) {
    cheapVotes++;
    if (m.priceToBook < T.pbAttractiveFinancials) {
      cheapScore++;
      signals.push(`P/B ${fmtNum(m.priceToBook, 2)} < ${T.pbAttractiveFinancials} (book cheap, sector-fit)`);
    } else if (m.priceToBook > T.pbExpensiveFinancials) {
      cheapScore--;
      signals.push(`P/B ${fmtNum(m.priceToBook, 2)} > ${T.pbExpensiveFinancials} (book expensive)`);
    } else {
      signals.push(`P/B ${fmtNum(m.priceToBook, 2)} mid-range for financials/utilities`);
    }
  } else if (m.priceToBook != null && m.priceToBook > 0 && !finUtil) {
    signals.push(`P/B ${fmtNum(m.priceToBook, 2)} (secondary for non-financial; not scored alone)`);
  }

  if (m.earningsYield != null) {
    signals.push(`earnings yield ${fmtPct(m.earningsYield)} (1/PE)`);
  }

  // --- Quality ---
  if (m.returnOnEquity != null) {
    qualityVotes++;
    if (m.returnOnEquity >= T.roeGood) {
      qualityScore++;
      signals.push(`ROE ${fmtPct(m.returnOnEquity)} ≥ ${fmtPct(T.roeGood)} (quality)`);
    } else if (m.returnOnEquity < T.roeWeak) {
      qualityScore--;
      trapScore++;
      signals.push(`ROE ${fmtPct(m.returnOnEquity)} < ${fmtPct(T.roeWeak)} (weak profitability)`);
    } else {
      signals.push(`ROE ${fmtPct(m.returnOnEquity)} OK`);
    }
  }

  if (m.returnOnAssets != null) {
    qualityVotes++;
    if (m.returnOnAssets >= T.roaGood) {
      qualityScore++;
      signals.push(`ROA ${fmtPct(m.returnOnAssets)} ≥ ${fmtPct(T.roaGood)}`);
    } else if (m.returnOnAssets < 0) {
      qualityScore--;
      trapScore++;
      signals.push(`ROA ${fmtPct(m.returnOnAssets)} negative`);
    }
  }

  if (m.operatingMargins != null) {
    qualityVotes++;
    if (m.operatingMargins >= T.opMarginGood) {
      qualityScore++;
      signals.push(`op. margin ${fmtPct(m.operatingMargins)} solid`);
    } else if (m.operatingMargins < 0) {
      qualityScore--;
      trapScore++;
      signals.push(`op. margin ${fmtPct(m.operatingMargins)} negative`);
    }
  }

  if (m.revenueGrowth != null) {
    signals.push(`revenue growth ${fmtPct(m.revenueGrowth)}`);
    if (m.revenueGrowth < T.revenueGrowthCollapse) {
      trapScore++;
      signals.push(`revenue shrinking hard (< ${fmtPct(T.revenueGrowthCollapse)})`);
    }
  }

  // --- Trap risk extras ---
  if (m.debtToEquity != null && m.debtToEquity > T.debtToEquityHigh) {
    trapScore++;
    signals.push(`D/E ${fmtNum(m.debtToEquity, 1)} > ${T.debtToEquityHigh} (leverage risk)`);
  }

  if (m.freeCashflow != null && m.freeCashflow < 0 && !finUtil) {
    trapScore++;
    signals.push(`free cash flow negative (${m.freeCashflow})`);
  }

  // Cheap + weak quality → classic trap pattern
  if (cheapScore > 0 && qualityScore < 0) {
    trapScore += 2;
    signals.push('cheap + weak quality pattern (value-trap risk)');
  }

  const cheapness = verdictCheap(cheapScore, cheapVotes);
  const quality = verdictQuality(qualityScore, qualityVotes);
  const trapRisk = verdictTrap(trapScore, cheapVotes + qualityVotes);

  const summary = `${m.ticker}: cheapness=${cheapness} quality=${quality} trapRisk=${trapRisk}`;

  return {
    ticker: m.ticker,
    cheapness,
    quality,
    trapRisk,
    signals,
    summary,
  };
}

function verdictCheap(score: number, votes: number): CheapnessVerdict {
  if (votes < 1) return 'UNKNOWN';
  if (score >= 2) return 'YES';
  if (score <= -2) return 'NO';
  if (score >= 1 && votes >= 2) return 'YES';
  if (score <= -1 && votes >= 2) return 'NO';
  return 'MIXED';
}

function verdictQuality(score: number, votes: number): QualityVerdict {
  if (votes < 1) return 'UNKNOWN';
  if (score >= 2) return 'STRONG';
  if (score <= -1) return 'WEAK';
  return 'OK';
}

function verdictTrap(trapScore: number, dataVotes: number): TrapRisk {
  if (dataVotes < 1) return 'UNKNOWN';
  if (trapScore >= 3) return 'HIGH';
  if (trapScore >= 1) return 'ELEVATED';
  return 'LOW';
}

/** Rank tickers for undervalued short-list: prefer YES cheapness, LOW trap, STRONG/OK quality. */
export function rankValueCandidates(assessments: ValueAssessment[]): ValueAssessment[] {
  const cheapRank: Record<CheapnessVerdict, number> = { YES: 0, MIXED: 1, UNKNOWN: 2, NO: 3 };
  const trapRank: Record<TrapRisk, number> = { LOW: 0, UNKNOWN: 1, ELEVATED: 2, HIGH: 3 };
  const qualityRank: Record<QualityVerdict, number> = { STRONG: 0, OK: 1, UNKNOWN: 2, WEAK: 3 };

  return [...assessments].sort((a, b) => {
    const c = cheapRank[a.cheapness] - cheapRank[b.cheapness];
    if (c !== 0) return c;
    const t = trapRank[a.trapRisk] - trapRank[b.trapRisk];
    if (t !== 0) return t;
    return qualityRank[a.quality] - qualityRank[b.quality];
  });
}

/** Derive yield fields; only when inputs exist. Throws if marketCap/PE invalid when used. */
export function deriveYields(input: {
  trailingPE: number | null;
  marketCap: number | null;
  enterpriseValue: number | null;
  freeCashflow: number | null;
}): {
  earningsYield: number | null;
  fcfYield: number | null;
  fcfYieldOnEv: number | null;
} {
  let earningsYield: number | null = null;
  if (input.trailingPE != null) {
    if (input.trailingPE <= 0) {
      earningsYield = null;
    } else {
      earningsYield = 1 / input.trailingPE;
    }
  }

  let fcfYield: number | null = null;
  if (input.freeCashflow != null && input.marketCap != null) {
    if (input.marketCap <= 0) {
      throw new Error(`deriveYields: marketCap must be > 0, got ${input.marketCap}`);
    }
    fcfYield = input.freeCashflow / input.marketCap;
  }

  let fcfYieldOnEv: number | null = null;
  if (input.freeCashflow != null && input.enterpriseValue != null) {
    if (input.enterpriseValue <= 0) {
      throw new Error(`deriveYields: enterpriseValue must be > 0, got ${input.enterpriseValue}`);
    }
    fcfYieldOnEv = input.freeCashflow / input.enterpriseValue;
  }

  return { earningsYield, fcfYield, fcfYieldOnEv };
}

export function emptyMetrics(ticker: string, fetchError?: string): FinancialMetrics {
  return {
    ticker,
    shortName: ticker,
    sector: 'N/A',
    trailingPE: null,
    forwardPE: null,
    pegRatio: null,
    priceToBook: null,
    returnOnEquity: null,
    returnOnAssets: null,
    marketCap: null,
    enterpriseValue: null,
    enterpriseToEbitda: null,
    ebitda: null,
    freeCashflow: null,
    operatingCashflow: null,
    totalCash: null,
    totalDebt: null,
    debtToEquity: null,
    currentRatio: null,
    profitMargins: null,
    operatingMargins: null,
    grossMargins: null,
    revenueGrowth: null,
    earningsGrowth: null,
    fcfYield: null,
    earningsYield: null,
    fcfYieldOnEv: null,
    ...(fetchError ? { fetchError } : {}),
  };
}
