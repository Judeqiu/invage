import { addDecimals } from '../brokers/option-executions.js';
import { historyProduct } from '../brokers/history-values.js';
import { readBrokerAccountModel } from '../brokers/accounts.js';
import { getPortfolio, holdingInstrument, type InvestorState } from '../state/portfolio-state.js';
import type { PortfolioProjection } from '../state/projection-store.js';
import { resolveDashboardChannel } from './dashboard-model.js';

/** Decimal representation of a saved finite number, including exponential notation.
 * This does not claim the underlying saved binary64 valuation is broker decimal cash.
 */
export function savedDecimal(value: number): string {
  if (!Number.isFinite(value)) throw Error('Saved monetary value is unavailable');
  const raw=String(value),[mantissa,exponent]=raw.toLowerCase().split('e');
  if(exponent===undefined)return raw;
  const negative=mantissa.startsWith('-'),[whole,fraction='']=mantissa.replace('-','').split('.');
  const digits=whole+fraction,point=whole.length+Number(exponent);
  const expanded=point<=0?'0.'+'0'.repeat(-point)+digits:point>=digits.length?digits+'0'.repeat(point-digits.length):digits.slice(0,point)+'.'+digits.slice(point);
  return (negative?'-':'')+expanded;
}
export interface ChannelAssetComponent {
  channel:string; key:string; component:'stock'|'cash'|'money_market_fund'|'unclassified_fund';
  native_currency:string|null; currency:string|null; native_amount:string|null; fx_rate:string|null;
  value:string|null; source:string; source_path:string; reason:string|null;
}
/** Uses one validated saved generation. Position values are already FX converted;
 * cashBalances are explicitly native and are converted once using its saved FX.
 * No cost, broker NAV substitution, option mark, fee or execution cash is added.
 */
