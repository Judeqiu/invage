-- Separate derived risk queue; never stored in accounting tables or preview cache.
CREATE TABLE IF NOT EXISTS option_risk_jobs (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  context_id text NOT NULL,
  scope_key text NOT NULL,
  dedup_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','running','complete','failed','cancelled')),
  inputs jsonb NOT NULL,
  result jsonb,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  lease_token uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days'
);
CREATE INDEX IF NOT EXISTS option_risk_owner ON option_risk_jobs(owner_id, context_id, scope_key, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS option_risk_one_active ON option_risk_jobs(owner_id) WHERE status IN ('queued','running');
CREATE UNIQUE INDEX IF NOT EXISTS option_risk_dedup ON option_risk_jobs(owner_id, dedup_key) WHERE status IN ('queued','running');
