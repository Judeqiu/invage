import { rankingValues, type StockData, type PeerRanking } from './stock-data.js';
import type { ResearchAnalysis, ResearchDiscovery, ResearchClaim } from './stock-model.js';

/** Financial commentary is reproducible from the retrieved figures, never retyped by a model. */
export function summarizeStockFinancials(stock: StockData, ranking: PeerRanking, discovery: ResearchDiscovery): ResearchAnalysis {
  const sourceIds = [`data:${stock.ticker}`];
  const claim = (text: string): ResearchClaim => ({ text, sourceIds });
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
  const number = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const metrics = rankingValues(stock), annual = stock.annual[0], prior = stock.annual[1];
  const financials: ResearchClaim[] = [], valuation: ResearchClaim[] = [], gaps: string[] = [];
  if (metrics.growth !== null && annual && prior) financials.push(claim(`Annual revenue changed ${percent(metrics.growth)} between fiscal periods ending ${prior.end} and ${annual.end}. This is reported annual growth, not a forecast.`));
  if (metrics.profitability !== null && annual) financials.push(claim(`Operating margin was ${percent(metrics.profitability)} for the annual period ending ${annual.end}, calculated as operating income divided by revenue.`));
  if (annual?.netIncome !== null && annual?.netIncome !== undefined) financials.push(claim(`Annual net income for ${annual.end} was ${number(annual.netIncome)} ${stock.financialCurrency ?? '(financial currency unverified)'}. ${annual.netIncome < 0 ? 'The annual period was loss-making.' : 'This figure is a historical annual result.'}`));
  if (annual?.freeCashFlow !== null && annual?.freeCashFlow !== undefined) financials.push(claim(`Annual free cash flow for ${annual.end} was ${number(annual.freeCashFlow)} ${stock.financialCurrency ?? '(financial currency unverified)'}. ${annual.freeCashFlow < 0 ? 'Cash generation remains a material monitoring point.' : annual.freeCashFlow > 0 ? 'Positive free cash flow in this period is not a forecast of future cash generation.' : 'Zero free cash flow was reported for this period.'}`));
  if (metrics.balanceSheet !== null && annual) financials.push(claim(`Reported debt divided by total assets was ${percent(metrics.balanceSheet)} at ${annual.end}. This is a balance-sheet ratio, not a solvency rating.`));
  if (stock.trailingPE !== null && stock.trailingPE > 0) valuation.push(claim(`The provider reports trailing P/E of ${number(stock.trailingPE)}. Peer ranking compares this positive multiple only within the disclosed eligible sample; a lower multiple alone does not establish undervaluation.`));
  else valuation.push(claim('Positive trailing P/E is unavailable or not meaningful in this provider snapshot. The composite screen requires this factor and is withheld when the target lacks it.'));
  if (stock.forwardPE !== null && stock.forwardPE > 0) valuation.push(claim(`Forward P/E is ${number(stock.forwardPE)} in the provider snapshot. It relies on estimates and is separate from the reported trailing multiple.`));
  if (!annual) gaps.push('Financial interpretation is unavailable without dated annual statements.');
  if (!discovery.catalysts.length) gaps.push('No dated catalysts were verified in the retrieved issuer evidence.');
  if (!discovery.risks.length) gaps.push('No issuer risk claims were supplied; consult the linked filings before making an investment decision.');
  return { conclusion: { text: `${stock.name}: ${annual ? `annual evidence through ${annual.end}` : 'annual financial evidence unavailable'}. ${ranking.explanation} This is a source-led company review; the peer screen and analyst consensus are not a trade recommendation or a fair-value estimate.`, sourceIds: ranking.rows.map(row => `data:${row.ticker}`) },
    thesis: discovery.thesis, financials, valuation, catalysts: discovery.catalysts, risks: discovery.risks, gaps };
}
