/**
 * /bind <token> — investor-side handshake command (Slack).
 *
 * Wired in src/extension.ts via DomainExtension.slackCommands.
 * Not admin-only: any Slack user can run it. The handshake validates
 * the token and either creates a fresh investor user or recognises an existing one.
 *
 * Isolation from framework access (INV- / demo / deny):
 * Utarus registers this as a Slack slash command. Free text goes through
 * resolveInboundMessage; slash commands do not. Landing users from
 * investor.lextok.com never need an INV- code to finish /bind.
 */

import { handleBind } from './handshake.js';

export interface CommandContext {
  args: string;
  slackUserId: string;
  isAdmin: boolean;
}

export async function handleBindCommand(ctx: CommandContext): Promise<string> {
  const result = await handleBind({
    payload: ctx.args,
    slackUserId: ctx.slackUserId,
  });
  return result.reply;
}
