-- Version 2: encrypted, organization-owned broker source evidence.
CREATE TABLE finance.source_files (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES finance.organizations(org_id),
  source_user_id uuid NOT NULL REFERENCES utarus.users(id),
  account_id uuid,
  connector_id text NOT NULL CHECK (length(trim(connector_id)) > 0),
  source_kind text NOT NULL CHECK (source_kind IN ('broker-sync', 'broker-triage')),
  raw_id text NOT NULL CHECK (length(trim(raw_id)) > 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  byte_count bigint NOT NULL CHECK (byte_count >= 0),
  modified_at timestamptz NOT NULL,
  encrypted_content jsonb NOT NULL CHECK (jsonb_typeof(encrypted_content) = 'object'),
  archived_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, source_user_id, raw_id),
  FOREIGN KEY (account_id, org_id, connector_id)
    REFERENCES finance.accounts(id, org_id, connector_id)
);

CREATE INDEX source_files_org_account_idx ON finance.source_files(org_id, account_id);
ALTER TABLE finance.source_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.source_files FORCE ROW LEVEL SECURITY;
CREATE POLICY org_scope ON finance.source_files FOR ALL
  USING (org_id::text = current_setting('app.finance_org_id', true))
  WITH CHECK (org_id::text = current_setting('app.finance_org_id', true));

CREATE OR REPLACE FUNCTION finance.reject_source_file_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Broker source archive is immutable';
END;
$$;
CREATE TRIGGER source_files_immutable BEFORE UPDATE OR DELETE
  ON finance.source_files FOR EACH ROW
  EXECUTE FUNCTION finance.reject_source_file_mutation();
