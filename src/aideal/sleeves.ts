/**
 * Excelsis / Aideal Investment sleeve catalog.
 *
 * Tickers document the SL universe. Index weights come from books lots
 * (`holding.category === sleeve.id`) or explicit tool `lots` — never invented.
 */

import type { Holding } from '../market/types.js';
import type { SleeveLot } from './index-math.js';

export interface AidealSleeve {
  id: string;
  label: string;
  benchmark: string;
  /** YYYY-MM-DD — sleeve index = 100 on this date. */
  baseDate: string;
  /** Documented universe (not a silent lots source). */
  tickers: string[];
}

export const AIDEAL_SLEEVES: readonly AidealSleeve[] = [
  {
    id: 'financial',
    label: 'Financial',
    benchmark: 'SPY',
    baseDate: '2025-07-29',
    tickers: ['BRK-B'],
  },
  {
    id: 'healthcare',
    label: 'Healthcare',
    benchmark: 'IYH',
    baseDate: '2025-08-12',
    tickers: [
      'LLY',
      'JNJ',
      'ABBV',
      'UNH',
      'ABT',
      'MRK',
      'TMO',
      'ISRG',
      'AMGN',
      'BSX',
      'GILD',
      'PFE',
      'SYK',
      'DHR',
      'MDT',
      'VRTX',
      'BMY',
      'CI',
    ],
  },
  {
    id: 'aerospace',
    label: 'Aerospace',
    benchmark: 'ITA',
    baseDate: '2025-08-12',
    tickers: [
      'GE',
      'BA',
      'RTX',
      'LMT',
      'NOC',
      'GD',
      'HON',
      'LHX',
      'AXON',
      'HWM',
      'PH',
      'TDG',
      'ETN',
      'ESLT',
      'HEI',
      'LDOS',
      'BWXT',
      'CW',
    ],
  },
  {
    id: 'food-staples',
    label: 'Food Staples',
    benchmark: 'VDC',
    baseDate: '2025-08-14',
    tickers: [
      'COST',
      'WMT',
      'PG',
      'KO',
      'PEP',
      'MDLZ',
      'CL',
      'MNST',
      'KR',
      'TGT',
      'KDP',
      'KMB',
      'KVUE',
      'SYY',
      'GIS',
      'ADM',
      'DG',
      'HSY',
      'CHD',
    ],
  },
  {
    id: 'utility',
    label: 'Utility',
    benchmark: 'XLU',
    baseDate: '2025-08-14',
    tickers: [
      'NEE',
      'SO',
      'CEG',
      'DUK',
      'VST',
      'AEP',
      'SRE',
      'D',
      'EXC',
      'PEG',
      'XEL',
      'ED',
      'EIX',
      'PPL',
      'WEC',
      'CMS',
      'AES',
      'NRG',
      'AVA',
    ],
  },
  {
    id: 'technology',
    label: 'Technology',
    benchmark: 'QQQ',
    baseDate: '2025-11-13',
    tickers: ['QQQ', 'TSLA', 'MSFT', 'AAPL', 'META', 'GOOGL'],
  },
  {
    id: 'overall',
    label: 'Overall',
    benchmark: 'SPY',
    baseDate: '2025-09-22',
    tickers: [],
  },
] as const;

const BY_ID = new Map(AIDEAL_SLEEVES.map((s) => [s.id, s]));

const CRAFT_SLEEVE_IDS = AIDEAL_SLEEVES.filter((s) => s.id !== 'overall').map((s) => s.id);

export function getAidealSleeve(id: string): AidealSleeve {
  const sleeve = BY_ID.get(id);
  if (!sleeve) {
    throw new Error(
      `Unknown Aideal sleeve "${id}". Known: ${AIDEAL_SLEEVES.map((s) => s.id).join(', ')}.`,
    );
  }
  return sleeve;
}

/** Map key may be TICKER or TICKER@channel. */
export function lotTickerFromKey(key: string): string {
  const at = key.indexOf('@');
  return (at >= 0 ? key.slice(0, at) : key).trim().toUpperCase();
}

/**
 * Lots for a sleeve: holdings whose `category` matches the sleeve id.
 * Overall = union of the six craft-sleeve categories.
 */
export function lotsFromPortfolio(
  sleeve: AidealSleeve,
  portfolio: Record<string, Holding>,
): SleeveLot[] {
  const allowed =
    sleeve.id === 'overall' ? new Set(CRAFT_SLEEVE_IDS) : new Set([sleeve.id]);
  const lots: SleeveLot[] = [];
  for (const [key, holding] of Object.entries(portfolio)) {
    const category = holding.category?.trim();
    if (category == null || category.length === 0 || !allowed.has(category)) {
      continue;
    }
    if (!(holding.units > 0) || !Number.isFinite(holding.units)) {
      throw new Error(
        `Holding "${key}" units must be positive and finite, got ${holding.units}.`,
      );
    }
    lots.push({ ticker: lotTickerFromKey(key), units: holding.units });
  }
  return lots;
}
