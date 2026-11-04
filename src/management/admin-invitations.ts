import { Router, json } from 'express';
import { requireAuth, requireAdmin, sessionUser, issueInviteCode } from 'utarus';
import { inviteOnboardUrl, originFromRequest } from '../../node_modules/utarus/dist/onboarding/invite-url.js';
import { configuredInvitationCode } from './invitation-code.js';

/** Preserve framework admin issuance, using the shared administrator-configured prefix. */
export function createAdminInvitationsRouter() {
  const router = Router();
  router.post('/invites', requireAuth, requireAdmin, json({ limit: Infinity }), async (req, res) => {
    try {
      const user = sessionUser(req);
      if (user.type !== 'admin' || !user.displayName) throw new Error('Admin session missing displayName.');
      const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : undefined;
      const orgId = typeof req.body?.org_id === 'string' ? req.body.org_id.trim() : '';
      const role = req.body?.role === 'admin' || req.body?.role === 'member' ? req.body.role : undefined;
      const code = await issueInviteCode({
        isPlatformAdmin: true, issuerId: user.displayName, createdViaWeb: user.displayName,
        comment, role, ...(orgId ? { orgId } : {}), customCode: configuredInvitationCode(),
      });
      res.json({ code: code.code, created_at: code.created_at, comment: code.comment,
        ...(orgId ? { org_id: code.org_id, role: code.role } : {}),
        onboard_url: inviteOnboardUrl({ origin: originFromRequest(req), code: code.code }),
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  return router;
}
