/**
 * Listed options insight — structure math + Yahoo chain facts.
 *
 * Premium on Yahoo is **per share**. Invage books premium is **$ per contract**.
 * Never invent IV, OI, volume, or Greeks. Omit when Yahoo does not provide them.
 */

import { yf } from './yf-client.js';
import { fetchPriceSnapshots } from './fetch-prices.js';
import { pickPerSharePremium, toDateKey, type YahooContractRow } from './fetch-option-marks.js';
import type { OptionRight, OptionSide } from './types.js';

export type Moneyness = 'ITM' | 'ATM' | 'OTM';
export type IvVsAtm = 'cheap_vs_atm' | 'rich_vs_atm' | 'in_line' | 'unavailable';

export type ChainContract = YahooContractRow & {
  impliedVolatility?: number;
  openInterest?: number;
  volume?: number;
  inTheMoney?: boolean;
};

export function daysToExpiry(asOfYmd: string, expiryYmd: string): number {
  const a = Date.parse(`${asOfYmd}T00:00:00Z`);
  const b = Date.parse(`${expiryYmd}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) {
    throw new Error(`Invalid date for DTE: asOf=${asOfYmd} expiry=${expiryYmd}`);
  }
  const dte = Math.round((b - a) / 86_400_000);
  if (dte < 0) {
    throw new Error(`Option expired: expiry ${expiryYmd} is before as-of ${asOfYmd}.`);
  }
  return dte;
}

export function classifyMoneyness(
  spot: number,
  strike: number,
  right: OptionRight,
): Moneyness {
  if (!(spot > 0) || !(strike > 0)) {
    throw new Error('spot and strike must be finite numbers > 0.');
  }
  const rel = Math.abs(spot - strike) / spot;
  if (rel <= 0.005) return 'ATM';
  if (right === 'call') return spot > strike ? 'ITM' : 'OTM';
  return spot < strike ? 'ITM' : 'OTM';
}

export function intrinsicPerShare(
  spot: number,
  strike: number,
  right: OptionRight,
): number {
  if (right === 'call') return Math.max(spot - strike, 0);
  return Math.max(strike - spot, 0);
}

export function structureEconomics(input: {
  right: OptionRight;
  side: OptionSide;
  strike: number;
  premiumPerShare: number;
  multiplier: number;
  units: number;
}): {
  premiumPerContract: number;
  breakevenPerShare: number;
  maxLoss: number | null;
  maxGain: number | null;
  undefinedRisk: boolean;
  assignmentCash: number | null;
} {
  const { right, side, strike, premiumPerShare, multiplier, units } = input;
  if (!(premiumPerShare >= 0) || !Number.isFinite(premiumPerShare)) {
    throw new Error('premiumPerShare must be a finite number ≥ 0.');
  }
  if (!(multiplier > 0) || !(units > 0)) {
    throw new Error('multiplier and units must be finite numbers > 0.');
  }
  const premiumPerContract = Number((premiumPerShare * multiplier).toFixed(2));
  const totalPremium = Number((premiumPerContract * units).toFixed(2));
  const assignmentCash = Number((strike * multiplier * units).toFixed(2));

  if (right === 'call' && side === 'long') {
    return {
      premiumPerContract,
      breakevenPerShare: Number((strike + premiumPerShare).toFixed(4)),
      maxLoss: totalPremium,
      maxGain: null,
      undefinedRisk: false,
      assignmentCash: null,
    };
  }
  if (right === 'call' && side === 'short') {
    return {
      premiumPerContract,
      breakevenPerShare: Number((strike + premiumPerShare).toFixed(4)),
      maxLoss: null,
      maxGain: totalPremium,
      undefinedRisk: true,
      assignmentCash: null,
    };
  }
  if (right === 'put' && side === 'long') {
    return {
      premiumPerContract,
      breakevenPerShare: Number((strike - premiumPerShare).toFixed(4)),
      maxLoss: totalPremium,
      maxGain: Number((assignmentCash - totalPremium).toFixed(2)),
      undefinedRisk: false,
      assignmentCash: null,
    };
  }
  return {
    premiumPerContract,
    breakevenPerShare: Number((strike - premiumPerShare).toFixed(4)),
    maxLoss: Number((assignmentCash - totalPremium).toFixed(2)),
    maxGain: totalPremium,
    undefinedRisk: false,
    assignmentCash,
  };
}

export function relativeIv(
  contractIv: number | null | undefined,
  atmIv: number | null | undefined,
): IvVsAtm {
  if (
    contractIv == null ||
    atmIv == null ||
    !(contractIv > 0) ||
    !(atmIv > 0) ||
    !Number.isFinite(contractIv) ||
    !Number.isFinite(atmIv)
  ) {
    return 'unavailable';
  }
  const ratio = contractIv / atmIv;
  if (ratio > 1.15) return 'rich_vs_atm';
  if (ratio < 0.85) return 'cheap_vs_atm';
  return 'in_line';
}

export function putCallOpenInterestRatio(
  calls: Array<{ openInterest?: number }>,
  puts: Array<{ openInterest?: number }>,
): number | null {
  const callOi = calls.reduce((s, r) => s + (r.openInterest ?? 0), 0);
  const putOi = puts.reduce((s, r) => s + (r.openInterest ?? 0), 0);
  if (!(callOi > 0) || !(putOi >= 0)) return null;
  return Number((putOi / callOi).toFixed(3));
}

function usableIv(v: number | undefined): number | null {
  if (v == null || !Number.isFinite(v) || !(v > 0)) return null;
  return v;
}

export function atmImpliedVol(
  rows: ChainContract[],
  spot: number,
): number | null {
  if (rows.length === 0) return null;
  let best = rows[0];
  let bestDist = Math.abs(best.strike - spot);
  for (const r of rows) {
    const d = Math.abs(r.strike - spot);
    if (d < bestDist) {
      best = r;
      bestDist = d;
    }
  }
  return usableIv(best.impliedVolatility);
}

export function bidAskSpreadPct(row: ChainContract): number | null {
  const bid = row.bid;
  const ask = row.ask;
  if (
    bid == null ||
    ask == null ||
    !Number.isFinite(bid) ||
    !Number.isFinite(ask) ||
    !(ask > 0) ||
    ask < bid
  ) {
    return null;
  }
  const mid = (bid + ask) / 2;
  if (!(mid > 0)) return null;
  return Number((((ask - bid) / mid) * 100).toFixed(2));
}

export type ContractInsight = {
  underlying: string;
  right: OptionRight;
  side: OptionSide;
  strike: number;
  expiry: string;
  dte: number;
  spot: number;
  currency: string;
  moneyness: Moneyness;
  intrinsicPerShare: number;
  premiumPerShare: number;
  extrinsicPerShare: number;
  economics: ReturnType<typeof structureEconomics>;
  impliedVolatility: number | null;
  atmIv: number | null;
  ivVsAtm: IvVsAtm;
  openInterest: number | null;
  volume: number | null;
  bid: number | null;
  ask: number | null;
  spreadPct: number | null;
  contractSymbol: string | null;
  yahooInTheMoney: boolean | null;
  putCallOiRatio: number | null;
};

export function buildContractInsight(input: {
  underlying: string;
  right: OptionRight;
  side: OptionSide;
  units: number;
  multiplier: number;
  spot: number;
  currency: string;
  asOfYmd: string;
  expiry: string;
  row: ChainContract;
  calls: ChainContract[];
  puts: ChainContract[];
}): ContractInsight {
  const premiumPerShare = pickPerSharePremium(input.row);
  const intrinsic = intrinsicPerShare(input.spot, input.row.strike, input.right);
  const atm =
    input.right === 'call'
      ? atmImpliedVol(input.calls, input.spot)
      : atmImpliedVol(input.puts, input.spot);
  const iv = usableIv(input.row.impliedVolatility);
  return {
    underlying: input.underlying,
    right: input.right,
    side: input.side,
    strike: input.row.strike,
    expiry: input.expiry,
    dte: daysToExpiry(input.asOfYmd, input.expiry),
    spot: input.spot,
    currency: input.currency,
    moneyness: classifyMoneyness(input.spot, input.row.strike, input.right),
    intrinsicPerShare: Number(intrinsic.toFixed(4)),
    premiumPerShare: Number(premiumPerShare.toFixed(4)),
    extrinsicPerShare: Number(Math.max(premiumPerShare - intrinsic, 0).toFixed(4)),
    economics: structureEconomics({
      right: input.right,
      side: input.side,
      strike: input.row.strike,
      premiumPerShare,
      multiplier: input.multiplier,
      units: input.units,
    }),
    impliedVolatility: iv,
    atmIv: atm,
    ivVsAtm: relativeIv(iv, atm),
    openInterest: input.row.openInterest ?? null,
    volume: input.row.volume ?? null,
    bid: input.row.bid ?? null,
    ask: input.row.ask ?? null,
    spreadPct: bidAskSpreadPct(input.row),
    contractSymbol: input.row.contractSymbol ?? null,
    yahooInTheMoney: input.row.inTheMoney ?? null,
    putCallOiRatio: putCallOpenInterestRatio(input.calls, input.puts),
  };
}

export type LoadedChain = {
  underlying: string;
  spot: number;
  currency: string;
  asOfYmd: string;
  expirationDates: string[];
  expiry: string;
  calls: ChainContract[];
  puts: ChainContract[];
};

function todayUtcYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function asChainContract(row: unknown): ChainContract {
  if (row == null || typeof row !== 'object') {
    throw new Error('Yahoo contract row is not an object.');
  }
  const r = row as Record<string, unknown>;
  if (typeof r.strike !== 'number' || !Number.isFinite(r.strike)) {
    throw new Error('Yahoo contract row missing strike.');
  }
  return row as ChainContract;
}

export async function loadOptionsChain(
  underlying: string,
  expiryYmd?: string,
): Promise<LoadedChain> {
  const symbol = underlying.trim().toUpperCase();
  if (!symbol) throw new Error('underlying is required.');

  const snaps = await fetchPriceSnapshots([symbol]);
  const snap = snaps[symbol];
  if (!snap) {
    throw new Error(`No Yahoo underlying quote for ${symbol}. Do not invent spot.`);
  }

  let raw;
  try {
    raw = expiryYmd
      ? await yf.options(symbol, { date: expiryYmd })
      : await yf.options(symbol);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Yahoo options chain failed for ${symbol}: ${msg}`);
  }

  const expirationDates = (raw.expirationDates ?? []).map((d) => toDateKey(d));
  if (expirationDates.length === 0) {
    throw new Error(`Yahoo returned no option expirations for ${symbol}.`);
  }

  const asOfYmd = todayUtcYmd();
  let expiry = expiryYmd;
  if (!expiry) {
    expiry = expirationDates.find((d) => d >= asOfYmd) ?? expirationDates[0];
  }
  if (!expirationDates.includes(expiry) && expiryYmd) {
    throw new Error(
      `Expiry ${expiryYmd} not in Yahoo expiration list for ${symbol}. ` +
        `Available sample: ${expirationDates.slice(0, 8).join(', ')}${expirationDates.length > 8 ? '…' : ''}`,
    );
  }

  const series =
    raw.options?.find((s) => s.expirationDate != null && toDateKey(s.expirationDate) === expiry) ??
    raw.options?.[0];
  if (!series) {
    throw new Error(`Yahoo returned no option series for ${symbol} @ ${expiry}.`);
  }

  return {
    underlying: symbol,
    spot: snap.price,
    currency: snap.currency,
    asOfYmd,
    expirationDates,
    expiry,
    calls: (series.calls ?? []).map(asChainContract),
    puts: (series.puts ?? []).map(asChainContract),
  };
}

