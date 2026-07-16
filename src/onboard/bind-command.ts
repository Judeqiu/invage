/**
 * /bind <token> — investor-side handshake command (Slack + WebUI).
 *
 * Wired in src/extension.ts via DomainExtension.slackCommands and webCommands.
 * Not admin-only: any channel user can run it. The handshake validates
 * the token and either creates a fresh investor user or recognises an existing one.
 *
 * Isolation from framework access (INV- / demo / deny):
 * Utarus registers this as a slash command. Free text goes through
 * resolveInboundMessage; slash commands do not. Landing users from
 * investor.lextok.com never need an INV- code to finish /bind.
 */

import { handleBind } from './handshake.js';

export interface SlackBindContext {
  args: string;
  slackUserId: string;
  isAdmin: boolean;
}

export interface WebBindContext {
  args: string;
  userSlug: string;
  isAdmin: boolean;
  conversationId?: string | null;
}

export async function handleBindCommand(ctx: SlackBindContext): Promise<string> {
  const result = await handleBind({
    payload: ctx.args,
    slackUserId: ctx.slackUserId,
  });
  return result.reply;
}

export async function handleBindWebCommand(ctx: WebBindContext): Promise<string> {
  const result = await handleBind({
    payload: ctx.args,
    userSlug: ctx.userSlug || undefined,
    web: true,
  });
  return result.reply;
}
