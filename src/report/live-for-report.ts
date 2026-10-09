import type { Holding } from '../market/types.js';
import type { OptionLiveMark } from '../market/fetch-option-marks.js';
import { fetchFxRates } from '../market/fetch-fx.js';
import { getCashes, getDeposits, type InvestorState } from '../state/portfolio-state.js';
import { getReportingCurrency, type HouseholdInvestorState } from '../state/household-state.js';
import { buildLivePositions, type DashboardFxOptions, type LiveDashboardSlice } from './dashboard-model.js';

/** Strict, currency-consistent valuation for saved and emailed dashboard reports. */
export async function liveForDashboardReport(
  state: InvestorState,
  portfolio: Record<string, Holding>,
  prices: Record<string, number>,
  optionMarks: Record<string, OptionLiveMark>,
): Promise<LiveDashboardSlice> {
  const cash = getCashes(state);
  const deposits = getDeposits(state);
  const reportingCurrency = getReportingCurrency(state as HouseholdInvestorState);
  const currencies = [...new Set([
    ...Object.values(portfolio).map((holding) => holding.currency).filter((c): c is string => !!c),
    ...cash.filter((row) => row.amount !== 0).map((row) => row.currency),
    ...deposits.filter((row) => row.amount !== 0).map((row) => row.currency),
  ])];
  const foreign = currencies.filter((currency) => currency !== reportingCurrency);
  const fx: DashboardFxOptions = {
    reportingCurrency, fxRates: foreign.length ? await fetchFxRates(foreign, reportingCurrency) : {},
  };
  const live = buildLivePositions(portfolio, prices, optionMarks, cash, deposits,
    undefined, fx, { reportingCurrency });
  if (live.navComplete === false) {
    throw new Error('Dashboard report NAV unavailable: record every holding currency.');
  }
  return live;
}
