/** Personal presentation preferences: never an admin target or a financial-book write. */
import { Router, type RequestHandler } from 'express';
import { loadSessionState, saveState, type AuthUser } from 'utarus';
import type { InvestorState } from '../state/portfolio-state.js';

export function riskPageEnabled(state: Pick<InvestorState, 'experience_settings'>): boolean {
  return state.experience_settings?.account_risk === true;
}

export function dailyChangesEnabled(state: Pick<InvestorState, 'experience_settings'>): boolean {
  return state.experience_settings?.show_daily_changes === true;
}

/** Keep framework manifest/auth/session-key handling; filter only this optional destination. */
export const personalRiskManifest: RequestHandler = async (req, res, next) => {
  let enabled = false;
  try { enabled = riskPageEnabled((await loadSessionState(req)).state as InvestorState); }
  catch { /* A missing preference or unavailable state must never enable the page. */ }
  res.setHeader('Cache-Control', 'private, no-store');
  const json = res.json.bind(res);
  res.json = body => {
    if (body && Array.isArray(body.nav) && Array.isArray(body.routes)) {
      body = { ...body, nav: body.nav.filter((item: {id: string}) => item.id !== 'account-risk' || enabled),
        routes: body.routes.filter((item: {path: string}) => item.path !== '/risk' || enabled) };
    }
    return json(body);
  };
  next();
};

export function createExperienceSettingsRouter(): Router {
  const router = Router();
  router.use((_req, res, next) => {res.setHeader('Cache-Control', 'private, no-store'); next();});
  router.use((req, res, next) => {
    if (!(req as typeof req & {user?: AuthUser}).user?.userId) {res.status(401).json({message:'Sign in to manage your experience.'}); return;}
    next();
  });
  router.get('/', async (req, res) => {
    try {
      const snapshot = await loadSessionState(req);
      res.json({account_risk:riskPageEnabled(snapshot.state as InvestorState),show_daily_changes:dailyChangesEnabled(snapshot.state as InvestorState),revision:snapshot.revision});
    } catch {res.status(503).json({message:'Your settings could not be loaded. Please retry.'});}
  });
  router.put('/', async (req, res) => {
    const {account_risk, show_daily_changes, revision, ...extra} = req.body ?? {};
    if ((account_risk === undefined && show_daily_changes === undefined) ||
      (account_risk !== undefined && typeof account_risk !== 'boolean') ||
      (show_daily_changes !== undefined && typeof show_daily_changes !== 'boolean') || !Number.isSafeInteger(revision) || revision < 0 || Object.keys(extra).length) {
      res.status(400).json({message:'Send a page preference and its current revision.'}); return;
    }
    try {
      const snapshot = await loadSessionState(req);
      if (snapshot.revision !== revision) {res.status(409).json({message:'Your account changed. Reload settings and try again.'}); return;}
      const state = snapshot.state as InvestorState;
      const preferences = {
        account_risk: account_risk ?? riskPageEnabled(state),
        show_daily_changes: show_daily_changes ?? dailyChangesEnabled(state),
      };
      if (riskPageEnabled(state) !== preferences.account_risk || dailyChangesEnabled(state) !== preferences.show_daily_changes) {
        state.experience_settings = {...state.experience_settings, ...preferences};
        await saveState(state, snapshot.revision);
        snapshot.revision++;
      }
      res.json({...preferences,revision:snapshot.revision});
    } catch (error) {
      const conflict = error instanceof Error && /revision|conflict|changed/i.test(error.message);
      res.status(conflict ? 409 : 503).json({message:conflict ? 'Your account changed. Reload settings and try again.' : 'Could not save. Your previous setting is still in place.'});
    }
  });
  return router;
}
