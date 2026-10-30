-- Apply to the existing Velovest application database with an administrator.
-- psql -v ON_ERROR_STOP=1 -v application_role=<verified app role> -f scripts/migration/signup-submissions.sql
BEGIN;
\ir ../../src/signup/schema.sql
GRANT USAGE ON SCHEMA velovest_signup TO :"application_role";
GRANT SELECT, INSERT ON TABLE velovest_signup.submissions TO :"application_role";
GRANT UPDATE (reference) ON TABLE velovest_signup.submissions TO :"application_role";
COMMIT;
