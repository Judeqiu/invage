import { saveInvestor, type InvestorSnapshot } from '../state/investor-store.js';
import { parseFlexOptionExecutions } from '../ibkr/flex-executions.js';
import { buildExecutionJournal, mergeOptionExecutions } from './option-executions.js';
import { readBrokerAccountModel } from './accounts.js';
import { parseXmlAttrs } from '../ibkr/flex-parse.js';

/** Historical imports deliberately never apply cash or holding snapshots. */
export async function importOptionExecutions(snapshot: InvestorSnapshot, xml: string, connectionId?: string) {
  const model = readBrokerAccountModel(snapshot.state);
  const fragments = [...xml.matchAll(/<FlexStatement\b[^>]*>[\s\S]*?<\/FlexStatement>/g)].map(m => m[0]);
  if ([...xml.matchAll(/<FlexStatement\b/g)].length !== fragments.length ||
      [...xml.matchAll(/<\/FlexStatement>/g)].length !== fragments.length) {
    throw new Error('Incomplete FlexStatement in Activity XML.');
  }
  if (fragments.length === 0) throw new Error('Missing FlexStatement in Activity XML.');
  const incoming = fragments.flatMap(fragment => {
    const attrs = fragment.match(/^<FlexStatement\b([^>]*)>/);
    const accountId = attrs && parseXmlAttrs(attrs[1]).accountId?.trim();
    if (!accountId) throw new Error('Execution statement accountId is required.');
    const candidates = Object.entries(model.connections).filter(([id, c]) => c.broker_id === 'ibkr' && c.account_id === accountId && (!connectionId || id === connectionId));
    let channel: string;
    if (candidates.length === 1) channel = candidates[0][1].channel;
    else if (!snapshot.state.broker_sources && Object.keys(model.connections).length <= 1 && fragments.length === 1 && !connectionId) channel = 'ibkr';
    else throw new Error(`No unique IBKR connection for execution account ${accountId}. Select a configured connection.`);
    const rows = parseFlexOptionExecutions(fragment, channel);
    if (rows === undefined) throw new Error('Missing Trades section. Export an Activity Flex XML with Trades at Executions level.');
    return rows;
  });
  const previous = snapshot.state.option_executions;
  const merged = mergeOptionExecutions(previous === undefined ? [] : previous, incoming);
  const added = merged.length - (previous === undefined ? 0 : previous.length);
  snapshot.state.option_executions = merged;
  await saveInvestor(snapshot);
  return { added, ...buildExecutionJournal(merged) };
}
