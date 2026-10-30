# Signup submissions

The Academy checkout saves to `velovest_signup.submissions` in the existing
Velovest application PostgreSQL database. Package definitions are shared in
`src/signup/catalog.ts`; the server computes the SGD amount and preserves the
package name and amount at submission time. Payment proof bytes, original
filename, content type and SHA-256 are saved in the same transaction as the
contact details, requested session, consent and server submission time.

Apply `scripts/migration/signup-submissions.sql` to the verified application
database as an administrator, passing `application_role` for the existing
application login. This is an additive schema migration and can run while the
previous application remains available. The application needs schema USAGE,
SELECT/INSERT on the table and UPDATE on reference for idempotent retries.
No existing portfolio or framework tables change.

`POST https://velovest.lextok.com/api/signup/submissions` forwards JSON to the
fixed workspace endpoint `/api/domain/invage/academy-signup/submissions`.
The public intake mounts in `buildInvageApp` before the framework, because
dynamic workflows otherwise install an authenticated `/api` handler ahead of
domain routes. Management queries remain on the admin-authenticated domain
router. It returns a reference only after PostgreSQL commits. Retrying identical data
with the same reference does not create a duplicate; different data with an
existing reference returns 409 without overwriting the original. A save
failure leaves the checkout open and displays an error.

Management → Signup submissions is enabled only for the consultant profile.
The admin API is `/api/domain/invage/academy-signup/admin/submissions?q=...`.
The table searches submitted text and returns all matches without a result
cutoff. Listing excludes payment proof bytes. Proofs are downloaded through
`/api/domain/invage/academy-signup/admin/submissions/:id/proof`; both endpoints
require real administrator authentication and use no-store responses. Proofs
are attachments with nosniff, never public static files. No status-changing
or deletion endpoint is provided.

The stored status is `submitted`. Saving does not reserve a slot, verify a
payment, send email, or create a user account. The existing sample PayNow QR,
simulated availability and confirmation-page wording remain unchanged at the
owner's explicit request. The checkout notice now discloses that submitted
payment proofs are stored privately, as separately approved. The existing browser proof selection rule is
unchanged. Application-database backups include the new table and proof bytes.

Verification uses `tests/signup-submissions.test.ts` and the disposable database
helper. Set `UTARUS_TEST_DATABASE_URL` to a dedicated `utarus_test_admin` database;
never substitute the live application database. The suite checks server pricing,
proof persistence, idempotency, validation, admin search and anonymous/user
rejection for both list and download APIs.
