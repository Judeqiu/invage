import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { assertValidSlug, config, loadState } from 'utarus';

function result(text: string, details: unknown): AgentToolResult<unknown> {
  return { content: [{ type: 'text', text }], details };
}

/** Credentials stay in the host. The framework supplies this slug after authentication. */
export function createBoundBinDriveTools(userSlug: string, incognito?: true): AgentTool[] {
  if (typeof userSlug !== 'string' || !userSlug.trim()) throw new Error('Authenticated user identity required for BinDrive');
  assertValidSlug(userSlug);

  async function request(method: string, path: string, body?: unknown): Promise<string> {
    try {
      if (incognito === true) throw new Error('BinDrive is unavailable in incognito sessions');
      // Re-read on every operation so rotation/deletion takes effect without a new chat.
      const { state } = await loadState(userSlug);
      if (state.user.slug !== userSlug || state.user.deleted_at !== undefined) {
        throw new Error('BinDrive account unavailable');
      }
      const token = state.user.auth_token;
      if (typeof token !== 'string' || !token.trim()) throw new Error('BinDrive account credential missing');
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await fetch(`http://localhost:${config.webapp.port}${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`BinDrive API ${response.status}: ${text}`);
      return text;
    } catch (error) {
      console.error('[bindrive]', error);
      throw error;
    }
  }

  const filename = Type.String({ minLength: 1, description: 'Filename in your BinDrive folder.' });
  function nameFrom(raw: unknown): string {
    const name = (raw as { name?: unknown }).name;
    if (typeof name !== 'string' || !name.trim()) throw new Error('BinDrive filename required');
    return name;
  }
  return [{
    name: 'bindrive_list', label: 'BinDrive List Files',
    description: 'List files in the signed-in user’s BinDrive. Authentication is automatic; never request a token or login from the user.',
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute() {
      const data = JSON.parse(await request('GET', '/api/files')) as { files: Array<{ name: string; size: number; modified: string }> };
      return result(JSON.stringify(data), data);
    },
  }, {
    name: 'bindrive_upload', label: 'BinDrive Upload',
    description: 'Upload a text file to the signed-in user’s BinDrive. Authentication is automatic; supply only the filename and complete content.',
    parameters: Type.Object({ name: filename, content: Type.String({ description: 'Complete text file content.' }) }, { additionalProperties: false }),
    async execute(_id, raw) {
      const name = nameFrom(raw);
      const content = (raw as { content?: unknown }).content;
      if (typeof content !== 'string') throw new Error('BinDrive text content required');
      const data = JSON.parse(await request('POST', '/api/files', { name, content })) as { name: string; size: number };
      return result(`Uploaded "${data.name}" (${data.size} bytes) to BinDrive.`, data);
    },
  }, {
    name: 'bindrive_download', label: 'BinDrive Download',
    description: 'Download a file from the signed-in user’s BinDrive. Authentication is automatic; supply only the filename.',
    parameters: Type.Object({ name: filename }, { additionalProperties: false }),
    async execute(_id, raw) {
      const name = nameFrom(raw);
      const content = await request('GET', `/api/files/${encodeURIComponent(name)}`);
      return result(`File "${name}":\n${content}`, { name, content });
    },
  }, {
    name: 'bindrive_delete', label: 'BinDrive Delete',
    description: 'Delete a file from the signed-in user’s BinDrive. Authentication is automatic; supply only the filename.',
    parameters: Type.Object({ name: filename }, { additionalProperties: false }),
    async execute(_id, raw) {
      const name = nameFrom(raw);
      await request('DELETE', `/api/files/${encodeURIComponent(name)}`);
      return result(`Deleted "${name}" from BinDrive.`, { name });
    },
  }];
}
