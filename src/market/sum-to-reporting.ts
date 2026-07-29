/**
 * Aggregate multi-currency cash / deposits into a reporting currency with live FX.
 */

import {
  cashCurrencies,
  depositCurrencies,
  totalCash,
  totalDepositsPrincipal,
  type CashBalance,
  type FixedDeposit,
  type MultiCurrencySumOptions,
} from '../state/portfolio-state.js';
import { fetchFxRates } from './fetch-fx.js';

export interface LiveSumResult<T> {
  total: T;
  fxRates: Record<string, number>;
  fxApplied: boolean;
  reportingCurrency: string;
}

/**
 * Sum cash. Same-currency → native total (no FX).
 * Mixed → require reportingCurrency, fetch live FX, return total in reporting ccy.
 */
export async function totalCashLive(
  cashes: CashBalance[],
  reportingCurrency: string | null | undefined,
): Promise<LiveSumResult<CashBalance | null>> {
  if (cashes.length === 0) {
    return {
      total: null,
      fxRates: {},
      fxApplied: false,
      reportingCurrency: reportingCurrency?.trim().toUpperCase() ?? '',
    };
  }
  const currencies = cashCurrencies(cashes);
  if (currencies.length === 1) {
    const total = totalCash(cashes);
    return {
      total,
      fxRates: {},
      fxApplied: false,
      reportingCurrency: currencies[0],
    };
  }
  const rep = reportingCurrency?.trim().toUpperCase();
  if (rep == null || rep.length === 0) {
    throw new Error(
      `Cannot sum cash across currencies (${cashes.map((c) => c.currency).join(', ')}). ` +
        'Set treasury.reporting_currency (set_treasury) so totals convert with live FX, ' +
        'or keep all cash in one currency.',
    );
  }
  const fxRates = await fetchFxRates(currencies, rep);
  const opts: MultiCurrencySumOptions = { reportingCurrency: rep, fxRates };
  return {
    total: totalCash(cashes, opts),
    fxRates,
    fxApplied: true,
    reportingCurrency: rep,
  };
}

/**
 * Sum deposit principals with the same rules as {@link totalCashLive}.
 */
export async function totalDepositsLive(
  deposits: FixedDeposit[],
  reportingCurrency: string | null | undefined,
): Promise<LiveSumResult<{ amount: number; currency: string } | null>> {
  if (deposits.length === 0) {
    return {
      total: null,
      fxRates: {},
      fxApplied: false,
      reportingCurrency: reportingCurrency?.trim().toUpperCase() ?? '',
    };
  }
  const currencies = depositCurrencies(deposits);
  if (currencies.length === 1) {
    return {
      total: totalDepositsPrincipal(deposits),
      fxRates: {},
      fxApplied: false,
      reportingCurrency: currencies[0],
    };
  }
  const rep = reportingCurrency?.trim().toUpperCase();
  if (rep == null || rep.length === 0) {
    throw new Error(
      `Cannot sum deposits across currencies (${deposits.map((d) => d.currency).join(', ')}). ` +
        'Set treasury.reporting_currency (set_treasury) so totals convert with live FX, ' +
        'or keep all deposits in one currency.',
    );
  }
  const fxRates = await fetchFxRates(currencies, rep);
  const opts: MultiCurrencySumOptions = { reportingCurrency: rep, fxRates };
  return {
    total: totalDepositsPrincipal(deposits, opts),
    fxRates,
    fxApplied: true,
    reportingCurrency: rep,
  };
}

/** Collect unique currencies from cash + deposits for a combined FX fetch. */
export function collectMoneyCurrencies(
  cashes: Array<{ currency: string }>,
  deposits: Array<{ currency: string }> = [],
): string[] {
  return [
    ...new Set(
      [...cashes, ...deposits].map((x) => x.currency.trim().toUpperCase()).filter(Boolean),
    ),
  ].sort();
}
