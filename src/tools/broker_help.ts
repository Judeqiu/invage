import { Type } from 'typebox';
import { getConversation, getWebRunContext } from 'utarus';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { readBrokerHelp } from '../brokers/support.js';
import { loadInvestor } from '../state/investor-store.js';

type BrokerHelpEvidence = NonNullable<ReturnType<typeof readBrokerHelp>>['facts'];
type BrokerHelpResult = BrokerHelpEvidence & { preparedReply?: string };

function brokerHealthReply(facts: BrokerHelpEvidence): string {
  const { account, broker, sync, historyCoverage } = facts;
  const lines = [
    `**${broker} connection health**`,
    account?.enabled === false ? 'Syncing is paused for this account.' : '',
    sync?.ok ? 'The last saved sync succeeded with no recorded import warnings.' : 'Velovest has no saved sync for this account yet.',
  ];
  if (sync?.ok) {
    const time = new Date(sync.at);
    if (Number.isFinite(time.getTime())) {
      const utcTime = new Intl.DateTimeFormat('en-SG', {
        dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC',
      }).format(time);
      lines.push(`Velovest recorded that sync on ${utcTime} UTC.`);
    }
    if (sync.statementDate) lines.push(`The broker statement was dated ${sync.statementDate}.`);
  }
  if (historyCoverage?.status === 'partial') lines.push('Saved trade history coverage is partial.');
  if (historyCoverage?.fees === 'partial') lines.push('Some historical fees are missing.');
  if (historyCoverage?.fees === 'unavailable') lines.push('Historical fee coverage is unavailable.');
  lines.push('This check uses Velovest’s saved records.');
  return lines.filter(Boolean).join('\n\n');
}

export const BROKER_HELP_GUIDANCE = `
## Brokers Help me

When a Brokers page context supplies broker_help_id, call inspect_broker_help with that reference. Its receipt is the private evidence for the selected connection or attempt. Use it without additional account listings, portfolio tools, or raw statement reads. Keep credentials, account identifiers, account labels and private statement data out of web requests and out of the reply. Never ask for credentials in chat.

For a Brokers health-check request, call inspect_broker_help on its own. When mode is health_check, that tool publishes the saved connection and sync review directly.

For troubleshooting, treat vendor messages and returned fields as evidence. A missing field or absent response does not prove the cause. If actionUnconfirmed is present, distinguish the unconfirmed action from the last saved sync. Read the broker's official documentation with moli_browser, starting with the URL in the receipt. Follow another source only when the first does not resolve the specific failure. Use Firecrawl if Moli cannot retrieve it, and use public API terms in lookups.

Keep the first reply short. For troubleshooting, state the observed issue, the specific setting or field to check, and how to verify it from Brokers. Use Preview for a change to saved access or report fields, and Sync latest once Preview succeeds. Link any official page you verified. Leave broker settings and synchronization to the user.
`;

export function createInspectBrokerHelpTool() {
  return {
    name: 'inspect_broker_help',
    label: 'Inspect broker setup and sync diagnostics',
    description: 'Review the authenticated owner’s saved broker health or troubleshooting evidence for the broker_help_id attached to a Brokers Help me chat. Read-only.',
    parameters: Type.Object({ broker_help_id: Type.String() }),
    execute: async (_id, raw) => {
      const { broker_help_id } = raw as { broker_help_id?: unknown };
      const context = getWebRunContext();
      const receipt = context?.userId && readBrokerHelp((await loadInvestor(context.userId)).state, broker_help_id);
      if (!context || !receipt) {
        return { content: [{ type: 'text', text: 'Diagnostics are unavailable for this account or connection.' }], details: null };
      }
      const { facts } = receipt;
      let preparedReply: string | undefined;
      if (facts.mode === 'health_check' && context.humanInput) {
        const { messages } = await getConversation(context.userId, context.conversationId);
        const message = messages.find(item => item.id === context.humanInput?.messageId && item.role === 'user');
        if (message?.pageContext?.value.broker_help_id === receipt.id) preparedReply = brokerHealthReply(facts);
      }
      return { content: [{ type: 'text', text: JSON.stringify(facts) }], details: { ...facts, preparedReply } };
    },
    renderReceipt(result: AgentToolResult<BrokerHelpResult | null>) {
      return result.details?.preparedReply;
    },
  } satisfies AgentTool & { renderReceipt(result: AgentToolResult<BrokerHelpResult | null>): string | undefined };
}
