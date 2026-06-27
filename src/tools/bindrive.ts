import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { config } from '../config.js';
import { resolveUserByTelegramUser } from '../state/index.js';

function ok<T>(text: string, details: T): AgentToolResult<T> {
  return { content: [{ type: 'text' as const, text }], details };
}
function fail(text: string): AgentToolResult<null> {
  return { content: [{ type: 'text' as const, text }], details: null };
}
function failFrom(error: unknown): AgentToolResult<null> {
  return fail(error instanceof Error ? error.message : String(error));
}

function getBaseUrl(): string {
  return `http://localhost:${config.webapp.port}`;
}

async function apiCall(method: string, path: string, token: string, body?: unknown): Promise<unknown> {
  const url = `${getBaseUrl()}${path}`;
  const headers: Record<string, string> = { 'Authorization': `Bearer ${token}` };
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`API ${res.status}: ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}

function getTokenForUser(telegramUserId: number): { token: string; slug: string } {
  const state = resolveUserByTelegramUser(telegramUserId);
  if (!state) throw new Error(`No user linked to Telegram ID ${telegramUserId}.`);
  const token = (state.profile as Record<string, unknown>).drive_token as string;
  if (!token) throw new Error(`User "${state.user.slug}" has no drive_token. Admin must regenerate.`);
  return { token, slug: state.user.slug };
}

export function createBinDriveTools(): AgentTool[] {
  const listFiles: AgentTool = {
    name: 'bindrive_list',
    label: 'BinDrive List',
    description: 'List all files in the user\'s InvesterDrive folder. The telegram_user_id is always from the message context.',
    parameters: Type.Object({
      telegram_user_id: Type.Number({ description: 'Telegram user ID from the message context.' }),
    }),
    async execute(_id, raw) {
      const { telegram_user_id } = raw as { telegram_user_id: number };
      try {
        const { token, slug } = getTokenForUser(telegram_user_id);
        const result = await apiCall('GET', `/api/files?slug=${encodeURIComponent(slug)}`, token) as { files: Array<{ name: string; size: number; modified: string }> };
        if (result.files.length === 0) return ok(`InvesterDrive folder is empty.`, { slug, files: [] });
        const lines = result.files.map((f, i) => `  ${i + 1}. ${f.name} (${(f.size / 1024).toFixed(1)} KB, ${new Date(f.modified).toLocaleDateString()})`);
        return ok(`${result.files.length} file(s):\n${lines.join('\n')}`, { slug, files: result.files });
      } catch (e) { return failFrom(e); }
    },
  };

  const uploadFile: AgentTool = {
    name: 'bindrive_upload',
    label: 'BinDrive Upload',
    description: 'Upload a file to the user\'s InvesterDrive folder. Use for saving reports or documents.',
    parameters: Type.Object({
      telegram_user_id: Type.Number({ description: 'Telegram user ID from the message context.' }),
      name: Type.String({ description: 'Filename (e.g. "report.html", "analysis.md").' }),
      content: Type.String({ description: 'File content (text). For HTML reports, pass the full HTML string.' }),
    }),
    async execute(_id, raw) {
      const { telegram_user_id, name, content } = raw as { telegram_user_id: number; name: string; content: string };
      try {
        const { token, slug } = getTokenForUser(telegram_user_id);
        const result = await apiCall('POST', `/api/files?slug=${encodeURIComponent(slug)}`, token, { name, content }) as { ok: boolean; name: string; size: number };
        return ok(`Uploaded "${result.name}" (${(result.size / 1024).toFixed(1)} KB) to InvesterDrive.`, { slug, name: result.name, size: result.size });
      } catch (e) { return failFrom(e); }
    },
  };

  const downloadFile: AgentTool = {
    name: 'bindrive_download',
    label: 'BinDrive Download',
    description: 'Download a file from the user\'s InvesterDrive folder. Returns the file content.',
    parameters: Type.Object({
      telegram_user_id: Type.Number({ description: 'Telegram user ID from the message context.' }),
      name: Type.String({ description: 'Filename to download.' }),
    }),
    async execute(_id, raw) {
      const { telegram_user_id, name } = raw as { telegram_user_id: number; name: string };
      try {
        const { token, slug } = getTokenForUser(telegram_user_id);
        const content = await apiCall('GET', `/api/files/${encodeURIComponent(name)}?slug=${encodeURIComponent(slug)}`, token) as string;
        return ok(`File "${name}":\n\n${content}`, { slug, name, content });
      } catch (e) { return failFrom(e); }
    },
  };

  const deleteFile: AgentTool = {
    name: 'bindrive_delete',
    label: 'BinDrive Delete',
    description: 'Delete a file from the user\'s InvesterDrive folder.',
    parameters: Type.Object({
      telegram_user_id: Type.Number({ description: 'Telegram user ID from the message context.' }),
      name: Type.String({ description: 'Filename to delete.' }),
    }),
    async execute(_id, raw) {
      const { telegram_user_id, name } = raw as { telegram_user_id: number; name: string };
      try {
        const { token, slug } = getTokenForUser(telegram_user_id);
        await apiCall('DELETE', `/api/files/${encodeURIComponent(name)}?slug=${encodeURIComponent(slug)}`, token);
        return ok(`Deleted "${name}" from InvesterDrive.`, { slug, name });
      } catch (e) { return failFrom(e); }
    },
  };

  return [listFiles, uploadFile, downloadFile, deleteFile];
}
