/** Read-only source observations. No financial totals or preferred source version. */
import { assertUserId } from 'utarus';
import type { PoolClient } from 'pg';
import { getPool, isBooksEnabled } from '../books/db.js';
import { publicBrokerAccounts, readBrokerAccountModel } from './accounts.js';
import type { InvestorState } from '../state/portfolio-state.js';

export async function withActivityRead<T>(userId: string, read: (client: PoolClient) => Promise<T>): Promise<T> {
  assertUserId(userId);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SELECT set_config('app.household_id',$1,true)", [userId]);
    const result = await read(client);
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

const categories = ['execution','order','lifecycle','cash_activity','fee'];
const activityRows = `r.category = ANY($2::text[])`;

function reported(data: Record<string, unknown>, fields: string[]): { field: string; value: string } | null {
  for (const field of fields) if (data[field] !== undefined && data[field] !== null && data[field] !== '') {
    return { field, value: typeof data[field] === 'object' ? JSON.stringify(data[field]) : String(data[field]) };
  }
  return null;
}

function reportedQuantity(data: Record<string, unknown>, fields: string[]) {
  const quantity = reported(data,fields);
  if (!quantity) return null;
  const scale = reported(data,[`${quantity.field}Scale`]);
  return scale ? {...quantity,scale} : quantity;
}

/** Fields are reported values, not inferred execution cash or allocated fees. */
export function activityFields(data: Record<string, unknown>) {
  return {
    date: reported(data,['executed_at','dateTime','transactionTime','create_time','tradeDate','date','openTime','filled_time_at','filled_time','place_time_at','place_time']),
    symbol: reported(data,['code','symbol','underlyingSymbol','description']),
    currency: reported(data,['currency']),
    quantity: reportedQuantity(data,['quantity','qty','filledQuantity','filled_quantity','totalQuantity','total_quantity','dealt_qty','contracts']),
    price: reported(data,['tradePrice','filledPrice','price','filled_price','avgFillPrice','dealt_avg_price']),
    amount: reported(data,['proceeds','filledAmount','amount','total_fee','gross_cash','netCash']),
    fee: reported(data,['ibCommission','commission','actual_commission','fee_amount','total_fee']),
    side: reported(data,['buySell','action','trd_side','side','transactionType','type']),
    status: reported(data,['order_status','status']),
    lifecycle: reported(data,['attrList','transactionType']),
  };
}

export function commonActivityFields(samples: ReturnType<typeof activityFields>[]) {
  return Object.fromEntries(Object.keys(activityFields({})).map(key => {
    const values = [...new Set(samples.flatMap(sample => {
      const value = sample[key as keyof typeof sample]; return value ? [JSON.stringify(value)] : [];
    }))].map(value => JSON.parse(value) as {field:string;value:string});
    return [key,{ values, missing: samples.length === 0 || samples.some(sample => !sample[key as keyof typeof sample]) }];
  }));
}

export function reportAccounts(state: InvestorState) {
  return publicBrokerAccounts(state).connections.map(c => ({
    brokerId:c.broker_id,channel:c.channel,accountId:c.account_id,label:c.label,
    enabled:c.enabled,lastSync:c.last_sync,
    snapshotDate:state.option_observations?.filter(o => o.source==='broker' && o.channel===c.channel && o.account_id===c.account_id)
      .map(o=>o.as_of).sort().at(-1) ?? (c.last_sync?.ok ? c.last_sync.as_of : null),
    history:c.history_sync,
  }));
}

export async function loadBrokerActivityReport(state: InvestorState) {
  const accounts = reportAccounts(state);
  if (!isBooksEnabled()) return {available:false,accounts,activities:[],capture:[],message:'Broker source capture is not configured.'};
  return withActivityRead(state.user.id, async client => {
    const capture = (await client.query(`SELECT broker_id,channel,account_id,status,count(*)::int AS documents,
      jsonb_agg(DISTINCT gaps) AS gaps FROM broker_source_documents WHERE household_id=$1::uuid
      GROUP BY broker_id,channel,account_id,status ORDER BY broker_id,channel,account_id,status`,[state.user.id])).rows;
    // Keep all raw versions available in details; transfer only source display
    // fields for the list. There is no record-count cutoff or lifetime-total sum.
    const rows = (await client.query(`SELECT d.broker_id,d.channel,d.account_id,r.category,r.source_id,
      CASE WHEN r.source_id IS NULL THEN r.document_id::text ELSE NULL END AS observation_document,
      CASE WHEN r.source_id IS NULL THEN r.path ELSE NULL END AS observation_path,
      array_agg(DISTINCT r.instrument) AS instruments,count(*)::int AS observations,
      count(DISTINCT r.data)::int AS versions,
      jsonb_agg(DISTINCT (SELECT jsonb_object_agg(k,v) FROM jsonb_each(r.data) AS f(k,v)
        WHERE k=ANY($3::text[]))) AS samples
      FROM broker_source_records r JOIN broker_source_documents d ON d.household_id=r.household_id AND d.id=r.document_id
      WHERE r.household_id=$1::uuid AND d.status='indexed' AND ${activityRows}
      GROUP BY d.broker_id,d.channel,d.account_id,r.category,r.source_id,observation_document,observation_path
      ORDER BY d.broker_id,d.channel,r.category,r.source_id,observation_document,observation_path`,
      [state.user.id,categories,['executed_at','dateTime','transactionTime','create_time','tradeDate','date','openTime','filled_time_at','filled_time','place_time_at','place_time',
        'code','symbol','underlyingSymbol','description','currency','quantity','qty','filledQuantity','filled_quantity','filledQuantityScale','totalQuantity','totalQuantityScale','total_quantity','dealt_qty','contracts',
        'tradePrice','filledPrice','price','filled_price','avgFillPrice','dealt_avg_price','proceeds','filledAmount','amount','total_fee','gross_cash','netCash',
        'ibCommission','commission','actual_commission','fee_amount','total_fee','buySell','action','trd_side','side','transactionType','type','order_status','status','attrList']])).rows;
    return {available:true,accounts,capture,activities:rows.map(row => ({
      key:JSON.stringify(row.source_id === null
        ? [row.broker_id,row.channel,row.account_id,row.category,null,row.observation_document,row.observation_path]
        : [row.broker_id,row.channel,row.account_id,row.category,row.source_id]),
      brokerId:row.broker_id,channel:row.channel,accountId:row.account_id,category:row.category,
      sourceId:row.source_id,instruments:row.instruments.filter(Boolean),observations:row.observations,versions:row.versions,
      fields:commonActivityFields(row.samples.map((sample: Record<string,unknown> | null) => activityFields(sample ?? {}))),
    }))};
  });
}

export function parseActivityKey(raw: unknown): unknown[] {
  let key: unknown; try { key=JSON.parse(String(raw)); } catch { throw new Error('Invalid activity reference'); }
  if (!Array.isArray(key) || ![5,7].includes(key.length) || key.slice(0,4).some(v=>typeof v!=='string'||!v) ||
      !categories.includes(key[3]) || (key.length===5 ? typeof key[4]!=='string'||!key[4] :
      key[4]!==null||!/^[-a-f0-9]{36}$/i.test(key[5])||typeof key[6]!=='string')) throw new Error('Invalid activity reference');
  return key;
}

export async function loadBrokerActivityDetails(userId: string, key: unknown[]) {
  return withActivityRead(userId,async client => {
    const observations = (await client.query(`SELECT r.document_id,r.path,r.data,d.captured_at,d.sha256,d.gaps,
      (SELECT jsonb_agg(jsonb_build_object('path',c.path,'data',c.data)) FROM broker_source_records c
       WHERE c.household_id=r.household_id AND c.document_id=r.document_id AND
         left(c.path,length(r.path)+1)=r.path||'/') AS children,
      (SELECT jsonb_agg(source_ref ORDER BY source_ref) FROM broker_source_receipts s
       WHERE s.household_id=r.household_id AND s.document_id=r.document_id) AS sources
      FROM broker_source_records r JOIN broker_source_documents d ON d.household_id=r.household_id AND d.id=r.document_id
      WHERE r.household_id=$1::uuid AND d.status='indexed' AND d.broker_id=$2 AND d.channel=$3 AND d.account_id=$4
       AND r.category=$5 AND ($6::text IS NOT NULL AND r.source_id=$6 OR $6::text IS NULL AND r.document_id=$7::uuid AND r.path=$8)
      ORDER BY d.captured_at,r.document_id,r.path`,[userId,...key.slice(0,5),key[5]??null,key[6]??null])).rows;
    return {observations};
  });
}

/** Use the exact successfully applied snapshot, not whichever archive was captured last. */
export async function loadBrokerPositionReport(state: InvestorState, positionKey: string) {
  const h=state.portfolio?.[positionKey];
  if (!h || !isBooksEnabled()) return {available:false,reason:'Broker snapshot source is unavailable.'};
  const connection=Object.values(readBrokerAccountModel(state).connections).find(c=>c.channel===h.channel);
  const observation=state.option_observations?.filter(o=>o.source==='broker'&&o.broker_id===connection?.broker_id&&o.channel===h.channel&&o.account_id===connection?.account_id)
    .sort((a,b)=>b.observed_at.localeCompare(a.observed_at))[0];
  const native=h.broker_ref?.native_id;
  if (!observation || !native || !connection) return {available:false,reason:'An exact position source reference is unavailable.'};
  return withActivityRead(state.user.id,async client=>{
    const rows=(await client.query(`SELECT DISTINCT r.data,d.sha256 FROM broker_source_records r
      JOIN broker_source_documents d ON d.household_id=r.household_id AND d.id=r.document_id
      JOIN broker_source_receipts s ON s.household_id=d.household_id AND s.document_id=d.id
      WHERE r.household_id=$1::uuid AND d.status='indexed' AND d.broker_id=$2 AND d.channel=$3 AND d.account_id=$4
        AND r.category='position' AND (r.data->>'code'=$5 OR r.data->>'conid'=$5 OR r.data->>'position_id'=$5)
        AND (s.source_ref=$6 OR s.source_ref=$7)`,
      [state.user.id,connection.broker_id,h.channel,connection.account_id,native,`sync:${observation.id}`,observation.raw_data_id??null])).rows;
    return {available:rows.length>0,asOf:observation.as_of,observedAt:observation.observed_at,native,rows,
      reason:rows.length?'Exact broker snapshot fields; calculated report values are separate.':'The applied snapshot has not been captured for this position.'};
  });
}
