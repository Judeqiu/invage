import { config } from '../config.js';
import { listUserSlugs, loadState } from '../state/index.js';
import type { Request, Response, NextFunction } from 'express';

export interface AuthUser {
  type: 'admin' | 'user';
  slug: string;
  displayName: string;
}

const sessions = new Map<string, { user: AuthUser; expiresAt: number }>();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export function createSession(user: AuthUser): string {
  const token = crypto.randomUUID();
  sessions.set(token, { user, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

export function getSession(token: string): AuthUser | null {
  const entry = sessions.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return entry.user;
}

export function destroySession(token: string): void {
  sessions.delete(token);
}

export function resolveByToken(driveToken: string): AuthUser | null {
  const slugs = listUserSlugs();
  for (const slug of slugs) {
    try {
      const state = loadState(slug);
      const driveTokenVal = (state.profile as Record<string, unknown>).drive_token;
      if (driveTokenVal && driveTokenVal === driveToken) {
        return { type: 'user', slug, displayName: state.profile.display_name };
      }
    } catch {
      // skip broken state files
    }
  }
  return null;
}

export function authenticateAdmin(username: string, password: string): AuthUser | null {
  const expected = config.webapp.adminCredentials[username];
  if (expected !== undefined && password === expected) {
    return { type: 'admin', slug: 'admin', displayName: username };
  }
  return null;
}

function extractAuth(req: Request): { user: AuthUser | null; method: string } {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const user = resolveByToken(token);
    if (user) return { user, method: 'bearer' };
    const session = getSession(token);
    if (session) return { user: session, method: 'session' };
  }

  const queryToken = req.query.token as string;
  if (queryToken) {
    const user = resolveByToken(queryToken);
    if (user) return { user, method: 'query' };
  }

  const cookieToken = req.cookies?.['invester_session'];
  if (cookieToken) {
    const session = getSession(cookieToken);
    if (session) return { user: session, method: 'cookie' };
  }

  return { user: null, method: 'none' };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const { user } = extractAuth(req);
  if (!user) {
    if (req.path.endsWith('/view')) {
      const returnUrl = encodeURIComponent(req.originalUrl);
      res.redirect(`/login?return=${returnUrl}`);
      return;
    }
    if (req.path.startsWith('/api/')) {
      res.status(401).json({ error: 'Unauthorized. Provide drive_token via Authorization: Bearer <token>' });
      return;
    }
    res.redirect('/login');
    return;
  }
  (req as any).user = user;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = (req as any).user as AuthUser;
  if (!user || user.type !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

export function targetSlug(req: Request, user: AuthUser): string {
  if (user.type === 'admin') {
    const slug = req.query.slug as string;
    if (!slug) throw new Error('Admin must specify ?slug=<user-slug>');
    if (!listUserSlugs().includes(slug)) throw new Error(`User "${slug}" not found`);
    return slug;
  }
  return user.slug;
}
