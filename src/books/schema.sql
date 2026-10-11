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

-- App role (created if missing). Superusers bypass RLS — production must use invage_app.
DO $role$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'invage_app') THEN
    CREATE ROLE invage_app LOGIN PASSWORD 'invage_dev_only';
  END IF;
END
$role$;
GRANT USAGE ON SCHEMA public TO invage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO invage_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO invage_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO invage_app;

