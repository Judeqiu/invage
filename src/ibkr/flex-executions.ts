import { assertOptionExecution, decimal, mergeOptionExecutions, type OptionExecution } from '../brokers/option-executions.js';
import { SaxesParser } from 'saxes';

/** Explicit IBKR schema enums; never infer trade intent from descriptions. */
export function parseFlexOptionExecutions(xml: string): OptionExecution[] | undefined {
  const statements: Record<string, string>[] = [];
  const trades: Record<string, string>[] = [];
  const path: string[] = [];
  let sections = 0;
  const parser = new SaxesParser({ xmlns: false });
  parser.on('doctype', () => { throw new Error('Flex XML must not include a document type'); });
  parser.on('opentag', tag => {
    const parent = path[path.length - 1];
    if (tag.name === 'FlexStatement') statements.push(tag.attributes);
    if (tag.name === 'Trades') {
      if (parent !== 'FlexStatement') throw new Error('Trades must belong to a FlexStatement');
      sections += 1;
    }
    if (tag.name === 'Trade') {
      if (parent !== 'Trades') throw new Error('Trade must belong to Trades');
      trades.push(tag.attributes);
    }
    path.push(tag.name);
  });
  parser.on('closetag', () => { path.pop(); });
  parser.write(xml).close();
  if (statements.length !== 1) throw new Error('Execution import requires exactly one FlexStatement');
  const account = statements[0].accountId;
  if (!account) throw new Error('Execution statement accountId is required');
  if (sections === 0) return undefined;
  if (sections !== 1) throw new Error('Execution import requires exactly one Trades section');
  const rows: OptionExecution[] = [];
  for (const row of trades) {
    if (!row.assetCategory) throw new Error('Trade assetCategory is required');
    if (row.assetCategory !== 'OPT') continue;
    const required = (key: string): string => {
      const value = row[key];
      if (typeof value !== 'string' || !value.trim()) throw new Error(`IBKR option execution ${row.tradeID}: missing ${key}`);
      return value.trim();
    };
    const level = required('levelOfDetail');
    if (['ORDER', 'CLOSED_LOT', 'SYMBOL_SUMMARY', 'ASSET_CLASS', 'WASH_SALE'].includes(level)) continue;
    if (level !== 'EXECUTION') throw new Error(`Unsupported option trade level: ${level}`);
    if (required('accountId') !== account) throw new Error('Execution account differs from statement account');
    if (row.origTradeID && row.origTradeID !== '0') throw new Error('Execution correction requires explicit reconciliation; origTradeID is present');
    const currency = required('currency');
    if (required('ibCommissionCurrency') !== currency) throw new Error('Execution commission currency differs from proceeds currency');
    const side = required('buySell');
    const effect = required('openCloseIndicator');
    const right = required('putCall');
    if (side !== 'BUY' && side !== 'SELL') throw new Error(`Unsupported buySell: ${side}`);
    if (effect !== 'O' && effect !== 'C') throw new Error(`Unsupported openCloseIndicator: ${effect}`);
    if (right !== 'P' && right !== 'C') throw new Error(`Unsupported putCall: ${right}`);
    const timestamp = required('dateTime').match(/^(\d{4})(\d{2})(\d{2});(\d{2})(\d{2})(\d{2})$/);
    if (!timestamp) throw new Error('Execution dateTime must use YYYYMMDD;HHMMSS');
    const expiry = required('expiry').match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!expiry) throw new Error('Execution expiry must use YYYYMMDD');
    const quantity = decimal(required('quantity'));
    if (quantity.startsWith('-') !== (side === 'SELL')) throw new Error('Execution quantity sign disagrees with buySell');
    rows.push(assertOptionExecution({
      channel: 'ibkr', account_id: account, execution_id: required('tradeID'), contract_id: required('conid'),
      executed_at: `${timestamp[1]}-${timestamp[2]}-${timestamp[3]}T${timestamp[4]}:${timestamp[5]}:${timestamp[6]}`,
      underlying: required('underlyingSymbol'), right: right === 'P' ? 'put' : 'call',
      expiry: `${expiry[1]}-${expiry[2]}-${expiry[3]}`, strike: required('strike'), multiplier: required('multiplier'),
      contracts: quantity.replace(/^-/, ''), side: side === 'BUY' ? 'buy' : 'sell', effect: effect === 'O' ? 'open' : 'close',
      currency, gross_premium: required('proceeds'), commission: required('ibCommission'),
    }));
  }
  if (rows.length === 0 && trades.some(row => row.assetCategory === 'OPT')) {
    throw new Error('Trades contains option summaries but no option executions. Select Executions level in the Flex query.');
  }
  return mergeOptionExecutions([], rows);
}
