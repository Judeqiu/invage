import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const adjacentBridge = fileURLToPath(new URL('./imap_bridge.py', import.meta.url));
const bridge = existsSync(adjacentBridge) ? adjacentBridge : join(process.cwd(), 'src/futubull/imap_bridge.py');
const marker = 'INVAGE_FUTU_MAIL_JSON:';

export interface FutubullMailboxCredentials {
  imap_host: string;
  imap_username: string;
  imap_password: string;
  sender_address: string;
  imap_folder?: string;
  subject_contains?: string;
}

export interface FutubullMailAttachment {
  uid: string;
  message_id: string;
  subject: string;
  date: string;
  filename: string;
  pdf: Buffer;
}

function validated(credentials: FutubullMailboxCredentials) {
  const host = credentials.imap_host?.trim().toLowerCase();
  if (!host || host.length > 253 || !/^[a-z0-9.-]+$/.test(host) ||
      host.startsWith('.') || host.endsWith('.') || host.includes('..') ||
      /^(localhost|\d+(?:\.\d+){3})$/.test(host)) {
    throw new Error('Enter a public IMAP hostname, such as mail.example.com.');
  }
  const username = credentials.imap_username?.trim();
  const password = credentials.imap_password;
  const sender = credentials.sender_address?.trim().toLowerCase();
  const folder = credentials.imap_folder?.trim() || 'INBOX';
  const subject = credentials.subject_contains?.trim() || '';
  if (!username || /[\r\n]/.test(username)) throw new Error('IMAP username is required.');
  if (!password || /[\r\n]/.test(password)) throw new Error('IMAP app password is required.');
  if (!sender || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender)) {
    throw new Error('A Futubull statement sender email address is required.');
  }
  if (folder.length > 128 || !/^[a-zA-Z0-9 _./-]+$/.test(folder)) {
    throw new Error('IMAP folder may contain only letters, numbers, spaces, /, _, . and -.');
  }
  if (subject.length > 120 || /[\r\n]/.test(subject)) {
    throw new Error('Subject filter must be a single line of at most 120 characters.');
  }
  return { host, port: 993, username, password, folder, sender, subject_contains: subject };
}

export async function fetchFutubullMailAttachments(
  credentials: FutubullMailboxCredentials,
): Promise<{ fetched_at: string; attachments: FutubullMailAttachment[] }> {
  const payload = JSON.stringify(validated(credentials));
  const result = await new Promise<{ stdout: string; error?: Error }>((resolve) => {
    const child = execFile('python3', [bridge], { timeout: 90_000, maxBuffer: 48 * 1024 * 1024 },
      (error, stdout) => resolve({ stdout, ...(error ? { error } : {}) }));
    child.stdin?.end(payload);
  });
  const line = result.stdout.split('\n').reverse().find(s => s.startsWith(marker));
  if (!line) throw new Error('Futubull mail reader failed. Check Python and the IMAP server.');
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(line.slice(marker.length)) as Record<string, unknown>; }
  catch { throw new Error('Futubull mail reader returned invalid data.'); }
  if (result.error || parsed.error) throw new Error(String(parsed.error ?? 'Futubull mail reader failed.'));
  if (typeof parsed.fetched_at !== 'string' || !Array.isArray(parsed.attachments)) {
    throw new Error('Futubull mail reader returned an invalid attachment list.');
  }
  const attachments = parsed.attachments.map((value): FutubullMailAttachment => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Futubull mail attachment is invalid.');
    }
    const row = value as Record<string, unknown>;
    if (typeof row.uid !== 'string' || typeof row.message_id !== 'string' ||
        typeof row.subject !== 'string' || typeof row.date !== 'string' ||
        typeof row.filename !== 'string' || typeof row.pdf_base64 !== 'string' ||
        typeof row.size !== 'number') {
      throw new Error('Futubull mail attachment is incomplete.');
    }
    const pdf = Buffer.from(row.pdf_base64, 'base64');
    if (pdf.length !== row.size || !pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      throw new Error('Futubull mail attachment is not a valid PDF.');
    }
    return { uid: row.uid, message_id: row.message_id, subject: row.subject,
      date: row.date, filename: row.filename, pdf };
  });
  return { fetched_at: parsed.fetched_at, attachments };
}