export function findContract(
  rows: ChainContract[],
  strike: number,
  expiryYmd: string,
): ChainContract {
  const matches = rows.filter((r) => {
    if (Math.abs(r.strike - strike) > 1e-6) return false;
    if (r.expiration != null && toDateKey(r.expiration) !== expiryYmd) return false;
    return true;
  });
  if (matches.length === 0) {
    const strikes = rows.map((r) => r.strike).sort((a, b) => a - b);
    const near = strikes.filter((s) => Math.abs(s - strike) <= 5).slice(0, 10);
    throw new Error(
      `No Yahoo strike ${strike} @ ${expiryYmd}. ` +
        (near.length
          ? `Nearby strikes: ${near.join(', ')}`
          : `Strikes on series: ${strikes.slice(0, 12).join(', ')}`),
    );
  }
  return matches[0];
}

export function nearestStrikes(rows: ChainContract[], spot: number, n: number): ChainContract[] {
  return [...rows]
    .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))
    .slice(0, n)
    .sort((a, b) => a.strike - b.strike);
}

export function formatMoney(n: number, ccy: string): string {
  return `${ccy} ${n.toFixed(2)}`;
}

export function formatContractInsight(insight: ContractInsight): string {
  const e = insight.economics;
  const ivPct =
    insight.impliedVolatility != null
      ? `${(insight.impliedVolatility * 100).toFixed(1)}% (Yahoo impliedVolatility)`
      : 'unavailable (not invented)';
  const atmPct =
    insight.atmIv != null ? `${(insight.atmIv * 100).toFixed(1)}%` : 'unavailable';
  const maxGain = e.maxGain == null ? 'undefined (naked short call)' : formatMoney(e.maxGain, insight.currency);
  const maxLoss = e.maxLoss == null ? 'undefined (naked short call)' : formatMoney(e.maxLoss, insight.currency);
  const lines = [
    `${insight.underlying} ${insight.right.toUpperCase()} ${insight.strike} ${insight.expiry} ${insight.side}`,
    `Underlying spot: ${formatMoney(insight.spot, insight.currency)} | DTE: ${insight.dte}`,
    `Moneyness: ${insight.moneyness}` +
      (insight.yahooInTheMoney != null ? ` (Yahoo inTheMoney=${insight.yahooInTheMoney})` : ''),
    `Premium/share: ${insight.premiumPerShare} | intrinsic/share: ${insight.intrinsicPerShare} | extrinsic/share: ${insight.extrinsicPerShare}`,
    `Premium/contract: ${formatMoney(e.premiumPerContract, insight.currency)} | breakeven/share: ${e.breakevenPerShare}`,
    `Max loss: ${maxLoss} | max gain: ${maxGain} | undefined risk: ${e.undefinedRisk}`,
    e.assignmentCash != null
      ? `Short-put assignment cash if assigned: ${formatMoney(e.assignmentCash, insight.currency)}`
      : null,
    `IV: ${ivPct} | ATM IV (${insight.right}): ${atmPct} | vs ATM: ${insight.ivVsAtm}`,
    `OI: ${insight.openInterest ?? 'unavailable'} | volume: ${insight.volume ?? 'unavailable'} | bid/ask: ${insight.bid ?? 'n/a'}/${insight.ask ?? 'n/a'} | spread%: ${insight.spreadPct ?? 'unavailable'}`,
    insight.putCallOiRatio != null
      ? `Expiry put/call OI ratio: ${insight.putCallOiRatio}`
      : 'Expiry put/call OI ratio: unavailable',
    insight.contractSymbol ? `Yahoo contractSymbol: ${insight.contractSymbol}` : null,
    'Greeks (delta/gamma/theta/vega): not in Yahoo chain payload — unavailable, not invented.',
  ];
  return lines.filter((x): x is string => x != null).join('\n');
}
