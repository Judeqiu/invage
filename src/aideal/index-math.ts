/**
 * SL / Aideal sleeve index: rebase sleeve NAV and benchmark to 100 on the
 * sleeve base date. Same ratio as "avg price now / avg price base" when
 * units are held constant.
 */

export interface SleeveLot {
  ticker: string;
  units: number;
}

export interface SleeveIndexInput {
  sleeveId: string;
  label: string;
  benchmark: string;
  baseDate: string;
  reportDate: string;
  lots: SleeveLot[];
  /** Adjusted close (or last trade) on/before baseDate. Must include every lot ticker + benchmark. */
  basePrices: Record<string, number>;
  /** Adjusted close on/before reportDate. Must include every lot ticker + benchmark. */
  reportPrices: Record<string, number>;
}

export interface SleeveIndexResult {
  sleeveId: string;
  label: string;
  benchmark: string;
  baseDate: string;
  reportDate: string;
  sleeveValueBase: number;
  sleeveValueNow: number;
  fundIndex: number;
  benchmarkIndex: number;
  vsBenchmark: number;
  lotCount: number;
}

function requirePrice(map: Record<string, number>, ticker: string, when: string): number {
  const px = map[ticker];
  if (px == null || !Number.isFinite(px) || px <= 0) {
    throw new Error(
      `Missing or non-positive ${when} price for ${ticker}. Do not invent prices.`,
    );
  }
  return px;
}

function sleeveValue(lots: SleeveLot[], prices: Record<string, number>, when: string): number {
  let sum = 0;
  for (const lot of lots) {
    if (!(lot.units > 0) || !Number.isFinite(lot.units)) {
      throw new Error(`Lot ${lot.ticker} units must be positive and finite, got ${lot.units}.`);
    }
    sum += lot.units * requirePrice(prices, lot.ticker, when);
  }
  return sum;
}

export function computeSleeveIndex(input: SleeveIndexInput): SleeveIndexResult {
  if (input.lots.length === 0) {
    throw new Error(
      `computeSleeveIndex: sleeve "${input.sleeveId}" has no lots. ` +
        `Journal holdings with category=${input.sleeveId} via Bookkeeper, or pass lots.`,
    );
  }
  const sleeveValueBase = sleeveValue(input.lots, input.basePrices, `base (${input.baseDate})`);
  const sleeveValueNow = sleeveValue(input.lots, input.reportPrices, `report (${input.reportDate})`);
  if (!(sleeveValueBase > 0)) {
    throw new Error(
      `computeSleeveIndex: sleeve "${input.sleeveId}" base value is ${sleeveValueBase}.`,
    );
  }
  const benchBase = requirePrice(input.basePrices, input.benchmark, `base (${input.baseDate})`);
  const benchNow = requirePrice(input.reportPrices, input.benchmark, `report (${input.reportDate})`);
  const fundIndex = round4((sleeveValueNow / sleeveValueBase) * 100);
  const benchmarkIndex = round4((benchNow / benchBase) * 100);
  return {
    sleeveId: input.sleeveId,
    label: input.label,
    benchmark: input.benchmark,
    baseDate: input.baseDate,
    reportDate: input.reportDate,
    sleeveValueBase: round4(sleeveValueBase),
    sleeveValueNow: round4(sleeveValueNow),
    fundIndex,
    benchmarkIndex,
    vsBenchmark: round4(fundIndex - benchmarkIndex),
    lotCount: input.lots.length,
  };
}

function round4(n: number): number {
  return Number(n.toFixed(4));
}
