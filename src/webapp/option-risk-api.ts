import { Router, type Request } from 'express';
import { loadSessionState } from 'utarus';
import type { InvestorSnapshot } from '../state/investor-store.js';
import { analysisContext, normalizeRiskInputs, parseRiskRequest, readRiskMarketSnapshot, riskConfigured, riskEnabled, RiskError } from '../risk/context.js';
import { riskRepository, startRiskQueue } from '../risk/service.js';
import { ENGINE_VERSION } from '../risk/types.js';

export function createOptionRiskRouter() {
  const router = Router();
  startRiskQueue();
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });
  router.get('/capabilities', async (req, res) => {
    try {
      await loadSessionState(req);
      res.json({ enabled: riskEnabled(), available: riskConfigured(), engineVersion: ENGINE_VERSION,
        capabilities: { stress: true, greeks: true, forecast: false, actions: false },
        reason: riskConfigured() ? null : 'Analysis service is not configured.' });
    } catch { res.status(401).json({ error: 'Registered session required. Private/session-only analyses are not persisted.' }); }
  });
  router.use(async (req, res, next) => {
    try {
      const snapshot = await loadSessionState(req);
      if (!riskEnabled()) throw new RiskError(404, 'Risk analysis unavailable');
      if (!riskConfigured()) throw new RiskError(503, 'Analysis service is not configured');
      res.locals.riskSnapshot = snapshot;
      next();
    } catch (e) { res.status(e instanceof RiskError ? e.status : 401).json({ error: e instanceof RiskError ? e.message : 'Registered session required' }); }
  });
  router.post('/jobs', async (req, res) => {
    try {
      // Framework domain mount authenticates; no general CSRF middleware was found.
      // Use its same-origin JSON convention for this new mutation boundary.
      const origin = req.get('origin'), host = req.get('host'), site = req.get('sec-fetch-site');
      if (!origin || !host || ![`https://${host}`, `http://${host}`].includes(origin) || (site && site !== 'same-origin') || !req.is('application/json')) throw new RiskError(403, 'Same-origin JSON request required');
      const request = parseRiskRequest(req.body);
      const snapshot = res.locals.riskSnapshot as InvestorSnapshot;
      const inputs = normalizeRiskInputs(snapshot, request, await readRiskMarketSnapshot(snapshot.state.user.id));
      // Only the leased background worker collects connected market data.
      inputs.collectMarketData = true;
      if (!riskEnabled()) throw new RiskError(404, 'Risk analysis unavailable');
      const job = await riskRepository.enqueue(snapshot.state.user.id, request, inputs);
      res.status(job.status === 'complete' ? 200 : 202).json(job);
    } catch (e) { replyError(res, e); }
  });
  router.get('/latest', async (req, res) => {
    try {
      const request = parseRiskRequest(queryRequest(req));
      const snapshot = res.locals.riskSnapshot as InvestorSnapshot;
      if (request.analysisContextId !== analysisContext(snapshot)) throw new RiskError(409, 'Portfolio changed. Refresh the dashboard.');
      const date = req.query.date;
      if (date !== undefined && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))) throw new RiskError(400, 'Invalid archive date');
      const job = await riskRepository.latest(snapshot.state.user.id, request);
      // Live-only initial implementation: never supply a different-date result.
      const matching = !date || job?.result?.generatedAt.slice(0, 10) === date;
      if (matching && job?.result && job.result.model.version !== ENGINE_VERSION) throw new RiskError(409, 'Saved model version unsupported. Recalculate.');
      res.json(matching ? { job, stale: !!job?.result && Date.now() - Date.parse(job.result.marketAsOf || job.result.generatedAt) > 900_000 } : { job: null, stale: false });
    } catch (e) { replyError(res, e); }
  });
  for (const path of ['/jobs/:id', '/results/:id']) router.get(path, async (req, res) => {
    try {
      const snapshot = res.locals.riskSnapshot as InvestorSnapshot;
      const job = await riskRepository.get(snapshot.state.user.id, String(req.params.id));
      if (!job || (path.startsWith('/results') && !job.result)) throw new RiskError(404, 'Risk result not found');
      if (job.result && job.result.model.version !== ENGINE_VERSION) throw new RiskError(409, 'Saved model version unsupported. Recalculate.');
      res.json(path.startsWith('/results') ? job.result : job);
    } catch (e) { replyError(res, e); }
  });
  return router;
}
function queryRequest(req: Request) {
  const allowed = ['analysisContextId','kind','accountIds','horizonTradingDays','date'];
  if (Object.keys(req.query).some(k => !allowed.includes(k)) || Object.values(req.query).some(v => typeof v !== 'string')) throw new RiskError(400, 'Invalid query');
  return { analysisContextId: req.query.analysisContextId, accountScope: { kind: req.query.kind, accountIds: JSON.parse(String(req.query.accountIds ?? '[]')) },
    horizonTradingDays: Number(req.query.horizonTradingDays), scenarioSet: 'equity-options-standard-v1', mode: 'conditional', refresh: false };
}
function replyError(res: import('express').Response, e: unknown) {
  res.status(e instanceof RiskError ? e.status : e instanceof SyntaxError ? 400 : 503)
    .json({ error: e instanceof RiskError ? e.message : 'Analysis service unavailable' });
}
