import { field, type Dataset } from './catalog.js';
import { channelAssetValues } from '../report/channel-asset-value.js';
import { readPortfolioProjection, requirePortfolioProjection, portfolioProjectionSignature } from '../state/projection-store.js';
import type { InvestorState } from '../state/portfolio-state.js';

const text=(description:string)=>field('string',description);
const money=(description:string)=>field('decimal',description,{unit:'reporting currency',sum_group_by:['currency'],comparison_group_by:['currency']});
const scope={channel:text('Exact custody channel from broker_accounts.'),currency:text('Reporting currency of this saved valuation; null when unavailable.')};
const caveats=[
  'Formula: stock market value + cash balance + explicitly classified money-market fund value. Options, other fund classes, fixed deposits, cost basis, fees and broker aggregate NAV are excluded.',
  'Uses the latest valid saved portfolio generation and its FX rates; no live prices or FX are fetched. calculated_at is generation time, not the timestamp of every quote or FX input. Per-input timestamps are unavailable unless separately recorded.',
  'Saved position values are already in reporting currency and are never converted again. Original cash balances are converted once using the same saved FX rates. Broker-reported saved cash takes precedence over itemized cash when present.',
  'Missing amounts, market quotes, currencies, FX or money-market classification produce unresolved issues and an unavailable asset_value. Reported zeroes and signed cash remain valid. Aggregate fund assets are not assumed to be money-market funds or added over itemized funds.',
  'Completeness describes the recorded inputs to this formula, not a new broker reconciliation. Pin expected_revision and expected_source_version on subsequent pages; saved generations can change independently of investor revision.',
];
function dataset(description:string,fields:Dataset['fields']):Dataset {
  return {description,fields,source:'saved_portfolio_projection',caveats,available:s=>readPortfolioProjection(s)!==null,rows:()=>{throw Error('Load saved valuation through query_data');}};
}
export const channelAssetDatasets:Record<string,Dataset>={
  channel_asset_values:dataset('Per-channel stock market value plus cash and money-market funds, in the saved reporting currency.',{
    ...scope,stock_market_value:money('Saved market values of stocks only; includes neither funds nor options.'),cash_balance:money('Signed saved cash balance converted using the saved FX rates.'),
    money_market_fund_value:money('Value of fund holdings whose structured product_class is mmf. Unknown classifications remain unavailable.'),asset_value:money('Sum of the displayed components only when all required inputs are resolved.'),
    complete:field('boolean','Whether this formula has resolved recorded inputs; inspect issues.'),calculated_at:field('datetime','Saved generation calculation time.'),broker_as_of:field('date','Broker statement date when recorded.'),issues:text('JSON array of unresolved calculation evidence.'),
  }),
  channel_asset_components:dataset('Source and currency/FX evidence behind channel_asset_values; not an extra set of cash movements.',{
    ...scope,key:text('Source holding key or cash row identity.'),component:text('stock, cash, money_market_fund or unclassified_fund.'),native_currency:text('Original holding/balance currency.'),
    native_amount:field('decimal','Original saved native cash amount; position values are retained already converted and have no reconstructed native amount.',{sum_group_by:['native_currency'],comparison_group_by:['native_currency']}),
    fx_rate:field('decimal','Saved native-to-reporting FX rate; identity when currencies match.'),value:money('Contribution in reporting currency; null when unresolved.'),
    source:text('Saved position value, saved native cash, saved broker cash, or investor_state when no valuation exists.'),source_path:text('JSON Pointer within the saved projection, or within investor_state when the source is investor_state.'),reason:text('Why this component is unresolved, if applicable.'),
  }),
};
export function loadChannelAssetDataset(name:string,state:InvestorState):Dataset {
  const definition=channelAssetDatasets[name];if(!definition)throw Error('Unknown channel asset dataset');
  const projection=requirePortfolioProjection(state),result=channelAssetValues(state,projection);
  return {...definition,available:()=>true,source_version:portfolioProjectionSignature(projection),rows:()=>name==='channel_asset_values'?result.rows:result.components.map(row=>({...row}))};
}
