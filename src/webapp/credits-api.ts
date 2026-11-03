import { Router } from 'express';
import { getEffectiveCap, loadUsage, type AuthUser } from 'utarus';

/** Session-owned allowance only: no admin target, account id or slug overrides. */
export function createCreditsRouter() {
  const router = Router();
  router.get('/', async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const user = (req as unknown as {user?: AuthUser}).user;
    if (!user) { res.status(401).json({message:'Please sign in to view your credits.'}); return; }
    if (user.type === 'admin') { res.json({unlimited:true}); return; }
    if (!user.userId) { res.status(401).json({message:'Please sign in to view your credits.'}); return; }
    try {
      const cap = await getEffectiveCap(user.userId, 'credits');
      if (cap === undefined) { res.json({unlimited:true}); return; }
      const usage = await loadUsage(user.userId);
      if (!usage.credit_window) throw new Error('Weekly allowance unavailable');
      res.json({unlimited:false,limit:cap,used:usage.period_credits,
        remaining:Math.max(0,cap-usage.period_credits),startsAt:usage.credit_window.startsAt,
        resetsAt:usage.credit_window.resetsAt,timeZone:'Asia/Singapore',blocked:usage.period_credits>=cap});
    } catch {
      res.status(503).json({message:'Your credit balance is temporarily unavailable. Please try again.'});
    }
  });
  return router;
}
