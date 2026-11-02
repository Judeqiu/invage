import nodemailer from 'nodemailer';
import { readAgentConfig } from 'utarus';
import { dashboardConfig } from '../webapp/dashboard-config.js';
import type { validateSubmission } from './submissions.js';

type Signup = ReturnType<typeof validateSubmission>;

/** Separate from customer access emails: this mailbox receives intake summaries. */
export async function notifyNewSignup(input: Signup): Promise<void> {
  const to = String(readAgentConfig(dashboardConfig).signup_notification_email).trim();
  if (!to) return;
  const email = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
  if (!email.test(to)) throw new Error('Invalid signup notification recipient');
  const host = process.env.INVAGE_SIGNUP_SMTP_HOST?.trim();
  const user = process.env.INVAGE_SIGNUP_SMTP_USER?.trim();
  const pass = process.env.INVAGE_SIGNUP_SMTP_PASSWORD;
  const from = process.env.INVAGE_SIGNUP_SMTP_FROM?.trim();
  const port = Number(process.env.INVAGE_SIGNUP_SMTP_PORT || '465');
  if (!host || !user || !pass || !from || !email.test(from) ||
      !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Signup notification SMTP setup is incomplete');
  }
  const transport = nodemailer.createTransport({
    host, port, secure: port === 465, requireTLS: true,
    auth: { user, pass }, tls: { minVersion: 'TLSv1.2' },
    disableFileAccess: true, disableUrlAccess: true,
  });
  try {
    const result = await transport.sendMail({
      from: { name: 'Velovest', address: from }, to,
      subject: `New Velovest signup (${input.reference})`,
      text: [
        'A new signup has been saved and is awaiting review.', '',
        `Reference: ${input.reference}`, `Customer: ${input.name}`,
        `Email: ${input.email}`, `Phone: ${input.phone}`,
        `Package: ${input.packageName}`, `Submitted amount: SGD ${input.amountSgd}`,
        `Requested session: ${input.sessionDate} ${input.sessionTime} (Singapore time)`, '',
        'Payment has not been verified. The payment proof is retained privately in the signup record.',
      ].join('\n'),
    });
    if (!result.accepted.length || result.rejected.length) throw new Error('Signup notification was not accepted');
  } finally {
    transport.close();
  }
}
