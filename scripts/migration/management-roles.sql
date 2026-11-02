-- Apply to the Velovest application database with the verified application role.
BEGIN;
\ir ../../src/management/schema.sql
GRANT USAGE ON SCHEMA velovest_management TO :"application_role";
GRANT SELECT, INSERT, DELETE ON velovest_management.role_assignments TO :"application_role";
GRANT INSERT ON velovest_management.role_events TO :"application_role";
GRANT USAGE, SELECT ON SEQUENCE velovest_management.role_events_id_seq TO :"application_role";
COMMIT;
