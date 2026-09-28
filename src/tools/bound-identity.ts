import type { AgentTool } from '@earendil-works/pi-agent-core';

/** The framework supplies this identity after authentication. Model tool arguments do not. */
export function bindDomainToolsToUser(tools: AgentTool[], userSlug: string): AgentTool[] {
  if (!userSlug?.trim()) throw new Error('Authenticated user identity required for domain tools.');
  return tools.map(tool => ({
    ...tool,
    execute: (id, raw, signal, onUpdate) => {
      const args = raw && typeof raw === 'object' && !Array.isArray(raw)
        ? raw as Record<string, unknown> : {};
      // The user slug takes precedence over any channel IDs supplied by the model.
      // Resolve the caller's state only, including in delegated agent calls.
      return tool.execute(id, {
        ...args,
        telegram_user_id: undefined,
        slack_user_id: undefined,
        user_slug: userSlug,
      }, signal, onUpdate);
    },
  }));
}
