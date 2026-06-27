import { Router, type Request, type Response } from 'express';
import { readdirSync, existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, statSync } from 'fs';
import { join, basename } from 'path';
import { resolveDataRoot } from '../config.js';
import { requireAuth, requireAdmin, createSession, destroySession, authenticateAdmin, resolveByToken, type AuthUser, targetSlug } from './auth.js';
import { loginPage, drivePage } from './views.js';
import { listUserSlugs } from '../state/index.js';

const router = Router();

function driveDir(slug: string): string {
  return join(resolveDataRoot(), 'drive', slug);
}

function ensureDriveDir(slug: string): string {
  const dir = driveDir(slug);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function listFiles(slug: string): Array<{ name: string; size: number; modified: string }> {
  const dir = driveDir(slug);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => !f.startsWith('.'))
    .map(f => {
      const stat = statSync(join(dir, f));
      return { name: f, size: stat.size, modified: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.modified.localeCompare(a.modified));
}

// ── Browser UI ──────────────────────────────────────────────────────

router.get('/login', (req: Request, res: Response) => {
  const returnUrl = (req.query.return as string) || '';
  res.send(loginPage(undefined, returnUrl));
});

router.post('/login', (req: Request, res: Response) => {
  const { token, username, return: returnUrl } = req.body;
  if (!token) {
    res.send(loginPage('Token required', returnUrl));
    return;
  }

  let user = !username ? resolveByToken(token) : null;
  if (!user && username) {
    user = authenticateAdmin(username, token);
  }
  if (!user) {
    res.send(loginPage('Invalid credentials', returnUrl));
    return;
  }

  const sessionToken = createSession(user);
  res.cookie('invester_session', sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  });
  res.redirect(returnUrl && returnUrl.startsWith('/') ? returnUrl : '/');
});

router.get('/logout', (req: Request, res: Response) => {
  const token = req.cookies?.['invester_session'];
  if (token) destroySession(token);
  res.clearCookie('invester_session');
  res.redirect('/login');
});

router.get('/', requireAuth, (req: Request, res: Response) => {
  const user = (req as any).user as AuthUser;
  try {
    const slug = targetSlug(req, user);
    const files = listFiles(slug);
    res.send(drivePage(user, slug, files));
  } catch (e) {
    res.status(400).send((e as Error).message);
  }
});

// ── API: File management ────────────────────────────────────────────

router.get('/api/files', requireAuth, (req: Request, res: Response) => {
  const user = (req as any).user as AuthUser;
  try {
    const slug = targetSlug(req, user);
    const files = listFiles(slug);
    res.json({ slug, files });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

router.post('/api/files', requireAuth, (req: Request, res: Response) => {
  const user = (req as any).user as AuthUser;
  try {
    const slug = targetSlug(req, user);
    const dir = ensureDriveDir(slug);

    if (req.body?.name && req.body?.content !== undefined) {
      const name = basename(req.body.name);
      if (!name || name.startsWith('.')) {
        res.status(400).json({ error: 'Invalid file name' });
        return;
      }
      const filePath = join(dir, name);
      writeFileSync(filePath, req.body.content, 'utf-8');
      res.json({ ok: true, name, size: Buffer.byteLength(req.body.content) });
      return;
    }

    if ((req as any).file) {
      const file = (req as any).file;
      const name = basename(file.originalname);
      const filePath = join(dir, name);
      writeFileSync(filePath, file.buffer);
      res.json({ ok: true, name, size: file.size });
      return;
    }

    res.status(400).json({ error: 'Provide { name, content } in JSON body, or multipart file' });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.get('/api/files/:name', requireAuth, (req: Request, res: Response) => {
  const user = (req as any).user as AuthUser;
  try {
    const slug = targetSlug(req, user);
    const name = basename(req.params.name as string);
    const filePath = join(driveDir(slug), name);

    if (!existsSync(filePath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const content = readFileSync(filePath);
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(content);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.delete('/api/files/:name', requireAuth, (req: Request, res: Response) => {
  const user = (req as any).user as AuthUser;
  try {
    const slug = targetSlug(req, user);
    const name = basename(req.params.name as string);
    const filePath = join(driveDir(slug), name);

    if (!existsSync(filePath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    unlinkSync(filePath);
    res.json({ ok: true, deleted: name });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.get('/api/files/:name/view', requireAuth, (req: Request, res: Response) => {
  const user = (req as any).user as AuthUser;
  try {
    const slug = targetSlug(req, user);
    const name = basename(req.params.name as string);
    const filePath = join(driveDir(slug), name);

    if (!existsSync(filePath)) {
      res.status(404).send('File not found');
      return;
    }

    const content = readFileSync(filePath, 'utf-8');
    res.setHeader('Content-Type', 'text/html');
    res.send(content);
  } catch (e) {
    res.status(500).send((e as Error).message);
  }
});

export default router;
