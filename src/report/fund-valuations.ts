import { getPortfolio,holdingInstrument,type InvestorState } from '../state/portfolio-state.js';
import type { PortfolioProjection } from '../state/projection-store.js';
import { resolveDashboardChannel } from './dashboard-model.js';
import { savedDecimal } from './channel-asset-value.js';

/** All recorded funds retain queryable values, independently of MMF eligibility. */
export function fundValuations(state:InvestorState,projection:PortfolioProjection){
  const live=projection.dashboard.model?.live;if(!live)throw Error('Saved fund valuation unavailable');
  const reporting=live.reportingCurrency??null;
  return Object.entries(getPortfolio(state)).filter(([,h])=>holdingInstrument(h)==='fund').map(([key,h])=>{
    const channel=resolveDashboardChannel(h.channel),index=live.positions.findIndex(p=>p.ticker===key&&p.channel===channel),p=live.positions[index];
    const native=h.currency?.trim().toUpperCase()??null;
    const fx=native&&reporting?(native===reporting?1:live.fxRates?.[native]):undefined;
    const conversionKnown=fx!==undefined&&Number.isFinite(fx)&&fx>0;
    let valuation_issue:string|null=null;
    if(!p||p.instrument!=='fund'||p.units!==h.units||p.currency!==native)valuation_issue='Matching saved fund valuation is unavailable.';
    else if(!native||!reporting||!conversionKnown&&h.units!==0)valuation_issue='Saved currency or FX evidence is unavailable.';
    else if(p.pricingMode==='cost'&&h.units!==0||!Number.isFinite(p.value))valuation_issue='Fund market value is unavailable.';
    const source=h.fund?.classification_source;
    return {key,channel,name:h.fund?.name??null,broker_symbol:h.fund?.broker_symbol??null,isin:h.fund?.isin??null,product_class:h.fund?.product_class??null,
      classification_status:h.fund?.product_class?'recorded':'unclassified',classification_url:source?.url??null,classification_sha256:source?.sha256??null,
      classification_verified_at:source?.verified_at??null,native_currency:native,currency:reporting,units:savedDecimal(h.units),
      native_mark:h.fund?.mark===undefined?null:savedDecimal(h.fund.mark),quote_source:h.fund?.quote_source??null,fx_rate:conversionKnown?savedDecimal(fx!):null,
      market_value:valuation_issue?null:savedDecimal(p.value),money_market_eligible:h.fund?.product_class===undefined?null:h.fund.product_class==='mmf',
      calculated_at:projection.calculatedAt,broker_as_of:projection.dashboard.brokerAsOf?.[channel]??null,
      source_path:p?`/dashboard/model/live/positions/${index}/value`:null,valuation_issue};
  });
}
