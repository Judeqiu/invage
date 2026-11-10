import { formatSessionDate, formatSlot, isSlotTime } from './catalog.js';
import { signupSmtp } from './notification.js';
import type { validateSubmission } from './submissions.js';

type Signup = ReturnType<typeof validateSubmission>;
export type ReceiptResult = { outcome: 'accepted'; messageId: string } | { outcome: 'rejected' | 'unknown' };

/** Receipt of evidence is separate from payment verification and account approval. */
export function signupReceipt(input: Signup) {
  const renewal = input.packageId === 'renewal';
  const session: string[] = [];
  if (!renewal) {
    if (!input.sessionDate || !isSlotTime(input.sessionTime)) throw new Error('Receipt requires a validated session');
    session.push(`Requested Onboarding Session: ${formatSessionDate(input.sessionDate)} at ${formatSlot(input.sessionTime, false)} (Singapore Time, SGT)`);
  }
  return {
    to: { name: input.name, address: input.email },
    replyTo: 'victor@viconium.com',
    subject: `We’ve received your proof of payment – Velovest [Reference: ${input.reference}]`,
    text: [
      `Dear ${input.name},`, '',
      'Thank you for choosing Velovest! We have successfully received your submission and uploaded proof of payment.', '',
      'Submission Summary',
      `Booking Reference: ${input.reference}`, `Package: ${input.packageName}`,
      `Submitted Amount: ${input.amountSgd} SGD (via PayNow)`,
      ...(renewal ? ['System subscription renewal · no onboarding session required.'] : session),
      'Proof of Payment: Attached & Received', '',
      'Important: Payment Verification Notice (Up to 2 Working Days)',
      'Our accounts team will verify your transaction against our bank records. Payment verification typically takes up to 2 working days. This email acknowledges receipt of your evidence; payment has not yet been verified.', '',
      'If your payment slip was incomplete, unclear, or missing details:',
      'In most cases, standard bank transfer receipts are processed without issue. If your screenshot or PDF was cut off, unclear, or does not clearly show the transaction reference and amount, our team will reach out via WhatsApp or email to request a clearer copy.',
      'If you uploaded the wrong file, reply directly to this email or message us on WhatsApp with your booking reference and updated screenshot.', '',
      'What Happens Next?',
      renewal ? 'After payment verification and approval, we will email your sign-in link and account details. Your renewal requires no onboarding appointment.' :
        'After payment verification and approval, we will email your confirmed onboarding session, sign-in link and account details. You can sign in after approval, ahead of your guided onboarding session.', '',
      'If you have any urgent questions, please contact us:',
      'Email: victor@viconium.com', 'WhatsApp: +65 9638 3772', '',
      'Warm regards,', 'The Velovest Team', 'Velovest Options AI · Intelligent Investment Technology', 'velovest.ai',
    ].join('\n'),
    attachments: [{ filename: input.proof.filename, contentType: input.proof.contentType, content: input.proof.data,
      contentDisposition: 'attachment' as const }],
  };
}

export async function sendSignupReceipt(input: Signup): Promise<ReceiptResult> {
  let smtp: ReturnType<typeof signupSmtp>;
  try { smtp = signupSmtp(); }
  catch { return { outcome: 'rejected' }; } // No send attempted.
  try {
    const result = await smtp.transport.sendMail({ from: smtp.from, ...signupReceipt(input) });
    if (result.accepted.length && !result.rejected.length) return { outcome: 'accepted', messageId: result.messageId };
    return { outcome: result.rejected.length && !result.accepted.length ? 'rejected' : 'unknown' };
  } catch {
    // A transport error may occur after acceptance. Never retry ambiguous delivery automatically.
    return { outcome: 'unknown' };
  } finally { smtp.transport.close(); }
}
