import { cashSlotKey, type InvestorState } from '../state/portfolio-state.js';
import { listReconChannels } from './sleeves.js';
import {
  assertReconSession,
  type ChannelReconSession,
  type ReconLine,
  type ReconNext,
  type ReconSleeve,
  type ReconView,
} from './types.js';

export function requireYmd(value: string, field: string): string {
  const t = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    throw new Error(`${field} must be YYYY-MM-DD.`);
  }
  return t;
}

export function readRecon(state: InvestorState): ChannelReconSession | null {
  if (state.recon == null) return null;
  return assertReconSession(state.recon);
}

export function writeRecon(state: InvestorState, session: ChannelReconSession): void {
  state.recon = session;
}

function firstOpen(session: ChannelReconSession): ReconSleeve | undefined {
  return session.sleeves.find((s) => s.status !== 'applied' && s.status !== 'skipped');
}

export function requireSession(state: InvestorState): ChannelReconSession {
  const session = readRecon(state);
  if (!session) throw new Error('No recon session. Call start_recon with as_of first.');
  return session;
}

export function requireSleeve(session: ChannelReconSession, channel: string): ReconSleeve {
  const key = cashSlotKey(channel);
  const sleeve = session.sleeves.find((s) => cashSlotKey(s.channel) === key);
  if (!sleeve) {
    throw new Error(
      `Channel ${key.length > 0 ? key : '(unassigned)'} is not in this recon. Included: ${session.sleeves
        .map((s) => (s.channel.length > 0 ? s.channel : '(unassigned)'))
        .join(', ')}.`,
    );
  }
  return sleeve;
}

function syncCurrentAndStatus(session: ChannelReconSession): void {
  const open = firstOpen(session);
  if (!open) {
    session.status = 'done';
    return;
  }
  session.status = 'in_progress';
  session.current_channel = open.channel;
}

export function startRecon(
  state: InvestorState,
  args: { as_of: string; channel?: string; restart?: boolean },
): ChannelReconSession {
  const as_of = requireYmd(args.as_of ?? '', 'as_of');
  const existing = readRecon(state);
  if (existing?.status === 'in_progress' && args.restart !== true) {
    throw new Error(
      `A recon session is already in progress (as_of ${existing.as_of}). Pass restart=true to replace it, or continue with get_recon.`,
    );
  }
  const named = args.channel != null ? cashSlotKey(args.channel) : undefined;
  let walk = listReconChannels(state);
  if (named !== undefined && !walk.includes(named)) {
    walk = named.length > 0 ? [named, ...walk] : [...walk, ''];
  }
  if (walk.length === 0) {
    throw new Error(
      'No custody sleeves. Enable a broker connector or pass channel to open a sleeve.',
    );
  }
  const session: ChannelReconSession = {
    as_of,
    status: 'in_progress',
    current_channel: walk[0],
    sleeves: walk.map((channel) => ({ channel, status: 'pending' })),
  };
  writeRecon(state, session);
  return session;
}

export function skipReconChannel(state: InvestorState, channel: string): ChannelReconSession {
  const session = requireSession(state);
  if (session.status === 'done') throw new Error('Recon is already done.');
  const sleeve = requireSleeve(session, channel);
  if (sleeve.status === 'applied') {
    throw new Error(`Channel ${formatCh(sleeve.channel)} is already applied; cannot skip.`);
  }
  sleeve.status = 'skipped';
  syncCurrentAndStatus(session);
  writeRecon(state, session);
  return session;
}

function formatCh(channel: string): string {
  return channel.length > 0 ? channel : '(unassigned)';
}

export function viewRecon(session: ChannelReconSession): ReconView {
  const open = firstOpen(session);
  let next: ReconNext = 'done';
  let open_lines: ReconLine[] = [];
  if (open) {
    if (open.status === 'pending') next = 'source';
    else if (open.status === 'sourced' || open.status === 'compared') {
      const lines = open.lines ?? [];
      open_lines = lines.filter((l) => l.decision == null);
      next = open_lines.length > 0 ? 'decide' : 'apply';
    }
  }
  return {
    as_of: session.as_of,
    status: session.status,
    current_channel: open ? open.channel : session.current_channel,
    next,
    open_lines,
    sleeves: session.sleeves.map((s) => ({ channel: s.channel, status: s.status })),
  };
}

export function getRecon(state: InvestorState): ReconView {
  return viewRecon(requireSession(state));
}

export function markSleeve(
  state: InvestorState,
  channel: string,
  patch: Partial<ReconSleeve>,
): ReconSleeve {
  const session = requireSession(state);
  const sleeve = requireSleeve(session, channel);
  Object.assign(sleeve, patch);
  syncCurrentAndStatus(session);
  writeRecon(state, session);
  return sleeve;
}
