-- Organization-owned finance foundation. Apply in the Utarus database, not the
-- legacy INVAGE_BOOKS_DATABASE_URL database. No existing personal data is moved.
CREATE SCHEMA IF NOT EXISTS finance;

CREATE TABLE IF NOT EXISTS finance.organizations (
  org_id uuid PRIMARY KEY REFERENCES utarus.orgs(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('family', 'entity', 'trust', 'other')),
  reporting_currency text CHECK (reporting_currency ~ '^[A-Z]{3}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finance.access_grants (
  org_id uuid NOT NULL REFERENCES finance.organizations(org_id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('viewer', 'editor', 'manager')),
  granted_by uuid NOT NULL REFERENCES utarus.users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id),
  FOREIGN KEY (org_id, user_id) REFERENCES utarus.org_memberships(org_id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS finance.accounts (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES finance.organizations(org_id),
  connector_id text NOT NULL CHECK (length(trim(connector_id)) > 0),
  broker_account_id text NOT NULL CHECK (length(trim(broker_account_id)) > 0),
  label text,
  legacy_user_id uuid REFERENCES utarus.users(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  UNIQUE (id, org_id, connector_id),
  UNIQUE (org_id, connector_id, broker_account_id)
);

CREATE TABLE IF NOT EXISTS finance.assets (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES finance.organizations(org_id),
  kind text NOT NULL CHECK (kind IN ('equity', 'fund', 'option', 'deposit', 'property', 'other')),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  legacy_user_id uuid REFERENCES utarus.users(id),
  legacy_key text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  UNIQUE (org_id, legacy_user_id, legacy_key)
);

CREATE TABLE IF NOT EXISTS finance.account_credentials (
  org_id uuid NOT NULL REFERENCES finance.organizations(org_id),
  account_id uuid NOT NULL,
  encrypted_credentials jsonb NOT NULL CHECK (jsonb_typeof(encrypted_credentials) = 'object'),
  enabled boolean NOT NULL,
  last_sync jsonb CHECK (last_sync IS NULL OR jsonb_typeof(last_sync) = 'object'),
  metrics jsonb CHECK (metrics IS NULL OR jsonb_typeof(metrics) = 'object'),
  source_user_id uuid NOT NULL REFERENCES utarus.users(id),
  PRIMARY KEY (org_id, account_id),
  FOREIGN KEY (account_id, org_id) REFERENCES finance.accounts(id, org_id)
);

CREATE TABLE IF NOT EXISTS finance.positions (
  org_id uuid NOT NULL REFERENCES finance.organizations(org_id),
  account_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  broker_lot_id text NOT NULL DEFAULT '',
  quantity numeric(28,10) NOT NULL,
  unit_cost numeric(28,10),
  cost_currency text CHECK (cost_currency ~ '^[A-Z]{3}$'),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  as_of timestamptz NOT NULL,
  PRIMARY KEY (org_id, account_id, asset_id, broker_lot_id),
  FOREIGN KEY (account_id, org_id) REFERENCES finance.accounts(id, org_id),
  FOREIGN KEY (asset_id, org_id) REFERENCES finance.assets(id, org_id),
  CHECK ((unit_cost IS NULL) = (cost_currency IS NULL))
);

CREATE TABLE IF NOT EXISTS finance.cash_balances (
  org_id uuid NOT NULL REFERENCES finance.organizations(org_id),
  account_id uuid NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  amount numeric(28,10) NOT NULL,
  settled_amount numeric(28,10),
  accrued_interest numeric(28,10),
  as_of timestamptz NOT NULL,
  PRIMARY KEY (org_id, account_id, currency),
  FOREIGN KEY (account_id, org_id) REFERENCES finance.accounts(id, org_id)
);

CREATE TABLE IF NOT EXISTS finance.deposits (
  asset_id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES finance.organizations(org_id),
  account_id uuid NOT NULL,
  principal numeric(28,10) NOT NULL CHECK (principal >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  interest_at_maturity numeric(28,10),
  start_date date NOT NULL,
  maturity_date date NOT NULL,
  CHECK (maturity_date >= start_date),
  FOREIGN KEY (asset_id, org_id) REFERENCES finance.assets(id, org_id),
  FOREIGN KEY (account_id, org_id) REFERENCES finance.accounts(id, org_id)
);

CREATE TABLE IF NOT EXISTS finance.properties (
  asset_id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES finance.organizations(org_id),
  address_label text,
  FOREIGN KEY (asset_id, org_id) REFERENCES finance.assets(id, org_id)
);

CREATE TABLE IF NOT EXISTS finance.property_payments (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES finance.organizations(org_id),
  property_asset_id uuid NOT NULL,
  paid_on date NOT NULL,
  amount numeric(28,10) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  label text,
  FOREIGN KEY (property_asset_id, org_id) REFERENCES finance.assets(id, org_id)
);

CREATE TABLE IF NOT EXISTS finance.liabilities (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES finance.organizations(org_id),
  kind text NOT NULL CHECK (kind IN ('mortgage', 'loan', 'other')),
  label text,
  principal numeric(28,10) NOT NULL CHECK (principal >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  secured_asset_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  legacy_user_id uuid REFERENCES utarus.users(id),
  legacy_key text,
  UNIQUE (id, org_id),
  UNIQUE (org_id, legacy_user_id, legacy_key),
  FOREIGN KEY (secured_asset_id, org_id) REFERENCES finance.assets(id, org_id)
);

CREATE TABLE IF NOT EXISTS finance.cash_flows (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES finance.organizations(org_id),
  kind text NOT NULL CHECK (kind IN ('income', 'expense')),
  amount numeric(28,10) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  frequency text NOT NULL CHECK (frequency IN ('monthly', 'annual')),
  start_date date NOT NULL,
  end_date date,
  label text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  legacy_user_id uuid REFERENCES utarus.users(id),
  legacy_key text,
  UNIQUE (org_id, legacy_user_id, legacy_key),
  CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS finance.planning_profiles (
  org_id uuid NOT NULL REFERENCES finance.organizations(org_id),
  source_user_id uuid NOT NULL REFERENCES utarus.users(id),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  PRIMARY KEY (org_id, source_user_id)
);

CREATE TABLE IF NOT EXISTS finance.option_executions (
  org_id uuid NOT NULL REFERENCES finance.organizations(org_id),
  account_id uuid NOT NULL,
  execution_id text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  source_user_id uuid NOT NULL REFERENCES utarus.users(id),
  PRIMARY KEY (org_id, account_id, execution_id),
  FOREIGN KEY (account_id, org_id) REFERENCES finance.accounts(id, org_id)
);

CREATE TABLE IF NOT EXISTS finance.valuations (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES finance.organizations(org_id),
  asset_id uuid NOT NULL,
  amount numeric(28,10) NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  observed_at timestamptz NOT NULL,
  source text NOT NULL CHECK (length(trim(source)) > 0),
  FOREIGN KEY (asset_id, org_id) REFERENCES finance.assets(id, org_id)
);

CREATE TABLE IF NOT EXISTS finance.source_imports (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES finance.organizations(org_id),
  account_id uuid NOT NULL,
  connector_id text NOT NULL,
  source_hash text NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  source_ref text,
  observed_at timestamptz NOT NULL,
  applied_at timestamptz,
  status text NOT NULL CHECK (status IN ('pending', 'applied', 'rejected')),
  UNIQUE (id, org_id),
  UNIQUE (org_id, account_id, source_hash),
  FOREIGN KEY (account_id, org_id, connector_id) REFERENCES finance.accounts(id, org_id, connector_id)
);

CREATE TABLE IF NOT EXISTS finance.legacy_migrations (
  org_id uuid NOT NULL REFERENCES finance.organizations(org_id),
  source_user_id uuid NOT NULL REFERENCES utarus.users(id),
  source_revision bigint NOT NULL CHECK (source_revision > 0),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  counts jsonb NOT NULL CHECK (jsonb_typeof(counts) = 'object'),
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, source_user_id)
);

-- Exact, immutable archive of the former per-user books database. JSONB is
-- loaded from PostgreSQL text, so BIGINT and NUMERIC values never pass through
-- JavaScript numbers during migration.
CREATE TABLE IF NOT EXISTS finance.legacy_books_records (
  org_id uuid NOT NULL REFERENCES finance.organizations(org_id),
  source_household_id uuid NOT NULL REFERENCES utarus.users(id),
  record_type text NOT NULL CHECK (record_type IN ('households', 'accounts',
    'journal_entries', 'journal_lines', 'account_balances', 'deposit_meta',
    'position_meta', 'audit_events')),
  record_id uuid NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, record_type, record_id)
);

CREATE TABLE IF NOT EXISTS finance.legacy_books_imports (
  org_id uuid NOT NULL REFERENCES finance.organizations(org_id),
  source_household_id uuid NOT NULL REFERENCES utarus.users(id),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  counts jsonb NOT NULL CHECK (jsonb_typeof(counts) = 'object'),
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, source_household_id)
);

CREATE TABLE IF NOT EXISTS finance.change_events (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES finance.organizations(org_id),
  actor_user_id uuid NOT NULL REFERENCES utarus.users(id),
  source_revision bigint NOT NULL CHECK (source_revision > 0),
  previous_sha256 text NOT NULL CHECK (previous_sha256 ~ '^[0-9a-f]{64}$'),
  new_sha256 text NOT NULL CHECK (new_sha256 ~ '^[0-9a-f]{64}$'),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, actor_user_id, source_revision)
);

CREATE OR REPLACE FUNCTION finance.reject_legacy_books_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Imported books history is immutable';
END;
$$;
CREATE TRIGGER legacy_books_records_immutable BEFORE UPDATE OR DELETE
  ON finance.legacy_books_records FOR EACH ROW
  EXECUTE FUNCTION finance.reject_legacy_books_mutation();
CREATE TRIGGER legacy_books_imports_immutable BEFORE UPDATE OR DELETE
  ON finance.legacy_books_imports FOR EACH ROW
  EXECUTE FUNCTION finance.reject_legacy_books_mutation();

CREATE TABLE IF NOT EXISTS finance.journal_entries (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES finance.organizations(org_id),
  value_date date NOT NULL,
  entry_type text NOT NULL,
  request_id text NOT NULL,
  source_import_id uuid,
  actor_user_id uuid NOT NULL REFERENCES utarus.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  UNIQUE (org_id, request_id),
  FOREIGN KEY (source_import_id, org_id) REFERENCES finance.source_imports(id, org_id)
);

CREATE TABLE IF NOT EXISTS finance.journal_lines (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES finance.organizations(org_id),
  entry_id uuid NOT NULL,
  account_id uuid NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint NOT NULL,
  quantity numeric(28,10),
  FOREIGN KEY (entry_id, org_id) REFERENCES finance.journal_entries(id, org_id),
  FOREIGN KEY (account_id, org_id) REFERENCES finance.accounts(id, org_id),
  CHECK (amount_minor <> 0 OR quantity IS NOT NULL)
);

-- A transaction-local scope is set only after an application authorization
-- check. Without it, finance tables return no rows and reject writes.
ALTER TABLE finance.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.access_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.assets FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.account_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.account_credentials FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.positions FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.cash_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.cash_balances FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.deposits FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.properties FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.property_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.property_payments FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.liabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.liabilities FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.cash_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.cash_flows FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.planning_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.planning_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.option_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.option_executions FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.valuations ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.valuations FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.source_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.source_imports FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.legacy_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.legacy_migrations FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.legacy_books_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.legacy_books_records FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.legacy_books_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.legacy_books_imports FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.change_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.change_events FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.journal_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.journal_lines FORCE ROW LEVEL SECURITY;

DO $policy$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['organizations', 'access_grants', 'accounts',
    'assets', 'account_credentials', 'positions', 'cash_balances', 'deposits', 'properties', 'property_payments',
    'liabilities', 'cash_flows', 'planning_profiles', 'option_executions', 'valuations',
    'source_imports', 'legacy_migrations', 'legacy_books_records', 'legacy_books_imports',
    'change_events',
    'journal_entries', 'journal_lines']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS org_scope ON finance.%I', table_name);
    EXECUTE format('CREATE POLICY org_scope ON finance.%I FOR ALL USING (org_id::text = current_setting(''app.finance_org_id'', true)) WITH CHECK (org_id::text = current_setting(''app.finance_org_id'', true))', table_name);
  END LOOP;
END;
$policy$;

-- Grant only to the configured Utarus application role during deployment.
-- The schema deliberately does not create a role or hard-code credentials.
