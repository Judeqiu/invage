CREATE SCHEMA IF NOT EXISTS velovest_management;
REVOKE ALL ON SCHEMA velovest_management FROM PUBLIC;
CREATE TABLE IF NOT EXISTS velovest_management.role_assignments (
  user_id uuid PRIMARY KEY REFERENCES utarus.users(id),
  role text NOT NULL CHECK (role = 'velovest_manager'),
  granted_by text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS velovest_management.role_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES utarus.users(id),
  role text NOT NULL CHECK (role = 'velovest_manager'),
  enabled boolean NOT NULL,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE velovest_management.role_assignments, velovest_management.role_events FROM PUBLIC;
