import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { blankState, getAccountAuthority, hashPassword, verifyPassword } from 'utarus';
import { createSecretCodec, getDatabaseRuntime } from 'utarus/database';
import { initialUsageAccount } from '../../node_modules/utarus/dist/database/initial-usage.js';
import { sendTransactionalMail } from '../../node_modules/utarus/dist/mail/transactional.js';
import { formatSessionDate, formatSlot, isSlotTime } from './catalog.js';
import { SubmissionError, SubmissionRepository, summaryColumns, type SubmissionSummary } from './submissions.js';

type Codec = ReturnType<typeof createSecretCodec>;
type MailResult = { outcome: 'accepted'; messageId: string } | { outcome: 'rejected' | 'unknown' };
export interface SignupMailer {
  configured(): boolean;
  send(input: { to: string; subject: string; text: string; userId: string }): Promise<MailResult>;
}
export const signupMailer: SignupMailer = {
  configured: () => process.env.UTARUS_MAIL_SEND_ENABLED === 'true' &&
    process.env.UTARUS_MAIL_PROVIDER === 'postmark' &&
    ['UTARUS_MAIL_API_TOKEN', 'UTARUS_MAIL_TRANSACTIONAL_STREAM', 'UTARUS_MAIL_FROM_ADDRESS', 'UTARUS_MAIL_REPLY_TO']
      .every(key => Boolean(process.env[key]?.trim())),
  async send(input) {
    const result = await sendTransactionalMail(input);
    if (result.ok) return { outcome: 'accepted', messageId: result.messageId };
    // A timeout or missing receipt cannot establish whether the provider accepted mail.
    return { outcome: result.httpStatus && result.httpStatus >= 400 && result.httpStatus < 500 ? 'rejected' : 'unknown' };
  },
};
export function signupSecretCodec() {
  return createSecretCodec({ keyId: process.env.UTARUS_DATABASE_ENCRYPTION_KEY_ID ?? '',
    keyBase64: process.env.UTARUS_DATABASE_ENCRYPTION_KEY ?? '' });
}
export function signupLoginUrl() {
  const raw = process.env.UTARUS_PUBLIC_BASE_URL;
  if (!raw) throw new Error('UTARUS_PUBLIC_BASE_URL is required for signup access emails');
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Signup login URL requires an HTTPS public base URL');
  }
  return new URL('login', url.href.replace(/\/?$/, '/')).href;
}
export function accessEmail(row: Pick<SubmissionSummary, 'reference' | 'customer_name' | 'customer_email' |
  'package_id' | 'package_name' | 'amount_sgd' | 'session_date' | 'session_time' | 'confirmed_session_date' | 'confirmed_session_time'>,
  loginUrl: string, password: string | null) {
  const date = row.confirmed_session_date ?? row.session_date;
  const time = row.confirmed_session_time ?? row.session_time;
  let sessionDescription = 'System subscription renewal · no onboarding session.';
  if (row.package_id !== 'renewal') {
    if (!date || !validSessionDate(date) || !isSlotTime(time)) throw new SubmissionError('The signup is missing a valid onboarding session.');
    sessionDescription = `Onboarding: ${formatSessionDate(date)}, ${formatSlot(time)}`;
  }
  return {
    subject: `Your Velovest signup is approved (${row.reference})`,
    text: [
      `Hi ${row.customer_name},`, '',
      'Your payment has been verified and your Velovest signup is approved.', '',
      `Reference: ${row.reference}`, `Package: ${row.package_name}`, `Payment verified: SGD ${row.amount_sgd}`,
      sessionDescription, '',
      `Sign in: ${loginUrl}`, `Username (email): ${row.customer_email}`,
      ...(password ? [`Temporary password: ${password}`, '',
        'We recommend changing this password after signing in. Open your profile settings and choose Change password.'] :
        ['', 'Use your existing Velovest password. Your password has not been changed.']),
      '', row.package_id === 'renewal' ? 'You can sign in to the Velovest system using the details above.' :
        'You can sign in now. We will guide you through your package and dashboard during onboarding.',
      row.package_id === 'renewal' ? 'Please reply to this email if you need help with your account or subscription.' :
        'Please reply to this email if you need help with your account or appointment.', '', 'The Velovest team',
    ].join('\n'),
  };
}
export interface ApprovalInput {
  paymentVerified: boolean;
  sessionConfirmed: boolean;
  sessionDate?: string | null;
  sessionTime?: string | null;
  linkExistingUserId?: string;
  warningsAcknowledged: boolean;
}
interface Stored extends SubmissionSummary { access_secret: unknown; email_attempt_id: string | null }
export class SignupReview {
  constructor(readonly repository: SubmissionRepository,
    private readonly options: { codec?: () => Codec; mailer?: SignupMailer; loginUrl?: () => string } = {}) {}
  private get mailer() { return this.options.mailer ?? signupMailer; }
  private codec() { return (this.options.codec ?? signupSecretCodec)(); }
  private loginUrl() { return (this.options.loginUrl ?? signupLoginUrl)(); }
  async row(id: string, client: Pick<PoolClient, 'query'> = this.repository.pool): Promise<Stored> {
    const result = await client.query<Stored>(`SELECT ${summaryColumns}, access_secret, email_attempt_id
      FROM velovest_signup.submissions WHERE id=$1`, [id]);
    if (!result.rows[0]) throw new SubmissionError('Submission not found.', 404);
    return result.rows[0];
  }
  private publicRow(row: Stored): SubmissionSummary {
    const { access_secret: _secret, email_attempt_id: _attempt, ...summary } = row;
    return summary;
  }
  async context(row: SubmissionSummary) {
    const existing = await getAccountAuthority().users.findByEmail(row.customer_email.trim().toLowerCase());
    const related = await this.repository.pool.query<{ reference: string; reason: string }>(`
      SELECT reference, CASE WHEN proof_sha256=(SELECT proof_sha256 FROM velovest_signup.submissions WHERE id=$1)
        THEN 'Same payment evidence' WHEN bank_transaction_id<>'' AND bank_transaction_id=$3
        THEN 'Same bank transaction ID' ELSE 'Same email address' END AS reason
      FROM velovest_signup.submissions WHERE id<>$1 AND
        (lower(trim(customer_email))=lower(trim($2)) OR (bank_transaction_id<>'' AND bank_transaction_id=$3)
        OR proof_sha256=(SELECT proof_sha256 FROM velovest_signup.submissions WHERE id=$1))
      ORDER BY created_at DESC, id DESC`, [row.id, row.customer_email, row.bank_transaction_id]);
    const conflicts = row.package_id === 'renewal' ? [] : await this.sessionConflicts(row.id,
      row.confirmed_session_date ?? row.session_date, row.confirmed_session_time ?? row.session_time);
    return {
      existingAccount: existing ? { userId: existing.state.user.id, name: existing.state.profile.display_name,
        email: existing.state.profile.contact_email, inactive: Boolean(existing.state.user.deleted_at) } : null,
      relatedSubmissions: related.rows, sessionConflicts: conflicts,
    };
  }
  private async sessionConflicts(id: string, date: string | null, time: string | null, client: Pick<PoolClient, 'query'> = this.repository.pool) {
    const result = await client.query<{ reference: string }>(`SELECT reference FROM velovest_signup.submissions
      WHERE id<>$1 AND status='approved' AND confirmed_session_date=$2 AND confirmed_session_time=$3
      ORDER BY created_at,id`, [id, date, time]);
    return result.rows;
  }
  async detail(id: string, proposed?: {date: string; time: string}) {
    const row = await this.row(id);
    if (proposed && row.status === 'submitted' && row.package_id !== 'renewal') {
      if (!validSessionDate(proposed.date) || !isSlotTime(proposed.time)) throw new SubmissionError('Choose a valid weekday session date and time.');
      row.confirmed_session_date = proposed.date;
      row.confirmed_session_time = proposed.time;
    }
    const context = await this.context(row);
    const history = await this.repository.pool.query(`SELECT event,actor,created_at FROM velovest_signup.review_events
      WHERE submission_id=$1 ORDER BY id`, [id]);
    let password: string | null = !context.existingAccount && row.status === 'submitted'
      ? '[Generated securely on approval]' : null;
    let manualShareAvailable = false;
    let accessMessageNotice = '';
    if (row.status === 'approved' && row.account_user_id) {
      const account = await getAccountAuthority().users.readById(row.account_user_id);
      manualShareAvailable = !account.state.user.deleted_at &&
        account.state.profile.contact_email.trim().toLowerCase() === row.customer_email.trim().toLowerCase();
      if (!manualShareAvailable) accessMessageNotice = 'The account is inactive or its email changed. Resolve the account before sharing these instructions.';
      else if (row.account_kind === 'new' && row.access_secret) {
        const generated = this.codec().decrypt(row.access_secret, `velovest-signup:${id}`);
        if (account.state.user.password_hash && await verifyPassword(generated, account.state.user.password_hash)) password = generated;
        else accessMessageNotice = 'The customer has changed their password. The original temporary password is no longer shown; use the current-password instructions below.';
      } else if (row.account_kind === 'new') {
        accessMessageNotice = 'The original temporary password was not retained for this record and cannot be recovered. No password has been reset.';
      } else accessMessageNotice = 'Existing account: its password is unchanged and cannot be displayed. The message instructs the customer to use their current password.';
    }
    return { submission: this.publicRow(row), ...context, history: history.rows,
      mailConfigured: this.mailer.configured(), manualShareAvailable, accessMessageNotice,
      temporaryPasswordAvailable: row.status === 'approved' && password !== null,
      emailPreview: accessEmail(row, this.loginUrl(), password),
    };
  }

