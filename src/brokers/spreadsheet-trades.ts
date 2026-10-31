import { addDecimals, assertOptionExecution, decimal, negateDecimal, validDate, type OptionExecution } from './option-executions.js';

/** Extracted source fields remain exact text; an Excel row is not a broker fill. */
export interface SpreadsheetJournalRow {
  source_sha256: string; sheet: string; row: number; date: string; symbol: string;
  strategy_as_reported: string; strike_as_reported: string | null;
  expiry_excel_serial_as_reported: string | null; quantity_as_reported: string | null;
  currency: string; credit: string; debit: string; fees: string;
}
export interface SpreadsheetTradeReview { row: number; reasons: string[]; source: SpreadsheetJournalRow; }
const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const equal = (a: string, b: string) => /^-?0(?:\.0+)?$/.test(addDecimals(a, negateDecimal(b)));
const positive = (s: string) => !s.startsWith('-') && !equal(s, '0');

/** Explicit operator approval supplies multiplier and scope. No inference of intent or outcomes. */
export function reconstructSpreadsheetTrades(rows: SpreadsheetJournalRow[], scope: {
  channel: string; account_id: string; source_sha256: string; source_file_id: string;
  sheet: string; year: number; approved_multiplier: string;
}) {
  decimal(scope.approved_multiplier);
  if (!positive(scope.approved_multiplier) || !/^[a-f0-9]{64}$/.test(scope.source_sha256) || !Number.isInteger(scope.year)) throw new Error('Invalid approved spreadsheet scope');
  const executions: OptionExecution[] = [], review: SpreadsheetTradeReview[] = [];
  const seen = new Set<number>();
  for (const source of rows) {
    if (source.source_sha256 !== scope.source_sha256 || source.sheet !== scope.sheet ||
      !validDate(source.date) || Number(source.date.slice(0,4)) !== scope.year ||
      !Number.isSafeInteger(source.row) || seen.has(source.row)) throw new Error('Spreadsheet row scope or identity mismatch');
    seen.add(source.row);
    for (const value of [source.credit, source.debit, source.fees]) decimal(value);
    const reasons: string[] = [];
    const match = source.strategy_as_reported.match(/^([A-Z.]+)\s+(\d{2})([A-Za-z]{3})(\d{2})\s+(\d+(?:\.\d+)?)\s+([CP])$/);
    let expiry = '', strike = '', symbol = '', right: 'call' | 'put' = 'call';
    if (!match) reasons.push('Strategy does not identify one option contract');
    else {
      symbol = match[1]; strike = match[5]; right = match[6] === 'C' ? 'call' : 'put';
      const month = months.indexOf(match[3].toUpperCase()) + 1;
      expiry = `20${match[4]}-${String(month).padStart(2,'0')}-${match[2]}`;
      if (!validDate(expiry)) reasons.push('Strategy expiry is invalid');
      const serial = source.expiry_excel_serial_as_reported;
      const reported = serial && /^\d+$/.test(serial) ? new Date(Date.UTC(1899,11,30) + Number(serial)*86400000).toISOString().slice(0,10) : null;
      if (reported !== expiry) reasons.push('Expiry column conflicts with strategy');
      // XLSX stores IEEE-754 values; e.g. 133.33000000000001 and 133.33
      // encode the identical numeric strike. Cash is never compared this way.
      if (source.strike_as_reported === null || (!equal(source.strike_as_reported, strike) && Number(source.strike_as_reported) !== Number(strike))) reasons.push('Strike column conflicts with strategy');
      if (source.symbol !== symbol) reasons.push('Symbol column conflicts with strategy');
    }
    if (equal(source.credit,'0') && equal(source.debit,'0')) reasons.push('Zero cash does not establish expiration assignment exercise or a trade');
    if (source.credit.startsWith('-') || source.debit.startsWith('-')) reasons.push('Negative credit or debit requires action confirmation');
    if (positive(source.credit) && positive(source.debit)) reasons.push('Both credit and debit are populated');
    if (!source.quantity_as_reported || !/^\d+(?:\.\d+)?$/.test(source.quantity_as_reported) || !positive(source.quantity_as_reported)) reasons.push('Positive option-contract quantity unavailable');
    if (reasons.length) { review.push({ row:source.row, reasons, source }); continue; }
    executions.push(assertOptionExecution({ channel:scope.channel, account_id:scope.account_id,
      execution_id:`manual:spreadsheet:${scope.source_sha256}:${encodeURIComponent(scope.sheet)}:${source.row}`,
      contract_id:`manual:option:${symbol}:${expiry}:${right}:${strike}:${scope.approved_multiplier}`,
      executed_at:source.date, underlying:symbol, right, expiry, strike, multiplier:scope.approved_multiplier,
      contracts:source.quantity_as_reported!, side:positive(source.credit) ? 'sell' : 'buy', effect:'unknown',
      currency:source.currency, gross_premium:addDecimals(source.credit,negateDecimal(source.debit)), commission:negateDecimal(source.fees),
      spreadsheet_source:{sha256:scope.source_sha256,file_id:scope.source_file_id,sheet:scope.sheet,row:source.row,date_precision:'day',multiplier_basis:'user_approved'},
    }));
  }
  return { executions, review };
}
