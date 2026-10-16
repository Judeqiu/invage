/** Read-only supplementary evidence. Missing entitlements never fabricate data. */
import { riskContractKey, type RiskExecutionQuote, type RiskHistorySeries, type RiskMarketContract, type RiskMarketSnapshot } from './types.js';

type Row = Record<string, any>;
export type RiskMarketQuery = (path: string, body?: Row, params?: Record<string,string>) => Promise<Row>;
export const providerOptionCode = (c: Pick<RiskMarketContract,'underlying'|'expiryAt'|'right'|'strike'>) =>
  `US.${c.underlying}${c.expiryAt.slice(0,10).replaceAll('-','').slice(2)}${c.right==='put'?'P':'C'}${Math.round(c.strike*1000)}`;
const day = 86400_000;
function barDate(row: Row): string | null {
  const raw=String(row.date ?? '');
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
  if (!Number.isFinite(row.time_key)) return null;
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(row.time_key));
}
export async function dailyHistory(query: RiskMarketQuery, code: string, now: number): Promise<Row[]> {
  const latest=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
  const start=new Date(now-5*366*day).toISOString().slice(0,10);
  let end=latest;const rows=new Map<string,Row>();
  // Five calendar years, paginated in provider-sized pages. No fabricated fills.
  while (end>=start) {
    const result=await query(`/api/v1.0/quote/${code}/history-kline`,undefined,{start,end,ktype:'2',autype:'0',num:'370'});
    if (!Array.isArray(result.kline_list)) throw new Error('Historical bars unavailable');
    for(const row of result.kline_list){const date=barDate(row);if(date&&date>=start&&date<latest&&Number.isFinite(row.close)&&row.close>0) {
      const prior=rows.get(date);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))throw new Error('Conflicting historical bars');rows.set(date,row);
    }}
    if (!result.kline_list.length || result.kline_list.length<370 || !result.next_time) break;
    const next=barDate({time_key:result.next_time});
    if(!next||next>=end)throw new Error('Historical pagination did not advance');end=next;
  }
  return [...rows.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([date,row])=>({...row,date}));
}
export function alignObservedHistory(c: RiskMarketContract, stock: Row[], option: Row[], now: number): RiskHistorySeries {
  const spots=new Map(stock.map(row=>[String(row.date),row.close]));
  const rows=option.filter(row=>spots.has(String(row.date))&&Number.isFinite(row.implied_volatility)&&row.implied_volatility>=1&&row.implied_volatility<=500);
  return {key:riskContractKey(c),dates:rows.map(r=>String(r.date)),spots:rows.map(r=>spots.get(String(r.date))),ivs:rows.map(r=>r.implied_volatility/100),
    source:`Connected broker daily unadjusted closes and exact-contract observed IV; collected ${new Date(now).toISOString()}; raw price history requires corporate-action checks`};
}
export function comboExecutionQuote(row: Row, code: string, fetchedAt: string): RiskExecutionQuote | null {
  if(row?.rsp_code!==0||!Array.isArray(row.legs)||row.legs.length!==1||row.legs[0].code!==code||row.legs[0].side!=='BUY'||row.legs[0].quantity!==1||
    ![row.bid_price,row.ask_price].every(Number.isFinite)||row.bid_price<0||row.ask_price<=0||row.ask_price<row.bid_price) return null;
  return {bid:row.bid_price,ask:row.ask_price,bidSize:Number.isFinite(row.bid_volume)&&row.bid_volume>=0?row.bid_volume:null,
    askSize:Number.isFinite(row.ask_volume)&&row.ask_volume>=0?row.ask_volume:null,fetchedAt,quoteAsOf:null,
    source:'Connected broker live combo-option-quote, exact single BUY leg; exchange quote timestamp is not supplied; indicative quote, not a guaranteed fill'};
}
export async function collectAdvancedMarket(market: RiskMarketSnapshot, query: RiskMarketQuery, chainByGroup: Map<string,Row|null>, now: number, shortIds: Set<string>): Promise<void> {
  market.histories=[];market.executionQuotes=[];market.hedges=[];
  const unique=[...new Map(market.contracts.map(c=>[riskContractKey(c),c])).values()];
  const stocks=new Map<string,Promise<Row[]>>(),options=new Map<string,Promise<Row[]>>();
  const hedgeFor=new Map<string,RiskMarketContract>();
  // Nearest further-OTM same-expiry long leg: a finite, stated candidate policy.
  for(const c of market.contracts) {
    if(!shortIds.has(c.id))continue;
    const chain=chainByGroup.get(`${c.underlying}|${c.expiryAt.slice(0,10)}`)?.option_chain;
    const rows=Array.isArray(chain)?chain.filter((r:Row)=>r.stock_owner==='US.'+c.underlying&&r.strike_time===c.expiryAt.slice(0,10)&&r.option_type===c.right.toUpperCase()&&
      r.option_standard_type==='STANDARD'&&r.lot_size===100&&Number.isFinite(r.strike_price)&&(c.right==='put'?r.strike_price<c.strike:r.strike_price>c.strike)):[];
    rows.sort((a:Row,b:Row)=>Math.abs(a.strike_price-c.strike)-Math.abs(b.strike_price-c.strike));
    if(rows[0])hedgeFor.set(c.id,{...c,id:`hedge:${c.id}`,strike:rows[0].strike_price});
  }
  const hedgeTerms=[...new Map([...hedgeFor.values()].map(c=>[providerOptionCode(c),c])).values()];
  // Fetch exact hedge IV/price metadata independently of held-position marks.
  const hedgeMarks=new Map<string,Row>();
  for(let i=0;i<hedgeTerms.length;i+=100){try {
    const codes=hedgeTerms.slice(i,i+100).map(providerOptionCode);const r=await query('/api/v1.0/quote/stock-quote',{code_list:codes});
    for(const row of r.quote_list??[])if(codes.includes(row.code))hedgeMarks.set(row.code,row);
  }catch{ /* Unsupported hedge quotes leave the close/hold and risk paths usable. */ }}
  const all=[...new Map([...unique,...hedgeTerms].map(c=>[providerOptionCode(c),c])).values()];
  const quotes=new Map<string,RiskExecutionQuote>();
  for(let i=0;i<all.length;i+=20){try {
    const codes=all.slice(i,i+20).map(providerOptionCode);
    const r=await query('/api/v1.0/quote/combo-option-quote',{combo_list:codes.map(code=>({legs:[{code,side:'BUY',quantity:1}]}))});
    const at=new Date(now).toISOString();
    for(const code of codes){const matches=(r.quote_list??[]).filter((row:Row)=>row.legs?.length===1&&row.legs[0]?.code===code);if(matches.length===1){const q=comboExecutionQuote(matches[0],code,at);if(q)quotes.set(code,q);}}
  }catch{ /* Missing quote entitlement is reported per action. */ }}
  for(const c of market.contracts){const q=quotes.get(providerOptionCode(c));if(q)market.executionQuotes.push({contractId:c.id,quote:q});
    const hedge=hedgeFor.get(c.id),mark=hedge&&hedgeMarks.get(providerOptionCode(hedge)),ex=mark?.option_ex_data,quote=hedge&&quotes.get(providerOptionCode(hedge));
    if(hedge&&mark&&quote&&ex?.option_area_type==='AMERICAN'&&ex.contract_size===100&&ex.contract_multiplier===100&&ex.strike_price===hedge.strike&&ex.option_type===hedge.right.toUpperCase()&&
      Number.isFinite(ex.implied_volatility)&&ex.implied_volatility>=1&&ex.implied_volatility<=500&&Number.isFinite(mark?.last_price)&&mark.last_price>0&&Number.isFinite(mark?.data_time)&&mark.data_time<=now+60000) {
      market.hedges.push({forContractId:c.id,contract:{...hedge,impliedVolatility:ex.implied_volatility/100,premiumPerContract:mark!.last_price*100,
        quoteAsOf:new Date(mark!.data_time).toISOString()},quote});
    }
  }
  const historical=[...new Map([...unique,...market.hedges.map(h=>h.contract)].map(c=>[riskContractKey(c),c])).values()];
  let index=0;
  await Promise.all(Array.from({length:Math.min(3,historical.length)},async()=>{for(;;){const c=historical[index++];if(!c)return;
    try {
      if(!stocks.has(c.underlying))stocks.set(c.underlying,dailyHistory(query,'US.'+c.underlying,now));
      const code=providerOptionCode(c);if(!options.has(code))options.set(code,dailyHistory(query,code,now));
      const [spot,option]=await Promise.all([stocks.get(c.underlying)!,options.get(code)!]);
      market.histories!.push(alignObservedHistory(c,spot,option,now));
    }catch { /* Missing history does not remove a position from conditional risk. */ }
  }}));
  market.histories.sort((a,b)=>a.key.localeCompare(b.key));
}
