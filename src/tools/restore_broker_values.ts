import { Type } from 'typebox';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { channelIdParams, resolveInvestorFromChannel, type ChannelIds } from './channel.js';
import { readBrokerAccountModel, persistBrokerAccountModel } from '../brokers/accounts.js';
import { latestSuccessfulBrokerSyncRun } from '../brokers/sync-history.js';
import { fetchRawData, brokerRawDataFile } from '../raw-data/store.js';
import { getBrokerAdapter } from '../brokers/adapter.js';
import { buildHoldingKey } from '../market/position-value.js';
import { saveInvestor, loadInvestor } from '../state/investor-store.js';
import { getPortfolio, type InvestorState } from '../state/portfolio-state.js';
import type { BrokerStatement } from '../brokers/statement.js';
import { refreshPortfolioAfterSync } from '../state/projection-events.js';

/** Metadata-only replay: never creates/removes a holding, changes cash, or imports history. */
export function prepareBrokerValueRestore(state: InvestorState, connectionId: string, statement: BrokerStatement) {
  const model = readBrokerAccountModel(state), conn = model.connections[connectionId];
  if (!conn || statement.account_id !== conn.account_id || statement.as_of !== conn.last_sync?.as_of || conn.last_sync.snapshot_deferred?.length) throw new Error('Archive does not match the current complete account snapshot');
  const portfolio = structuredClone(getPortfolio(state));
  const keys = Object.keys(portfolio).filter(key => portfolio[key].channel === conn.channel).sort();
  const sourceKeys = statement.lots.map(lot => buildHoldingKey(lot.ticker,conn.channel)).sort();
  if (!isDeepStrictEqual(keys,sourceKeys)) throw new Error('Current account holdings differ from archived snapshot; sync current data instead');
  let updated = 0;
  for (const lot of statement.lots) {
    const key = buildHoldingKey(lot.ticker,conn.channel), current = portfolio[key], source = lot.holding;
    if (current.units !== source.units || current.avg_price !== source.avg_price || current.currency !== lot.currency ||
        !isDeepStrictEqual(current.option,source.option) || !isDeepStrictEqual(current.fund,source.fund)) throw new Error(`Current economics differ from archived snapshot for ${key}; do not overwrite a later correction`);
    if (source.broker_values && !isDeepStrictEqual(current.broker_values,source.broker_values)) { current.broker_values=structuredClone(source.broker_values);updated++; }
  }
  const metrics = statement.metrics ? {...conn.metrics,...statement.metrics} : conn.metrics ? structuredClone(conn.metrics) : undefined;
  // New parser fields may enrich old metrics; existing reported money must not change.
  for (const [key,value] of Object.entries(conn.metrics ?? {})) if (typeof value === 'number' && (metrics as unknown as Record<string,unknown>)[key] !== value) throw new Error(`Archive conflicts with retained metric ${key}`);
  return {portfolio,metrics,updated,metricsChanged:!isDeepStrictEqual(conn.metrics,metrics)};
}
export function createRestoreBrokerValuesTool(): AgentTool {
  return {
    name:'restore_broker_reported_values',label:'Restore Broker Reported Values',
    description:'Preview/apply previously unprojected broker valuation fields from the latest successful account-bound archived snapshot through the production adapter. Verifies file version, account, date, exact current holdings/terms/cost/marks, current revision and preview token; preserves cash, quantities, costs, archives and execution history. Enriches broker market values/P&L/account metrics then rebuilds derived views. Use sync_broker if current holdings differ. This can repair missing broker projections after a parser upgrade, not arbitrary history or code.',
    parameters:Type.Object({...channelIdParams,mode:Type.Union([Type.Literal('preview'),Type.Literal('apply')]),connection_id:Type.String(),expected_revision:Type.Integer(),file_id:Type.String(),version:Type.String(),reason:Type.String(),preview_token:Type.Optional(Type.String())}),
    async execute(_id,raw) {
      const result=(details:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(details)}],details});
      try {
        const p=raw as ChannelIds & {mode:string;connection_id:string;expected_revision:number;file_id:string;version:string;reason:string;preview_token?:string};
        if (!['preview','apply'].includes(p.mode) || !p.reason?.trim()) throw new Error('Valid mode and repair reason required');
        const snapshot=await resolveInvestorFromChannel(p);
        if(snapshot.revision!==p.expected_revision)throw new Error('Source revision changed; preview again');
        const model=readBrokerAccountModel(snapshot.state),conn=model.connections[p.connection_id];
        if(!conn)throw new Error('Unknown account connection');
        const run=latestSuccessfulBrokerSyncRun(snapshot.state.user.id,conn.channel);
        if(!run || run.raw_data_id!==p.file_id || run.account_id!==conn.account_id || run.as_of!==conn.last_sync?.as_of)throw new Error('Use the latest successful account-bound snapshot archive');
        const file=brokerRawDataFile(snapshot.state.user.id,conn.channel,p.file_id);
        if(!file || file.version!==p.version)throw new Error('Archive version changed or unavailable');
        const chunks:Buffer[]=[];let offset=0;
        for(;;){const part=fetchRawData(snapshot.state.user.id,p.file_id,p.version,offset,65536,'base64');chunks.push(Buffer.from(part.content,'base64'));if(part.next_offset===null)break;offset=part.next_offset;}
        const body=Buffer.concat(chunks),sha256=createHash('sha256').update(body).digest('hex');
        const statement=getBrokerAdapter(conn.broker_id).parseToStatement({kind:p.file_id.endsWith('.xml')?'xml':'json',body},conn.channel,false);
        const prepared=prepareBrokerValueRestore(snapshot.state,p.connection_id,statement);
        const preview_token=createHash('sha256').update(JSON.stringify([snapshot.state.user.id,snapshot.revision,p.connection_id,p.file_id,p.version,sha256,p.reason,prepared])).digest('hex');
        const receipt={preview_token,revision:snapshot.revision,file_id:p.file_id,version:p.version,sha256,updated_holdings:prepared.updated,metrics_changed:prepared.metricsChanged,metrics:prepared.metrics,cash_changed:false,history_changed:false};
        if(p.mode==='preview')return result(receipt);
        if(p.preview_token!==preview_token)throw new Error('Source or repair changed since preview');
        if(!prepared.updated && !prepared.metricsChanged)return result({...receipt,applied:false,reason:'Already restored'});
        snapshot.state.portfolio=prepared.portfolio;
        if (prepared.metrics) conn.metrics=prepared.metrics; else delete conn.metrics;
        persistBrokerAccountModel(snapshot.state,model);
        snapshot.state.log.push({ts:new Date().toISOString(),action:'broker_values_restored',connection_id:p.connection_id,archive_id:p.file_id,sha256,reason:p.reason,updated_holdings:prepared.updated});
        await saveInvestor(snapshot);
        const after=await loadInvestor(snapshot.state.user.id);
        const verify=prepareBrokerValueRestore(after.state,p.connection_id,statement);
        if(verify.updated || verify.metricsChanged)throw new Error('Restored values failed persisted readback; investigate before retry');
        const rebuilt=await refreshPortfolioAfterSync(snapshot.state.user.id,true);
        return result({...receipt,applied:true,revision:after.revision,calculation_status:rebuilt.status});
      }catch(error){return result({error:error instanceof Error?error.message:String(error)});}
    },
  };
}
