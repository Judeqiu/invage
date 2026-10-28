-- Invage financial books of record (journal-first).
-- Apply via migrate.ts. Fail closed: no silent defaults in app code.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS households (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id),
  kind text NOT NULL CHECK (
    kind IN (
      'cash',
      'deposit',
      'position',
      'property',
      'liability',
      'income',
      'expense',
      'equity',
      'clearing'
    )
  ),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3,4}$'),
  -- empty string = unassigned channel (never NULL — unique key needs concrete value)
  channel text NOT NULL DEFAULT '',
  -- lot key / deposit id / system key (e.g. 'import', lot 'AAPL@ibkr')
  external_key text NOT NULL DEFAULT '',
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, kind, currency, channel, external_key)
);

CREATE INDEX IF NOT EXISTS accounts_household_idx ON accounts (household_id);

CREATE TABLE IF NOT EXISTS journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id),
  booked_at timestamptz NOT NULL DEFAULT now(),
  value_date date NOT NULL,
  entry_type text NOT NULL,
  external_ref text,
  reverses_entry_id uuid REFERENCES journal_entries(id),
  memo text,
  created_by text NOT NULL,
  tool_name text,
  request_id text NOT NULL,
  UNIQUE (household_id, request_id)
);

CREATE INDEX IF NOT EXISTS journal_entries_household_value_date_idx
  ON journal_entries (household_id, value_date);

