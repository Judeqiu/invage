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
