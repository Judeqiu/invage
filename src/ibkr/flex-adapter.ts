/**
 * IBKR Flex catalog adapter. Fetch + Flex XML parse only.
 * csv_tables is a syncBrokerConnection overlay (usesCsvTables signal).
 */

import type {
  AdapterTransport,
  BrokerConnectorAdapter,
  BrokerRawPayload,
} from '../brokers/adapter.js';
import { getBrokerConnector } from '../brokers/catalog.js';
import { createFlexTransport, fetchFlexStatement, FlexHttpError } from './flex-client.js';
import { mapFlexDocToStatement } from './flex-map.js';
import { flexHistoryDates,mapFlexHistory } from './flex-history.js';
import type { BrokerHistoryGap } from '../brokers/history.js';
import { parseFlexQueryXml,looksLikeCsv } from './flex-parse.js';

function flexTransport(opts?: { transport?: AdapterTransport }) {
  const t = opts?.transport;
  if (t?.kind === 'ibkr') return t.flex;
  return createFlexTransport();
}

export const ibkrFlexAdapter: BrokerConnectorAdapter = {
  id: 'ibkr',
  usesCsvTables: true,
  async fetchRaw(credentials, opts) {
    const queryField = getBrokerConnector('ibkr').syncQueryFieldId;
    if (!queryField) {
      throw new Error('Broker connector "ibkr" has no sync query field.');
    }
    const transport=flexTransport(opts);
    const xml = await fetchFlexStatement(
      { token: credentials.token ?? '', queryId: credentials[queryField] ?? '' },
      transport,
    );
    if(!opts?.history)return {kind:'xml',body:xml};
    if(looksLikeCsv(xml.toString('utf8')))return {kind:'xml',body:xml,historyUnavailable:{broker_id:'ibkr',channel:opts.channel??'ibkr',plan:opts.history,reason:'Configured Flex query returns CSV. Existing snapshot parser remains supported; historical executions require account-scoped execution-level XML.'}};
    const account=opts.accountId??parseFlexQueryXml(xml).accountId,channel=opts.channel??'ibkr';
    const dates=flexHistoryDates(xml.toString('utf8'),account);if(!dates.length)throw new Error('Flex current account binding mismatch');
    const latest=dates.map(d=>d.through).sort().at(-1)!;const reports=[{xml:xml.toString('utf8'),from:dates[0].from,through:latest}];
    const attachments:NonNullable<BrokerRawPayload['historyAttachments']>=[],gaps:BrokerHistoryGap[]=[];
    let imported=opts.history.mode==='full';
    if(opts.history.mode==='full'){
      const year=Number(latest.slice(0,4));
      for(let y=year-4;y<=year;y++){
        const from=`${y}0101`,through=y===year?latest:`${y}1231`;
        // Separate SendRequest pacing from the GetStatement polling interval.
        await (transport.sleepMs??(ms=>new Promise(r=>setTimeout(r,ms))))(6500);
        try{
          const historical=await fetchFlexStatement({token:credentials.token??'',queryId:credentials[queryField]??'',fromDate:from,throughDate:through,pollAttempts:30},transport);
          const actual=flexHistoryDates(historical.toString('utf8'),account);if(!actual.length)throw new Error('Historical Flex account mismatch');
          if(actual.some(d=>d.from!==from||d.through!==through))gaps.push({kind:'coverage',reference:from,reason:'Returned historical Flex dates differ from the requested interval.'});
          reports.push({xml:historical.toString('utf8'),from,through});attachments.push({kind:'xml',body:historical});
        }catch(error){
          if(!(error instanceof FlexHttpError))throw error;
          if(error.code!=='1003')imported=false;
          gaps.push({kind:'coverage',reference:from,reason:`IBKR historical report unavailable (${error.code}).`});
        }
      }
      gaps.push({kind:'coverage',reference:null,reason:'Flex history is limited to available current/four previous calendar years; earlier reports are not proved.'});
    }
    const cutoff=latest.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3')+'T23:59:59.000Z';
    const through=opts.history.through<cutoff?opts.history.through:cutoff;
    const effective={...opts.history,through,from:opts.history.from>through?new Date(Date.parse(through)-2*86400000).toISOString():opts.history.from};
    const history=mapFlexHistory(reports,account,channel,effective,gaps,imported);
    return {kind:'xml',body:xml,history,historyAttachments:attachments};
  },
  parseToStatement(raw: BrokerRawPayload, channel: string) {
    const statement=mapFlexDocToStatement(parseFlexQueryXml(raw.body), channel);
    if(raw.history){statement.history=raw.history;statement.option_executions=[];}
    return statement;
  },
};