CREATE TABLE IF NOT EXISTS journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES journal_entries(id),
  household_id uuid NOT NULL REFERENCES households(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  -- Signed balance change in minor units (scale 6). Sum per currency within entry must be 0.
  amount_minor bigint NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3,4}$'),
  quantity numeric(28, 10),
  unit_cost_minor bigint,
  CHECK (amount_minor <> 0 OR quantity IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS journal_lines_entry_idx ON journal_lines (entry_id);
CREATE INDEX IF NOT EXISTS journal_lines_account_idx ON journal_lines (account_id);
CREATE INDEX IF NOT EXISTS journal_lines_household_idx ON journal_lines (household_id);

CREATE TABLE IF NOT EXISTS account_balances (
  account_id uuid PRIMARY KEY REFERENCES accounts(id),
  household_id uuid NOT NULL REFERENCES households(id),
  balance_minor bigint NOT NULL DEFAULT 0,
  quantity numeric(28, 10) NOT NULL DEFAULT 0,
  -- Weighted-average cost per unit in minor units (positions); 0 when quantity is 0
  avg_cost_minor bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_balances_household_idx ON account_balances (household_id);

CREATE TABLE IF NOT EXISTS deposit_meta (
  account_id uuid PRIMARY KEY REFERENCES accounts(id),
  household_id uuid NOT NULL REFERENCES households(id),
  interest_minor bigint NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  label text,
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS position_meta (
  account_id uuid PRIMARY KEY REFERENCES accounts(id),
  household_id uuid NOT NULL REFERENCES households(id),
  instrument text NOT NULL CHECK (instrument IN ('equity', 'fund', 'option')),
  category text,
  option_json jsonb,
  fund_json jsonb
);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id),
  journal_entry_id uuid REFERENCES journal_entries(id),
  actor text NOT NULL,
  tool_name text,
  request_id text,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_events_household_idx ON audit_events (household_id, created_at);

-- Append-only journal: block UPDATE/DELETE
CREATE OR REPLACE FUNCTION books_reject_journal_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'journal tables are append-only (no UPDATE/DELETE)';
END;
$$;

DROP TRIGGER IF EXISTS journal_entries_no_update ON journal_entries;
CREATE TRIGGER journal_entries_no_update
  BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION books_reject_journal_mutation();

DROP TRIGGER IF EXISTS journal_lines_no_update ON journal_lines;
CREATE TRIGGER journal_lines_no_update
  BEFORE UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION books_reject_journal_mutation();

-- RLS (FORCE so table owner / migrator role still cannot skip tenant filter)
ALTER TABLE households ENABLE ROW LEVEL SECURITY;
ALTER TABLE households FORCE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE account_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_balances FORCE ROW LEVEL SECURITY;
ALTER TABLE deposit_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE deposit_meta FORCE ROW LEVEL SECURITY;
ALTER TABLE position_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE position_meta FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;

-- Force RLS even for table owner when using invage_app role; migrations run as superuser.
DROP POLICY IF EXISTS households_tenant ON households;
CREATE POLICY households_tenant ON households
  FOR ALL
  USING (id::text = current_setting('app.household_id', true))
  WITH CHECK (id::text = current_setting('app.household_id', true));

DROP POLICY IF EXISTS accounts_tenant ON accounts;
CREATE POLICY accounts_tenant ON accounts
  FOR ALL
  USING (household_id::text = current_setting('app.household_id', true))
  WITH CHECK (household_id::text = current_setting('app.household_id', true));

DROP POLICY IF EXISTS journal_entries_tenant ON journal_entries;
CREATE POLICY journal_entries_tenant ON journal_entries
  FOR ALL
  USING (household_id::text = current_setting('app.household_id', true))
  WITH CHECK (household_id::text = current_setting('app.household_id', true));

DROP POLICY IF EXISTS journal_lines_tenant ON journal_lines;
CREATE POLICY journal_lines_tenant ON journal_lines
  FOR ALL
  USING (household_id::text = current_setting('app.household_id', true))
  WITH CHECK (household_id::text = current_setting('app.household_id', true));

DROP POLICY IF EXISTS account_balances_tenant ON account_balances;
CREATE POLICY account_balances_tenant ON account_balances
  FOR ALL
  USING (household_id::text = current_setting('app.household_id', true))
  WITH CHECK (household_id::text = current_setting('app.household_id', true));

DROP POLICY IF EXISTS deposit_meta_tenant ON deposit_meta;
CREATE POLICY deposit_meta_tenant ON deposit_meta
  FOR ALL
  USING (household_id::text = current_setting('app.household_id', true))
  WITH CHECK (household_id::text = current_setting('app.household_id', true));

DROP POLICY IF EXISTS position_meta_tenant ON position_meta;
CREATE POLICY position_meta_tenant ON position_meta
  FOR ALL
  USING (household_id::text = current_setting('app.household_id', true))
  WITH CHECK (household_id::text = current_setting('app.household_id', true));

DROP POLICY IF EXISTS audit_events_tenant ON audit_events;
CREATE POLICY audit_events_tenant ON audit_events
  FOR ALL
  USING (household_id::text = current_setting('app.household_id', true))
  WITH CHECK (household_id::text = current_setting('app.household_id', true));

-- Run migrations as the dedicated owner of this books database. Provision its
-- login and SCRAM credential outside this schema; never create a shared role
-- with a built-in password from application migration SQL.

-- Lossless broker evidence. Observations are separate from financial postings:
-- repeated reports and different versions of a broker row must never be summed.
CREATE TABLE IF NOT EXISTS broker_source_documents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id),
  broker_id text NOT NULL CHECK (broker_id <> ''),
  channel text NOT NULL CHECK (channel <> ''),
  account_id text NOT NULL CHECK (account_id <> ''),
  sha256 text NOT NULL CHECK (sha256 = encode(digest(body, 'sha256'), 'hex')),
  extractor_version integer NOT NULL CHECK (extractor_version > 0),
  kind text NOT NULL CHECK (kind IN ('xml','json','text')),
  body bytea NOT NULL,
  status text NOT NULL CHECK (status IN ('indexed','unverified','account_mismatch','unparsed')),
  gaps jsonb NOT NULL CHECK (jsonb_typeof(gaps) = 'array'),
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id,id),
  UNIQUE (household_id,broker_id,channel,account_id,sha256,extractor_version)
);
CREATE TABLE IF NOT EXISTS broker_source_records (
  household_id uuid NOT NULL,
  document_id uuid NOT NULL,
  path text NOT NULL,
  parent_path text,
  source_id text,
  category text NOT NULL CHECK (category IN ('execution','order','lifecycle','cash_activity','position','cash_snapshot','fee','other')),
  instrument text,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  PRIMARY KEY (household_id,document_id,path),
  FOREIGN KEY (household_id,document_id) REFERENCES broker_source_documents(household_id,id)
);
CREATE INDEX IF NOT EXISTS broker_source_records_lookup ON broker_source_records(household_id,category,source_id);
CREATE TABLE IF NOT EXISTS broker_source_receipts (
  household_id uuid NOT NULL,
  document_id uuid NOT NULL,
  source_ref text NOT NULL CHECK (source_ref <> ''),
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id,document_id,source_ref),
  FOREIGN KEY (household_id,document_id) REFERENCES broker_source_documents(household_id,id)
);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['broker_source_documents','broker_source_records','broker_source_receipts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname=current_schema() AND tablename=t AND policyname=t||'_tenant') THEN
      EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (household_id::text = current_setting(''app.household_id'',true)) WITH CHECK (household_id::text = current_setting(''app.household_id'',true))',t||'_tenant',t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=t::regclass AND tgname=t||'_immutable') THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION books_reject_journal_mutation()',t||'_immutable',t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=t::regclass AND tgname=t||'_no_truncate') THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION books_reject_journal_mutation()',t||'_no_truncate',t);
    END IF;
  END LOOP;
END $$;