  async approve(id: string, input: ApprovalInput, actor: string) {
    if (!input.paymentVerified) throw new SubmissionError('Confirm payment verification.');
    if (process.env.UTARUS_ACCOUNTS_MODE && process.env.UTARUS_ACCOUNTS_MODE !== 'local') {
      throw new SubmissionError('This approval flow requires the configured local account authority.', 503);
    }
    this.loginUrl(); // Validate configuration before any writes.
    const client = await this.repository.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await client.query('SELECT id FROM velovest_signup.submissions WHERE id=$1 FOR UPDATE', [id]);
      const row = await this.row(id, client);
      if (row.status === 'approved') { await client.query('COMMIT'); return this.detail(id); }
      if (row.status !== 'submitted') throw new SubmissionError('This submission is not awaiting approval.', 409);
      const renewal = row.package_id === 'renewal';
      const sessionDate = renewal ? null : input.sessionDate ?? null;
      const sessionTime = renewal ? null : input.sessionTime ?? null;
      if (!renewal && !input.sessionConfirmed) throw new SubmissionError('Confirm the onboarding session.');
      if (!renewal && (!sessionDate || !validSessionDate(sessionDate) || !isSlotTime(sessionTime))) {
        throw new SubmissionError('Choose a valid weekday session date and time.');
      }
      // Match the framework registration lock, including JavaScript email normalization.
      const email = row.customer_email.trim().toLowerCase();
      const lock = createHash('sha256').update(JSON.stringify(['signup-email', email])).digest().readBigInt64BE().toString();
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [lock]);
      // Serialize decisions for the same requested time, but leave capacity decisions to the admin.
      if (!renewal) await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`velovest-session:${sessionDate}:${sessionTime}`]);
      const context = await this.context(row);
      const conflicts = renewal ? [] : await this.sessionConflicts(id, sessionDate, sessionTime, client);
      if ((context.relatedSubmissions.length || conflicts.length || (!renewal && Date.parse(`${sessionDate}T${sessionTime}:00+08:00`) <= Date.now())) && !input.warningsAcknowledged) {
        throw new SubmissionError('Review and acknowledge the duplicate, past-session or booking warnings before approval.', 409);
      }
      const existing = await getAccountAuthority().users.findByEmail(email);
      if (existing?.state.user.deleted_at) throw new SubmissionError('This email belongs to an inactive account. Resolve the account before approving.', 409);
      if (existing && input.linkExistingUserId !== existing.state.user.id) {
        throw new SubmissionError('An account already uses this email. Explicitly confirm linking the existing account; its password will remain unchanged.', 409);
      }
      if (!existing && input.linkExistingUserId) throw new SubmissionError('The selected existing account no longer matches. Refresh the review.', 409);
      let userId: string;
      let secret: unknown = null;
      if (existing) userId = existing.state.user.id;
      else {
        const password = randomBytes(24).toString('base64url');
        await getAccountAuthority().users.assertSignupEmailAvailableInTransaction(client,email);
        const state = blankState({ displayName: row.customer_name, contactEmail: email, language: 'en' });
        state.user.password_hash = await hashPassword(password);
        state.log.push({ ts: new Date().toISOString().slice(0,10), action: 'signup_approved', reference: row.reference, approved_by: actor });
        userId = state.user.id;
        secret = this.codec().encrypt(password, `velovest-signup:${id}`);
        // Use the framework repositories on this SAME transaction: account, usage,
        // approval and encrypted pending password commit or roll back together.
        const runtime = getDatabaseRuntime();
        await runtime.users.createInTransaction(client, state);
        await runtime.usage.createInTransaction(client, initialUsageAccount(userId, new Date().toISOString()));
      }
      await client.query(`UPDATE velovest_signup.submissions SET status='approved', approved_at=now(), approved_by=$2,
        account_user_id=$3, account_kind=$4, confirmed_session_date=$5, confirmed_session_time=$6,
        email_status='pending', access_secret=$7 WHERE id=$1`,
      [id, actor, userId, existing ? 'existing' : 'new', sessionDate, sessionTime, secret]);
      await this.event(client, id, existing ? 'Approved; existing account linked; access email queued' : 'Approved; account created; access email queued', actor);
      if (input.warningsAcknowledged) await this.event(client, id, 'Reviewer acknowledged duplicate / booking warnings', actor);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    await this.send(id, actor, false);
    return this.detail(id);
  }
  private async event(client: Pick<PoolClient, 'query'>, id: string, event: string, actor: string) {
    await client.query('INSERT INTO velovest_signup.review_events(submission_id,event,actor) VALUES ($1,$2,$3)', [id,event,actor]);
  }
  async send(id: string, actor: string, acknowledgeUnknown: boolean) {
    const client = await this.repository.pool.connect();
    const lock = `velovest-access-email:${id}`;
    let locked = false;
    try {
      locked = (await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', [lock])).rows[0].locked;
      if (!locked) throw new SubmissionError('An access email is already being processed. Refresh for its latest status.', 409);
      const row = await this.row(id, client);
      if (row.status !== 'approved' || !row.account_user_id) throw new SubmissionError('Approve the signup before sending its access email.', 409);
      if (row.email_status === 'sent') return; // Never regenerate or resend credentials after acceptance.
      if (['sending','unknown'].includes(row.email_status) && !acknowledgeUnknown) {
        throw new SubmissionError('The previous email attempt has no confirmed outcome. Check your mail provider, then explicitly acknowledge a possible duplicate before retrying.', 409);
      }
      if (!this.mailer.configured()) return; // Durable queue; admin sees Awaiting email setup.
      const account = await getAccountAuthority().users.readById(row.account_user_id);
      if (account.state.user.deleted_at || account.state.profile.contact_email.trim().toLowerCase() !== row.customer_email.trim().toLowerCase()) {
        throw new SubmissionError('The linked account is inactive or its email changed. Resolve this before sending access details.', 409);
      }
      let password: string | null = row.access_secret ? this.codec().decrypt(row.access_secret, `velovest-signup:${id}`) : null;
      if (password && (!account.state.user.password_hash || !await verifyPassword(password, account.state.user.password_hash))) password = null;
      const email = accessEmail(row, this.loginUrl(), password);
      const attempt = randomUUID();
      await client.query(`UPDATE velovest_signup.submissions SET email_status='sending', email_attempt_id=$2,
        email_attempted_at=now(), email_error=NULL WHERE id=$1`, [id,attempt]);
      await this.event(client, id, 'Access email send attempted', actor);
      let result: MailResult;
      try { result = await this.mailer.send({ to: row.customer_email, ...email, userId: row.account_user_id }); }
      catch { result = { outcome: 'unknown' }; }
      await client.query('BEGIN');
      if (result.outcome === 'accepted') {
        await client.query(`UPDATE velovest_signup.submissions SET email_status='sent', email_accepted_at=now(),
          email_message_id=$3, email_error=NULL WHERE id=$1 AND email_attempt_id=$2`, [id,attempt,result.messageId]);
        await this.event(client,id,'Access email accepted by provider (delivery to inbox is not yet verified)',actor);
      } else {
        const status = result.outcome === 'rejected' ? 'failed' : 'unknown';
        const message = status === 'failed' ? 'The email provider rejected this attempt. Check mail configuration and retry.' :
          'No confirmed provider receipt. Check the provider before retrying; the email may already have been sent.';
        await client.query('UPDATE velovest_signup.submissions SET email_status=$3,email_error=$4 WHERE id=$1 AND email_attempt_id=$2', [id,attempt,status,message]);
        await this.event(client,id,status === 'failed' ? 'Access email rejected by provider' : 'Access email outcome unconfirmed',actor);
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally {
      if (locked) await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lock]);
      client.release();
    }
  }
}
function validSessionDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value && ![0,6].includes(date.getUTCDay());
}
