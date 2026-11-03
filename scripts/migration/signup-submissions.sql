-- Apply to the existing Velovest application database with an administrator.
-- psql -v ON_ERROR_STOP=1 -v application_role=<verified app role> -f scripts/migration/signup-submissions.sql
BEGIN;
\ir ../../src/signup/schema.sql
GRANT USAGE ON SCHEMA velovest_signup TO :"application_role";
GRANT SELECT, INSERT ON TABLE velovest_signup.submissions TO :"application_role";
GRANT UPDATE (reference, status, approved_at, approved_by, account_user_id, account_kind,
  confirmed_session_date, confirmed_session_time, email_status, email_attempt_id,
  email_attempted_at, email_accepted_at, email_message_id, email_error, access_secret)
  ON TABLE velovest_signup.submissions TO :"application_role";
GRANT SELECT, INSERT ON TABLE velovest_signup.review_events TO :"application_role";
GRANT USAGE, SELECT ON SEQUENCE velovest_signup.review_events_id_seq TO :"application_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE velovest_signup.disabled_dates TO :"application_role";
COMMIT;
