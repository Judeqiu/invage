import { saveInvestor, type InvestorSnapshot } from '../state/investor-store.js';
import { parseFlexOptionExecutions } from '../ibkr/flex-executions.js';
import { buildExecutionJournal, mergeOptionExecutions } from './option-executions.js';

/** Historical imports deliberately never apply cash or holding snapshots. */
export async function importOptionExecutions(snapshot: InvestorSnapshot, xml: string) {
  const incoming = parseFlexOptionExecutions(xml);
  if (incoming === undefined) throw new Error('Missing Trades section. Export an Activity Flex XML with Trades at Executions level.');
  const previous = snapshot.state.option_executions;
  const merged = mergeOptionExecutions(previous === undefined ? [] : previous, incoming);
  const added = merged.length - (previous === undefined ? 0 : previous.length);
  snapshot.state.option_executions = merged;
  await saveInvestor(snapshot);
  return { added, ...buildExecutionJournal(merged) };
}
