import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { readDatabaseConfig } from '../../node_modules/utarus/dist/database/config.js';
import { isPackageId, isSlotTime, packageTotal, packages } from './catalog.js';

export class SubmissionError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

export interface SubmissionInput {
  reference: string;
  packageId: string;
  sessionDate: string;
  sessionTime: string;
  name: string;
  email: string;
  phone: string;
  bankTransactionId: string;
  consentAccepted: boolean;
  proof: { filename: string; contentType: string; data: Buffer };
}

export interface SubmissionSummary {
  id: string;
  reference: string;
  package_id: string;
  package_name: string;
  amount_sgd: string;
  session_date: string;
  session_time: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  bank_transaction_id: string;
  proof_filename: string;
  status: string;
  created_at: Date;
}

const summaryColumns = `id, reference, package_id, package_name, amount_sgd::text,
  to_char(session_date, 'YYYY-MM-DD') AS session_date, session_time,
  customer_name, customer_email, customer_phone, bank_transaction_id,
  proof_filename, status, created_at`;

export function validateSubmission(input: SubmissionInput) {
  if (!/^VV-[A-Z0-9]{6}$/.test(input.reference)) throw new SubmissionError('Invalid submission reference.');
  if (!isPackageId(input.packageId)) throw new SubmissionError('Choose a valid package.');
  const date = new Date(`${input.sessionDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.sessionDate) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.sessionDate || [0, 6].includes(date.getUTCDay())) {
    throw new SubmissionError('Choose a valid weekday session date.');
  }
  if (!isSlotTime(input.sessionTime)) throw new SubmissionError('Choose a valid session time.');
  if (input.name.trim().length < 2) throw new SubmissionError('Enter your full name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) throw new SubmissionError('Enter a valid email address.');
  if (!input.consentAccepted) throw new SubmissionError('Please confirm the acknowledgement to continue.');
  if (!input.proof.filename || !input.proof.data.length) throw new SubmissionError('Upload your payment proof.');
  // The existing checkout accepts images and PDF files; retain that rule here.
  if (!/^(image\/[^\s;]+|application\/pdf)$/.test(input.proof.contentType)) throw new SubmissionError('Upload an image or PDF.');
  return {
    ...input, name: input.name.trim(), email: input.email.trim(),
    phone: input.phone.trim(), bankTransactionId: input.bankTransactionId.trim(),
    packageId: input.packageId,
    packageName: packages[input.packageId].name,
    amountSgd: packageTotal(input.packageId),
  };
}

export class SubmissionRepository {
  constructor(private readonly pool: pg.Pool) {}

  async save(raw: SubmissionInput): Promise<{ reference: string }> {
    const input = validateSubmission(raw);
    const proofHash = createHash('sha256').update(input.proof.data).digest('hex');
    const fingerprint = createHash('sha256').update(JSON.stringify({
      reference: input.reference, packageId: input.packageId, packageName: input.packageName,
      amountSgd: input.amountSgd, date: input.sessionDate, time: input.sessionTime,
      name: input.name, email: input.email, phone: input.phone, txn: input.bankTransactionId,
      consent: true, proof: { name: input.proof.filename, type: input.proof.contentType, sha256: proofHash },
    })).digest('hex');
    const result = await this.pool.query<{ reference: string }>(`
      INSERT INTO velovest_signup.submissions
      (id, reference, package_id, package_name, amount_sgd, session_date, session_time,
       customer_name, customer_email, customer_phone, bank_transaction_id, consent_accepted,
       proof_filename, proof_content_type, proof_sha256, proof_data, submission_fingerprint)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$12,$13,$14,$15,$16)
      ON CONFLICT (reference) DO UPDATE SET reference = EXCLUDED.reference
        WHERE submissions.submission_fingerprint = EXCLUDED.submission_fingerprint
      RETURNING reference`, [randomUUID(), input.reference, input.packageId, input.packageName,
      input.amountSgd, input.sessionDate, input.sessionTime, input.name, input.email,
      input.phone, input.bankTransactionId, input.proof.filename, input.proof.contentType,
      proofHash, input.proof.data, fingerprint]);
    if (!result.rows[0]) throw new SubmissionError('This reference already belongs to a different submission. Your changes were not saved.', 409);
    return result.rows[0];
  }

  async list(search: string): Promise<SubmissionSummary[]> {
    const result = await this.pool.query<SubmissionSummary>(`SELECT ${summaryColumns}
      FROM velovest_signup.submissions
      WHERE $1 = '' OR concat_ws(' ',reference,package_id,package_name,amount_sgd::text,
        session_date::text,session_time,customer_name,customer_email,customer_phone,
        bank_transaction_id,status) ILIKE '%' || $1 || '%'
      ORDER BY created_at DESC, id DESC`, [search]);
    return result.rows;
  }

  async proof(id: string) {
    const result = await this.pool.query<{ proof_filename: string; proof_data: Buffer }>(
      'SELECT proof_filename, proof_data FROM velovest_signup.submissions WHERE id = $1::uuid', [id]);
    return result.rows[0];
  }
}

let repository: SubmissionRepository | undefined;
export function signupSubmissions(): SubmissionRepository {
  if (!repository) {
    const pool = new pg.Pool({ ...readDatabaseConfig(process.env), application_name: 'velovest-signup' });
    pool.on('error', error => console.error('[signup database]', error));
    repository = new SubmissionRepository(pool);
  }
  return repository;
}
