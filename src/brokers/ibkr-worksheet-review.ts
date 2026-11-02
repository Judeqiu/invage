import { createHash } from 'node:crypto';
import { addDecimals, assertOptionExecution, decimal, negateDecimal, type OptionExecution } from './option-executions.js';
import { assertOptionLifecycleEvent, type OptionLifecycleEvent } from './option-events.js';
import { historyProduct } from './history-values.js';
import type { SpreadsheetJournalRow } from './spreadsheet-trades.js';

const equal = (a:string,b:string) => !/[1-9]/.test(addDecimals(a,negateDecimal(b)));
const amount = (s:string) => decimal(s.replaceAll(',',''));
const absolute = (s:string) => s.startsWith('-') ? s.slice(1) : s;

/** RFC4180 records with physical starting line numbers, including quoted newlines. */
export function statementCSV(text:string) {
  const records:Array<{line:number;cells:string[]}> = [];
  let cells:string[]=[], cell='', quoted=false, line=1, start=1;
  const input=text.replace(/^\uFEFF/,'');
  for(let i=0;i<input.length;i++) {
    const c=input[i];
    if(c==='"') {
      if(quoted&&input[i+1]==='"'){cell+='"';i++;}
      else if(quoted||cell==='')quoted=!quoted;
      else throw Error('Malformed CSV quote');
    } else if(c===','&&!quoted){cells.push(cell);cell='';}
    else if((c==='\n'||c==='\r')&&!quoted){
      if(c==='\r'&&input[i+1]==='\n')i++;
      cells.push(cell);if(cells.some(Boolean))records.push({line:start,cells});
      cells=[];cell='';line++;start=line;
    } else {cell+=c;if(c==='\n')line++;}
  }
  if(quoted)throw Error('Unterminated CSV quote');
  if(cell||cells.length){cells.push(cell);records.push({line:start,cells});}
  return records;
}

export function readIBKRReviewStatement(name:string,bytes:Buffer,account:string) {
  const sha256=createHash('sha256').update(bytes).digest('hex');
  const records=statementCSV(bytes.toString('utf8'));
  const accounts=records.filter(r=>r.cells[0]==='Account Information'&&r.cells[1]==='Data'&&r.cells[2]==='Account');
  if(accounts.length!==1||accounts[0].cells[3]!==account)throw Error('Statement account mismatch');
  const headers=new Map<string,string[]>();
  const trades:Array<{line:number;fields:Record<string,string>}>=[], instruments:Array<Record<string,string>>=[];
  const codes=new Map<string,string>();
  for(const {line,cells} of records){
    const [section,kind,...values]=cells;
    if(kind==='Header'){headers.set(section,values);continue;}
    if(kind!=='Data')continue;
    if(section==='Codes'){codes.set(values[0],values[1]);continue;}
    if(section!=='Trades'&&section!=='Financial Instrument Information')continue;
    const header=headers.get(section);if(!header||header.length!==values.length)throw Error('Statement header or row width mismatch');
    const fields=Object.fromEntries(header.map((key,i)=>[key,values[i]]));
    if(section==='Trades'&&fields.DataDiscriminator==='Order')trades.push({line,fields});
    if(section==='Financial Instrument Information'&&fields['Asset Category']==='Equity and Index Options')instruments.push(fields);
  }
  return {name,sha256,account_id:account,trades,instruments,codes};
}
export type IBKRReviewStatement = ReturnType<typeof readIBKRReviewStatement>;

