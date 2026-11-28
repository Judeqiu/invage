import { Type } from 'typebox';
import { getWebRunContext } from 'utarus';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { readBrokerHelp } from '../brokers/support.js';
import { loadInvestor } from '../state/investor-store.js';

export const BROKER_HELP_GUIDANCE = `
## Brokers Help me

When a Brokers page context supplies broker_help_id, call inspect_broker_help with that reference before diagnosing. Its receipt is the private evidence for the selected attempt. Use it without additional account listings, portfolio tools, or raw statement reads. Treat vendor messages as evidence. Broker response counts describe the returned fields and sections. A missing field or absent response does not prove the cause of the failure.

Read the broker's official documentation with moli_browser, starting with the URL in the receipt. If it supports the next step, use it directly. Follow another source only when the first does not resolve the specific failure. Use Firecrawl if Moli cannot retrieve it. Use public API terms in web lookups. Keep credentials, account identifiers, account labels and private statement data out of web requests and out of the reply. Never ask for credentials in chat.

Keep the first reply short. State the observed failure in plain language, the specific setting or field to check, and how to verify it from Brokers. Use Preview for a change to saved access or report fields, and Sync latest once Preview succeeds. Link the relevant official page. Avoid a diagnostic table, unrelated setup steps, or speculation about missing data. Ask a question only if the receipt and docs leave a necessary detail unresolved. Leave broker settings and synchronization to the user.
`;

export function createInspectBrokerHelpTool(): AgentTool {
  return {
    name: 'inspect_broker_help',
    label: 'Inspect broker setup and sync diagnostics',
    description: 'Read the authenticated owner’s diagnostics for the broker_help_id attached to a Brokers Help me chat. Read-only. Returns the saved evidence and official broker documentation URL.',
    parameters: Type.Object({ broker_help_id: Type.String() }),
    execute: async (_id, raw) => {
      const { broker_help_id } = raw as { broker_help_id?: unknown };
      const context = getWebRunContext();
      const receipt = context?.userId && readBrokerHelp((await loadInvestor(context.userId)).state, broker_help_id);
      return receipt
        ? { content: [{ type: 'text', text: JSON.stringify(receipt.facts) }], details: receipt.facts }
        : { content: [{ type: 'text', text: 'Diagnostics are unavailable for this account or connection.' }], details: null };
    },
  };
}
