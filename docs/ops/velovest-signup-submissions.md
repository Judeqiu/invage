# Signup review and account approval

The website saves contact details, the requested session and original payment
proof in `velovest_signup.submissions` in the existing Velovest application
PostgreSQL database. Pricing is computed server-side from `src/signup/catalog.ts`.
An identical retry is idempotent; different evidence cannot overwrite a reference.
Submission commits before the customer is redirected to the receipt page.
The receipt says that review is pending; it does not claim an email was sent.
Calendar selections are requests, not reservations. No synthetic booked slots or
assumed appointment-capacity rules are used.

## Management

Management → Signup submissions is consultant-only. Search has no result cutoff;
filters distinguish needs-review, approved and outstanding access email records.
The review dialog shows contact/package/payment details alongside the original
private evidence. Known raster images support zoom; PDFs render to canvas with the pinned framework PDF.js dependency, with page
navigation and open/download alternatives. PDF scripts and XFA are not executed;
original PDFs are sandboxed when opened directly. Every page remains accessible,
without a page-count cutoff. Signatures determine preview types, not the
uploaded MIME label. Unsupported files remain downloadable attachments. All
proof and review endpoints require administrator authentication and no-store.
Approval and email mutations also require same-origin JSON requests.

Review checks surface matching email, payment evidence hash and bank transaction
IDs, approved sessions at the proposed time, and past appointments. These are
review warnings, not automatic accusations or an assumed capacity limit. The
admin must acknowledge warnings, verify payment independently, and explicitly
confirm the session. A proposed date/time is reflected in the server-generated
email preview before final confirmation. Dates/times remain in Singapore time.

“Approve & send access email” (or “Approve & queue access email” before mail setup)
commits all of the following in one READ COMMITTED transaction:

- A new account and framework usage state, or an explicitly linked existing account.
- Approved status, reviewer identity, timestamp and confirmed onboarding session.
- A pending access email and an audit entry.

Row and email-identity locks prevent duplicate accounts under concurrent approval.
Creation uses the framework repositories and existing encrypted credential storage
on the same database transaction. This version supports the verified **local**
account mode; it fails explicitly if switched to shared account mode. Existing
accounts retain their identity, password, data and privileges. An inactive account
must be resolved before linking. No subscription expiry, package entitlement or
account limit is added or changed by approval.

## Access email and deferred setup

The transport uses the framework's existing transactional-mail adapter. Its current
implementation is Postmark. The sender/provider decision and credentials were
explicitly deferred by the owner; production mail is not yet configured. No
personal Gmail connection is used. Before enabling Postmark, configure the
verified service environment with:

```
UTARUS_MAIL_SEND_ENABLED=true
UTARUS_MAIL_PROVIDER=postmark
UTARUS_MAIL_API_TOKEN=<secret supplied through the server environment>
UTARUS_MAIL_TRANSACTIONAL_STREAM=<configured transactional stream>
UTARUS_MAIL_FROM_ADDRESS=<verified sender>
UTARUS_MAIL_REPLY_TO=<support address>
UTARUS_PUBLIC_BASE_URL=<verified HTTPS workspace origin>
```

These variables are validated by the framework when mail sending is enabled.
Another provider requires adapting `SignupMailer`, not inventing credentials or
silently using a personal mailbox. Once the service is configured and restarted,
open each queued signup and choose “Send queued email”. There is no automatic
bulk sending when configuration changes. Test the configured sender with an
explicitly authorized test recipient before claiming live delivery works.

The access email contains reference, submitted package/amount, confirmed session,
login URL and email. A new account gets a cryptographically random password;
normal login is allowed and the message recommends changing it. There is no
forced first-login change or new password expiry. An existing account receives
instructions to use its current password.

The new password is encrypted with the existing database secret codec and
submission-bound authenticated encryption while the email is pending. It never
appears in logs or admin API responses. Encryption keys must remain available
while queued messages exist. Upon provider acceptance, the pending secret is
removed; only the account's encrypted password hash and provider receipt remain.
If the customer has changed their password before sending/retrying, the message
uses existing-password instructions rather than mailing stale credentials.

Approval/account state is independent of email status:

| Email status | Meaning and next action |
| --- | --- |
| `not_queued` | Submission awaits approval. |
| `pending` | Approved and queued. Await sender setup or send manually. |
| `sending` | Attempt recorded. Refresh; if the process stopped, check the provider before an explicit retry. |
| `failed` | Provider explicitly rejected the attempt. Fix configuration and retry. |
| `unknown` | No confirmed receipt; the provider may have accepted it. Check the provider and acknowledge a possible duplicate before retrying. |
| `sent` | Provider accepted the message and returned its ID. This does not establish inbox delivery. |

Per-submission send locks prevent concurrent sends. Retrying does not recreate
accounts or reset passwords. A repeated send for a recorded accepted message is
a no-op. There is no general resend or automatic password reset action. All
attempts and decisions have an activity trail. Provider error bodies and passwords
are not logged or exposed to admins. Failure after approval may return an error;
refreshing the review reveals the committed approval and queued/attempt status.

## Migration and verification

Apply `scripts/migration/signup-submissions.sql` with an administrator and the
verified `application_role`. It is additive and rerunnable, preserving proof bytes
and existing submissions. The application role receives only the listed review
column updates plus audit INSERT/SELECT and sequence access; existing proof and
contact columns are not made editable. Framework account/usage writes reuse the
application's existing framework permissions. Production deployment must run this
migration before activating the new code. It can run while the old services stay
available. Backups must include the new audit table and encrypted pending secrets.

The website forwards intake to the fixed workspace API; the public router mounts
before workflow-wide authentication. Admin routes remain private under:
`/api/domain/invage/academy-signup/admin/submissions`.

Verification:

- `npm run build` and `cd website && npm test && npm run build`.
- `node node_modules/vitest/vitest.mjs run tests/signup-submissions.test.ts tests/signup-review.test.ts`.
- `node --import tsx tests/signup-review-ui.mjs` for the mocked Management browser flow, including multi-page PDF canvas rendering.
- `node --import tsx tests/signup-checkout-ui.mjs` after the website build for the customer journey with intercepted test intake (no production requests).

Database tests require `UTARUS_TEST_DATABASE_URL` naming the dedicated
`utarus_test_admin`. Their helper creates and drops disposable databases. Never
substitute an application database. The browser fixture and mail transport are
synthetic: these checks do not create production users or send customer emails.