/** Resolve only held worksheet rows. Statement order aggregates never become invented broker fills. */
export function planIBKRWorksheetReview(rows:SpreadsheetJournalRow[],statements:IBKRReviewStatement[],scope:{channel:string;account_id:string}) {
  if(statements.some(s=>s.account_id!==scope.account_id))throw Error('Review statement account scope mismatch');
  const executions:OptionExecution[]=[],events:OptionLifecycleEvent[]=[],resolutions:unknown[]=[];
  const used=new Set<string>(),seenRows=new Set<number>();
  for(const row of rows){
    if(seenRows.has(row.row))throw Error('Duplicate worksheet row');seenRows.add(row.row);
    const matches=statements.flatMap(source=>source.trades.filter(t=>t.fields['Asset Category']==='Equity and Index Options'&&
      t.fields.Symbol===row.strategy_as_reported&&t.fields['Date/Time'].slice(0,10)===row.date&&
      equal(absolute(amount(t.fields.Proceeds)),absolute(addDecimals(row.credit,negateDecimal(row.debit))))).map(trade=>({source,trade})));
    if(matches.length!==1)throw Error(`Worksheet row ${row.row} has ${matches.length} matching statement orders`);
    const {source,trade}=matches[0],t=trade.fields,key=`${source.sha256}:${trade.line}`;
    if(used.has(key))throw Error('Statement order linked to multiple worksheet rows');used.add(key);
    const instruments=source.instruments.filter(i=>i.Description===t.Symbol);
    if(instruments.length!==1)throw Error('Exact statement instrument metadata required');
    const i=instruments[0],quantity=amount(t.Quantity),contracts=absolute(quantity),multiplier=amount(i.Multiplier),strike=amount(i.Strike);
    if(equal(contracts,'0'))throw Error('Zero quantity statement order requires review');
    if(t.Currency!==row.currency||i.Underlying!==row.symbol||!['C','P'].includes(i.Type))throw Error('Statement currency or underlying mismatch');
    const right=i.Type==='C'?'call':'put';
    const contract_id=`manual:option:${i.Underlying}:${i.Expiry}:${right}:${strike}:${multiplier}`;
    const gross=amount(t.Proceeds),fee=amount(t['Comm/Fee']),price=amount(t['T. Price']);
    const codes=new Set(t.Code.split(';'));
    const id=`statement:ibkr:${key}`;
    const common={channel:scope.channel,account_id:scope.account_id,contract_id,underlying:i.Underlying,right,strike,expiry:i.Expiry,multiplier,contracts,currency:t.Currency};
    let kind='trade';
    if(codes.has('Ep')||codes.has('A')){
      if(!codes.has('C')||codes.has('O')||codes.has('Ep')&&codes.has('A')||!equal(gross,'0')||!equal(price,'0'))throw Error('Ambiguous lifecycle order');
      if(!equal(row.credit,'0')||!equal(row.debit,'0'))throw Error('Nonzero worksheet lifecycle cash requires review');
      kind=codes.has('A')?'assignment':'expiration';
      const code=codes.has('A')?'A':'Ep';
      if(source.codes.get(code)!==(code==='A'?'Assignment':'Resulted from an Expired Position'))throw Error('Statement lifecycle legend required');
      // Verify physical delivery from the same statement; never turn share principal into premium.
      if(kind==='assignment'){
        const expectedShares=historyProduct(quantity,multiplier,right==='put'?'1':'-1');
        const deliveries=source.trades.filter(r=>r.fields['Asset Category']==='Stocks'&&r.fields.Symbol===i.Underlying&&r.fields['Date/Time']===t['Date/Time']&&
          r.fields.Code.split(';').includes('A')&&equal(amount(r.fields.Quantity),expectedShares)&&equal(amount(r.fields['T. Price']),strike)&&
          equal(amount(r.fields.Proceeds),negateDecimal(historyProduct(expectedShares,strike))));
        if(deliveries.length!==1)throw Error('Assignment needs unique matching broker stock delivery');
      }
      events.push(assertOptionLifecycleEvent({...common,id,broker_id:'ibkr',date:row.date,kind,settlement:kind==='assignment'?'physical':'unknown',
        proceeds:gross,fees:fee,broker_realized_pl:amount(t['Realized P/L']),source:'broker_statement',source_ref:source.sha256,replaces_execution_ids:[]}));
    }else{
      if(codes.has('C')===codes.has('O'))throw Error('Explicit statement opening/closing code required');
      if(!row.quantity_as_reported||!equal(contracts,row.quantity_as_reported))throw Error('Trade quantity differs from worksheet');
      const expected=negateDecimal(historyProduct(quantity,price,multiplier));
      if(!equal(expected,gross))throw Error('Statement quantity price multiplier and proceeds disagree');
      executions.push(assertOptionExecution({...common,execution_id:id,executed_at:t['Date/Time'].replace(', ','T'),
        side:quantity.startsWith('-')?'sell':'buy',effect:codes.has('C')?'close':'open',gross_premium:gross,commission:fee}));
    }
    resolutions.push({row:row.row,kind,source:{name:source.name,sha256:source.sha256,line:trade.line},worksheet:row,statement:t,instrument:i,
      quantity_discrepancy:row.quantity_as_reported!==null&&!equal(contracts,row.quantity_as_reported),execution_or_event_id:id});
  }
  return {executions,events,resolutions,gross_cash:addDecimals('0',...executions.map(e=>e.gross_premium)),fee_cash:addDecimals('0',...executions.map(e=>e.commission!))};
}
