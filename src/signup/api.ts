import { Router, json, type Express } from 'express';
import { requireAuth, requireAdmin } from 'utarus';
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

export function createSubmissionAdminRouter(getRepository: () => SubmissionRepository = signupSubmissions) {
  const router = Router();
  router.use(requireAuth, requireAdmin);
  router.get('/submissions', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      res.json({ submissions: await getRepository().list(q) });
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
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(proof.proof_filename).replace(/'/g, '%27')}`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(proof.proof_data);
    } catch (error) {
      console.error('[signup proof]', error);
      res.status(503).json({ error: 'Payment proof is unavailable. Please retry.' });
    }
  });
  return router;
}

/** Public intake must precede the framework's workflow-wide /api auth middleware. */
export function mountPublicSignupApi(app: Express, getRepository: () => SubmissionRepository = signupSubmissions) {
  app.use('/api/domain/invage/academy-signup', json({ limit: Infinity }), createSubmissionPublicRouter(getRepository));
}
