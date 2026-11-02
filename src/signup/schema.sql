CREATE SCHEMA IF NOT EXISTS velovest_signup;
REVOKE ALL ON SCHEMA velovest_signup FROM PUBLIC;

CREATE TABLE IF NOT EXISTS velovest_signup.submissions (
    id uuid PRIMARY KEY,
    reference text NOT NULL UNIQUE,
    package_id text NOT NULL,
    package_name text NOT NULL,
    amount_sgd numeric NOT NULL,
    session_date date NOT NULL,
    session_time text NOT NULL,
    customer_name text NOT NULL,
    customer_email text NOT NULL,
    customer_phone text NOT NULL,
    bank_transaction_id text NOT NULL,
    consent_accepted boolean NOT NULL CHECK (consent_accepted),
    proof_filename text NOT NULL,
    proof_content_type text NOT NULL,
    proof_sha256 text NOT NULL,
    proof_data bytea NOT NULL,
    submission_fingerprint text NOT NULL,
    status text NOT NULL DEFAULT 'submitted',
    created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE velovest_signup.submissions FROM PUBLIC;
CREATE INDEX IF NOT EXISTS signup_submissions_created_at ON velovest_signup.submissions (created_at DESC, id DESC);

-- Additive upgrade for the existing intake table; submitted evidence is immutable.
ALTER TABLE velovest_signup.submissions
    ADD COLUMN IF NOT EXISTS approved_at timestamptz,
    ADD COLUMN IF NOT EXISTS approved_by text,
    ADD COLUMN IF NOT EXISTS account_user_id uuid,
    ADD COLUMN IF NOT EXISTS account_kind text,
    ADD COLUMN IF NOT EXISTS confirmed_session_date date,
    ADD COLUMN IF NOT EXISTS confirmed_session_time text,
    ADD COLUMN IF NOT EXISTS email_status text NOT NULL DEFAULT 'not_queued',
    ADD COLUMN IF NOT EXISTS email_attempt_id uuid,
    ADD COLUMN IF NOT EXISTS email_attempted_at timestamptz,
    ADD COLUMN IF NOT EXISTS email_accepted_at timestamptz,
    ADD COLUMN IF NOT EXISTS email_message_id text,
    ADD COLUMN IF NOT EXISTS email_error text,
    ADD COLUMN IF NOT EXISTS access_secret jsonb;

CREATE TABLE IF NOT EXISTS velovest_signup.review_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    submission_id uuid NOT NULL REFERENCES velovest_signup.submissions(id),
    event text NOT NULL,
    actor text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE velovest_signup.review_events FROM PUBLIC;
CREATE INDEX IF NOT EXISTS signup_review_events_submission
    ON velovest_signup.review_events(submission_id, id);
