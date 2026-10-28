/** Lossless broker evidence, independent of portfolio and option projections.
 * Numeric JSON tokens become exact decimal strings in indexed rows. The original
 * bytes remain authoritative. Records are observations, never ledger postings.
 */
import { SaxesParser } from 'saxes';
import { looksLikeOptionCode } from './option-symbol.js';

export interface BrokerActivityScope { brokerId: string; channel: string; accountId: string }
export interface BrokerActivityRecord {
  path: string; parentPath: string | null; sourceId: string | null;
  category: 'execution' | 'order' | 'lifecycle' | 'cash_activity' | 'position' | 'cash_snapshot' | 'fee' | 'other';
  instrument: string | null; data: Record<string, unknown>;
}
export interface BrokerActivityExtraction {
  status: 'indexed' | 'unverified' | 'account_mismatch' | 'unparsed';
  records: BrokerActivityRecord[]; gaps: string[];
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const scalar = (v: unknown) => v === null || typeof v !== 'object';
const string = (v: unknown): string | null => typeof v === 'string' && v.trim() ? v : null;
// A transaction's own ID precedes its parent-order ID (Tiger supplies both).
const idFields = ['tradeID','deal_id','transactionID','transaction_id','ibExecID','id','order_id','orderId','position_id','conid'];

function record(path: string, parentPath: string | null, data: Record<string, unknown>): BrokerActivityRecord {
  const sourceId = idFields.map(k => string(data[k])).find(value => value && value !== '0') ?? null;
  const native = String(data.code ?? data.symbol ?? '').replace(/^(US|HK)\./, '').replaceAll(' ', '');
  const asset = String(data.assetCategory ?? data.secType ?? data.instrument_type ?? data.security_type ?? '').toUpperCase();
  const right = String(data.putCall ?? data.option_type ?? '').toUpperCase();
  const instrument = asset.includes('OPT') || looksLikeOptionCode(native) || ['P','C','PUT','CALL'].includes(right) ? 'option' :
    ['STK','STOCK','EQUITY'].includes(asset) ? 'equity' : asset === 'CASH' || asset === 'FOREX' ? 'fx' : asset === 'FUND' ? 'fund' : null;
  // These are source classifications, not inferred opening/closing effects or cash.
  const p = path.toLowerCase().replace(/\[\d+\]/g, '[]');
  const lifecycle = /^(assignment|exercise|expire|expiration|cashsettlement)$/i.test(String(data.transactionType ?? '')) ||
    (Array.isArray(data.attrList) && data.attrList.some(v => ['ASSIGNMENT','EXERCISE','EXPIRE','CASH_SETTLE'].includes(String(v))));
  const category: BrokerActivityRecord['category'] = lifecycle || /optioneae/.test(p) ? 'lifecycle' :
    /cashtransaction|transfer|corporateaction|dividend|interest|deposit|withdraw/.test(p) ? 'cash_activity' :
    /fees?\b|orders_fees/.test(p) ? 'fee' :
    /openposition|\/positions\b/.test(p) ? 'position' : /cashreport|\/funds\b|\/balances\b/.test(p) ? 'cash_snapshot' :
    /\/trades\[\]\/trade\[|fills_history\/rows|\/transactions\[|history_deals/.test(p) ? 'execution' :
    /orders_history|orders_details|order_details|\/orders\[|history_orders/.test(p) ? 'order' : 'other';
  return {path, parentPath, sourceId, category, instrument, data};
}

/** Preserve numeric precision without relying on the host's JSON number support. */
export function parseBrokerJsonExact(text: string): unknown {
  return JSON.parse(text.replace(/"(?:[^"\\]|\\.)*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
    token => token.startsWith('"') ? token : JSON.stringify(token)));
}

export function extractBrokerActivity(body: Buffer, kind: 'xml' | 'json' | 'text', scope: BrokerActivityScope): BrokerActivityExtraction {
  const records: BrokerActivityRecord[] = [], gaps: string[] = [];
  let verified = false, mismatch = false;
  const check = (account: unknown, establishesBinding = false) => {
    if (account == null || account === '') return;
    if (String(account) === scope.accountId) { if (establishesBinding) verified = true; }
    else mismatch = true;
  };
  try {
    if (kind === 'json') {
      const root = parseBrokerJsonExact(body.toString('utf8'));
      if (!object(root)) throw new Error('Broker payload is not an object');
      check(root.acc_id ?? root.account_id ?? root.account, true);
      const walk = (value: unknown, path: string, parent: string | null) => {
        if (Array.isArray(value)) { value.forEach((v,i) => walk(v, `${path}[${i}]`, parent)); return; }
        if (!object(value)) return;
        // Discovery and managed-account directories legitimately list other accounts.
        const directory = /\/(?:authorized|accounts|managed_accounts)(?:\/|\[|$)/.test(path);
        if (!directory) check(value.account_id ?? value.acc_id ?? value.accountId);
        const fields = Object.fromEntries(Object.entries(value).filter(([,v]) => scalar(v) || Array.isArray(v) && v.every(scalar)));
        const here = Object.keys(fields).length > 0;
        if (here) records.push(record(path, parent, fields));
        for (const [key,v] of Object.entries(value)) if (!scalar(v) && !(Array.isArray(v) && v.every(scalar))) {
          walk(v, `${path}/${key.replaceAll('~','~0').replaceAll('/','~1')}`, here ? path : parent);
        }
      };
      walk(root, '', null);
      gaps.push('Only endpoints present in this response are captured; absent cash/lifecycle endpoints do not establish zero activity.');
      if (root.history_error) gaps.push('Broker reported incomplete historical retrieval.');
    } else if (kind === 'xml') {
      const stack: Array<{name:string;path:string;children:Map<string,number>;data:Record<string,unknown>;text:string;selected:boolean}> = [];
      let selected = false;
      const sections = new Set<string>();
      const parser = new SaxesParser({xmlns:false});
      parser.on('doctype', () => { throw new Error('DOCTYPE is not supported'); });
      parser.on('opentag', tag => {
        if (tag.name === 'FlexStatement') { selected = tag.attributes.accountId === scope.accountId; if (selected) verified = true; }
        const parent = stack.at(-1), n = parent?.children.get(tag.name) ?? 0;
        parent?.children.set(tag.name, n+1);
        const path = `${parent?.path ?? ''}/${tag.name}[${n}]`;
        if (selected) sections.add(tag.name);
        stack.push({name:tag.name,path,children:new Map(),data:{...tag.attributes},text:'',selected});
      });
      parser.on('text', text => { const node = stack.at(-1); if (node) node.text += text; });
      parser.on('cdata', text => { const node = stack.at(-1); if (node) node.text += text; });
      parser.on('closetag', () => {
        const node = stack.pop()!;
        if (node.selected && (Object.keys(node.data).length || node.text.trim())) {
          if (node.text.trim()) node.data._text = node.text;
          records.push(record(node.path, stack.at(-1)?.path ?? null, node.data));
          if (node.name !== 'FlexStatement') {
            const account = node.data.accountId;
            if (account != null && account !== scope.accountId) mismatch = true;
          }
        }
        if (node.name === 'FlexStatement') selected = false;
      });
      parser.write(body.toString('utf8')).close();
      if (!verified) mismatch = true;
      for (const section of ['Trades','OptionEAE','CashTransactions','Transfers','CorporateActions']) {
        if (!sections.has(section)) gaps.push(`Flex report omits ${section}; coverage is unknown.`);
      }
    } else {
      return {status:'unparsed',records:[],gaps:['Original bytes retained; text/CSV record indexing is not supported.']};
    }
    if (mismatch) return {status:'account_mismatch',records:[],gaps:['Payload account differs from the selected account; no records indexed.']};
    if (!verified) return {status:'unverified',records:[],gaps:['Payload has no verified account binding; original bytes retained.']};
    return {status:'indexed',records,gaps};
  } catch {
    return {status:'unparsed',records:[],gaps:['Payload could not be indexed; original bytes retained for review.']};
  }
}