export function channelAssetValues(state: InvestorState, projection: PortfolioProjection) {
  const live=projection.dashboard.model?.live;
  if(!live)throw Error('Saved portfolio valuation has no itemized live model');
  const reportingCurrency=live.reportingCurrency??null;
  const accounts=Object.values(readBrokerAccountModel(state).connections);
  const components:ChannelAssetComponent[]=[],issues=new Map<string,string[]>();
  const unknownFundScope=new Set<string>();
  const problem=(channel:string,reason:string)=>issues.set(channel,[...(issues.get(channel)??[]),reason]);
  const channels=new Set([...live.channels,...accounts.map(c=>c.channel)]);
  const rateFor=(currency:string|null):number|null=>{
    if(!currency||!reportingCurrency)return null;
    if(currency===reportingCurrency)return 1;
    const rate=live.fxRates?.[currency];return typeof rate==='number'&&Number.isFinite(rate)&&rate>0?rate:null;
  };
  for(const [key,h]of Object.entries(getPortfolio(state))){
    const channel=resolveDashboardChannel(h.channel),instrument=holdingInstrument(h);channels.add(channel);
    if(instrument==='option')continue;
    const component=instrument==='equity'?'stock':h.fund?.product_class==='mmf'?'money_market_fund':h.fund?.product_class===undefined?'unclassified_fund':null;
    if(component===null)continue; // Explicit non-money-market fund classification.
    const index=live.positions.findIndex(p=>p.ticker===key&&p.channel===channel),p=live.positions[index];
    const currency=h.currency?.trim().toUpperCase()??null,rate=rateFor(currency);
    let reason:string|null=null;
    if(component==='unclassified_fund')reason='Fund product class is unreported; money-market inclusion is unresolved.';
    else if(!p||p.instrument!==instrument)reason='Holding has no matching saved position valuation.';
    else if(p.units!==h.units)reason='Saved position quantity differs from its source holding.';
    else if(p.currency!==currency)reason='Saved position native currency differs from its source holding.';
    else if(!currency||!reportingCurrency||rate===null&&h.units!==0)reason='Native currency, reporting currency or saved FX rate is unavailable.';
    else if(p.pricingMode==='cost'&&h.units!==0)reason='Saved value uses cost fallback rather than a market price.';
    else if(!Number.isFinite(p.value))reason='Saved market value is unavailable.';
    if(reason)problem(channel,`${key}: ${reason}`);
    components.push({channel,key,component,native_currency:currency,currency:reportingCurrency,native_amount:null,fx_rate:rate===null?null:savedDecimal(rate),
      value:reason?null:savedDecimal(p.value),source:p?'saved_position_value':'investor_state',source_path:p?`/dashboard/model/live/positions/${index}/value`:`/portfolio/${key.replaceAll('~','~0').replaceAll('/','~1')}`,reason});
  }
  for(const channel of channels){
    if(!reportingCurrency)problem(channel,'Saved reporting currency is unavailable.');
    if(state.portfolio===undefined)problem(channel,'Stored holdings collection is unavailable; missing holdings do not establish zero.');
    const metrics=projection.dashboard.connectionMetrics?.[channel];
    const funds=Object.values(getPortfolio(state)).filter(h=>resolveDashboardChannel(h.channel)===channel&&holdingInstrument(h)==='fund');
    if(metrics?.fund_assets!==undefined&&metrics.fund_assets!==0&&!funds.length){
      unknownFundScope.add(channel);problem(channel,'Broker reports aggregate fund assets without itemized product classification.');
    }
    const account=accounts.find(c=>c.channel===channel);
    if(account&&!funds.length&&metrics?.fund_assets===undefined){
      unknownFundScope.add(channel);problem(channel,'Broker money-market fund scope is unreported; absence of itemized funds does not establish zero.');
    }
    const cashRows=live.cashBalances?.map((cash,index)=>({cash,index})).filter(({cash})=>cash.channel===channel)??[];
    // Broker cash is the same balance metric and takes precedence when explicitly saved.
    if(metrics?.broker_cash!==undefined){
      const native_currency=metrics.currency,rate=rateFor(native_currency);
      const reason=!native_currency||!reportingCurrency||rate===null&&metrics.broker_cash!==0||!Number.isFinite(metrics.broker_cash)?'Saved broker cash currency, amount or FX rate is unavailable.':null;
      if(reason)problem(channel,reason);
      const native_amount=Number.isFinite(metrics.broker_cash)?savedDecimal(metrics.broker_cash):null;
      components.push({channel,key:'broker_cash',component:'cash',native_currency,currency:reportingCurrency,native_amount,fx_rate:rate===null?null:savedDecimal(rate),
        value:reason||native_amount===null?null:metrics.broker_cash===0?'0':historyProduct(native_amount,savedDecimal(rate!)),source:'saved_broker_cash',source_path:`/dashboard/connectionMetrics/${channel.replaceAll('~','~0').replaceAll('/','~1')}/broker_cash`,reason});
    }else if(cashRows.length){
      for(const {cash,index}of cashRows){
        const rate=rateFor(cash.currency),reason=!cash.currency||!reportingCurrency||rate===null&&cash.amount!==0||!Number.isFinite(cash.amount)?'Saved cash currency, amount or FX rate is unavailable.':null;
        if(reason)problem(channel,reason);
        const native_amount=Number.isFinite(cash.amount)?savedDecimal(cash.amount):null;
        components.push({channel,key:`cash:${index}`,component:'cash',native_currency:cash.currency,currency:reportingCurrency,native_amount,fx_rate:rate===null?null:savedDecimal(rate),
          value:reason||native_amount===null?null:cash.amount===0?'0':historyProduct(native_amount,savedDecimal(rate!)),source:'saved_cash_balance',source_path:`/dashboard/model/live/cashBalances/${index}`,reason});
      }
    }else problem(channel,'Saved native cash balances are unavailable; missing is not zero.');
  }
  const rows=[...channels].sort().map(channel=>{
    const selected=components.filter(c=>c.channel===channel);
    const sum=(kind:ChannelAssetComponent['component'])=>{const rows=selected.filter(c=>c.component===kind);return rows.some(r=>r.value===null)?null:addDecimals(...rows.map(r=>r.value!));};
    const stock_market_value=state.portfolio===undefined?null:sum('stock'),cash_balance=selected.some(c=>c.component==='cash')?sum('cash'):null;
    const unclassified=selected.some(c=>c.component==='unclassified_fund');
    const money_market_fund_value=unclassified||unknownFundScope.has(channel)||state.portfolio===undefined?null:sum('money_market_fund');
    const reasons=issues.get(channel)??[],complete=!reasons.length;
    return {channel,currency:reportingCurrency,stock_market_value,cash_balance,money_market_fund_value,
      asset_value:complete&&stock_market_value!==null&&cash_balance!==null&&money_market_fund_value!==null?addDecimals(stock_market_value,cash_balance,money_market_fund_value):null,
      complete,calculated_at:projection.calculatedAt,broker_as_of:projection.dashboard.brokerAsOf?.[channel]??null,issues:JSON.stringify(reasons)};
  });
  return {rows,components};
}
