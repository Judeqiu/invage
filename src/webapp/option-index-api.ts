import { Router, type Request } from 'express';
import { loadSessionState } from 'utarus';
import { generateOptionIndex, OptionIndexError } from '../risk/option-index.js';
import { readDashboardConfig } from './dashboard-config.js';

export function createOptionIndexRouter(options: {
  authenticate?: (req: Request) => Promise<unknown>;
  enabled?: () => boolean;
  generate?: typeof generateOptionIndex;
} = {}) {
  const router = Router(), enabled = options.enabled ?? (() => readDashboardConfig().showOptionRiskCalculator);
  const authenticate = options.authenticate ?? loadSessionState, generate = options.generate ?? generateOptionIndex;
  let active = 0;
  router.use(async (req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try { await authenticate(req); next(); }
    catch { res.status(401).json({ error: 'Registered session required.' }); }
  });
  router.get('/capabilities', (_req, res) => res.json({ enabled: enabled(), automatic: true }));
  router.post('/', async (req, res) => {
    if (!enabled()) { res.status(404).json({ error: 'Option risk index page is hidden in Management. You can request an index in chat.' }); return; }
    const origin = req.get('origin'), host = req.get('host');
    if (!host || !origin || ![`https://${host}`, `http://${host}`].includes(origin) ||
        (req.get('sec-fetch-site') && req.get('sec-fetch-site') !== 'same-origin') || !req.is('application/json')) {
      res.status(403).json({ error: 'Same-origin JSON request required.' }); return;
    }
    if (active >= 4) { res.status(429).json({ error: 'Index lookups are busy. Try again shortly.' }); return; }
    const abort = new AbortController();
    const onClose = () => { if (!res.writableEnded) abort.abort(); };
    res.on('close', onClose);
    active++;
    try { res.json(await generate(req.body, undefined, abort.signal)); }
    catch (e) { if (!abort.signal.aborted) res.status(e instanceof OptionIndexError ? e.status : 503)
      .json({ error: e instanceof OptionIndexError ? e.message : 'Option index unavailable; no score was calculated.' }); }
    finally { active--; res.off('close', onClose); }
  });
  return router;
}
