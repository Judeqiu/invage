import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { Router, json, type Express } from 'express';
import { requireAuth, requireAdmin, sessionUser } from 'utarus';
import { SignupReview, signupMailer, type ApprovalInput } from './review.js';
import { proofPreviewType } from './proof.js';
import { SubmissionError, signupSubmissions, type SubmissionRepository } from './submissions.js';

export function createSubmissionPublicRouter(getRepository: () => SubmissionRepository = signupSubmissions) {
  const router = Router();
  router.post('/submissions', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const b = req.body;
      if (!b || typeof b !== 'object') throw new SubmissionError('Submission data is required.');
      const requiredText = (key: string): string => {
        if (typeof b[key] !== 'string') throw new SubmissionError(`Missing field: ${key}.`);
        return b[key];
      };
      const encoded = requiredText('proofBase64');
      const proofData = Buffer.from(encoded, 'base64');
      if (proofData.toString('base64') !== encoded) throw new SubmissionError('Invalid payment-proof encoding.');
      const result = await getRepository().save({
        reference: requiredText('reference'), packageId: requiredText('packageId'),
        sessionDate: requiredText('sessionDate'), sessionTime: requiredText('sessionTime'),
        name: requiredText('name'), email: requiredText('email'), phone: requiredText('phone'),
        bankTransactionId: requiredText('bankTransactionId'), consentAccepted: b.consentAccepted === true,
        proof: { filename: requiredText('proofFilename'), contentType: requiredText('proofContentType'), data: proofData },
      });
      res.status(201).json(result);
    } catch (error) {
      if (error instanceof SubmissionError) { res.status(error.status).json({ error: error.message }); return; }
      console.error('[signup save]', error);
      res.status(503).json({ error: 'Your submission could not be saved. Please retry; your form is still shown.' });
    }
  });
  return router;
}

export function createSubmissionAdminRouter(getRepository: () => SubmissionRepository = signupSubmissions,
  getReview: () => SignupReview = () => new SignupReview(getRepository())) {
  const router = Router();
  router.use(requireAuth, requireAdmin);
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.param('id', (req, res, next, id) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      res.status(400).json({error:'Invalid submission ID.'}); return;
    }
    next();
  });
  router.use((req, res, next) => {
    if (req.method !== 'POST') { next(); return; }
    if (!req.get('origin') || ![`https://${req.get('host')}`, `http://${req.get('host')}`].includes(req.get('origin')!) ||
      (req.get('sec-fetch-site') && req.get('sec-fetch-site') !== 'same-origin')) {
      res.status(403).json({error:'A same-origin request is required.'}); return;
    }
    if (!req.is('application/json')) { res.status(415).json({error:'Expected application/json.'}); return; }
    next();
  });
  // PDF.js is already supplied by the pinned Utarus dependency. Serve only its
  // two viewer modules through administrator authentication, never upload paths.
  router.get('/submissions/pdfjs/:asset', (req, res) => {
    const asset = String(req.params.asset);
    if (!['pdf.mjs','pdf.worker.mjs'].includes(asset)) { res.sendStatus(404); return; }
    const require = createRequire(import.meta.url);
    const root = dirname(require.resolve('pdfjs-dist/package.json'));
    res.type('application/javascript').sendFile(resolve(root,'build',asset));
  });
  router.get('/submissions', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      res.json({ submissions: await getRepository().list(q), mailConfigured: signupMailer.configured() });
    } catch (error) {
      console.error('[signup query]', error);
      res.status(503).json({ error: 'Submissions are unavailable. Please retry.' });
    }
  });
  router.get('/submissions/:id/proof', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(req.params.id))) {
      res.status(400).json({ error: 'Invalid submission ID.' }); return;
    }
    try {
      const proof = await getRepository().proof(String(req.params.id));
      if (!proof) { res.status(404).json({ error: 'Submission not found.' }); return; }
      const previewType = req.query.preview === 'true' ? proofPreviewType(proof.proof_data) : null;
      res.setHeader('Content-Type', previewType ?? 'application/octet-stream');
      if (previewType) res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; frame-ancestors 'self'");
      res.setHeader('Content-Disposition', `${previewType ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(proof.proof_filename).replace(/'/g, '%27')}`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(proof.proof_data);
    } catch (error) {
      console.error('[signup proof]', error);
      res.status(503).json({ error: 'Payment proof is unavailable. Please retry.' });
    }
  });
  const failure = (error: unknown, res: import('express').Response) => {
    if (error instanceof SubmissionError) { res.status(error.status).json({error:error.message}); return; }
    // Never log provider payloads or credentials, including errors from encrypted mail state.
    console.error('[signup review] operation failed');
    res.status(503).json({error:'The operation could not be completed. Refresh the review to check its saved status before retrying.'});
  };
  router.get('/submissions/:id', async (req, res) => {
    try { res.json(await getReview().detail(String(req.params.id),
      typeof req.query.sessionDate === 'string' && typeof req.query.sessionTime === 'string'
        ? {date:req.query.sessionDate,time:req.query.sessionTime} : undefined)); }
    catch (error) { failure(error,res); }
  });
  router.post('/submissions/:id/approve', async (req, res) => {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object' || typeof body.sessionDate !== 'string' || typeof body.sessionTime !== 'string' ||
        (body.linkExistingUserId !== undefined && typeof body.linkExistingUserId !== 'string')) {
        throw new SubmissionError('Review confirmation is required.');
      }
      const input: ApprovalInput = {paymentVerified:body.paymentVerified === true,sessionConfirmed:body.sessionConfirmed === true,
        sessionDate:body.sessionDate,sessionTime:body.sessionTime,warningsAcknowledged:body.warningsAcknowledged === true,
        ...(body.linkExistingUserId ? {linkExistingUserId:body.linkExistingUserId} : {})};
      const actor = JSON.stringify({userId:sessionUser(req).userId ?? null,name:sessionUser(req).displayName});
      res.json(await getReview().approve(String(req.params.id),input,actor));
    } catch (error) { failure(error,res); }
  });
  router.post('/submissions/:id/send-email', async (req, res) => {
    try {
      if (!req.body || typeof req.body !== 'object') throw new SubmissionError('Email confirmation is required.');
      const actor = JSON.stringify({userId:sessionUser(req).userId ?? null,name:sessionUser(req).displayName});
      const review = getReview();
      await review.send(String(req.params.id),actor,req.body.acknowledgeUnknown === true);
      res.json(await review.detail(String(req.params.id)));
    } catch (error) { failure(error,res); }
  });
  return router;
}

/** Public intake must precede the framework's workflow-wide /api auth middleware. */
export function mountPublicSignupApi(app: Express, getRepository: () => SubmissionRepository = signupSubmissions) {
  app.use('/api/domain/invage/academy-signup', json({ limit: Infinity }), createSubmissionPublicRouter(getRepository));
}
