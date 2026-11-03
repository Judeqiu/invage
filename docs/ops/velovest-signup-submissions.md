# Signup review and account approval

The website saves contact details, any requested session and original payment
proof in `velovest_signup.submissions` in the existing Velovest application
PostgreSQL database. Pricing is computed server-side from `src/signup/catalog.ts`.
An identical retry is idempotent; different evidence cannot overwrite a reference.
Submission commits before the customer is redirected to the receipt page.
The receipt says that review is pending; it does not claim an email was sent.
Calendar selections are requests, not reservations. All calendar dates, including
weekends, are eligible by default; managers can disable dates in Management →
Signup dates. Disabled dates are checked again on submission. No synthetic booked slots or
assumed appointment-capacity rules are used.

The S$228 yearly renewal is a Velovest system subscription only. It goes directly
from package selection to payment, with no booking step. New renewal submissions
store NULL session date/time; receipt, operator notification, approval and customer
access message have no appointment requirement. Other packages retain their
required onboarding date/time. Historical records are preserved. Apply the
rerunnable signup schema migration before activating this version: it removes
the session columns' NOT NULL requirement without deleting existing values.

## Management

Management → Signup submissions is consultant-only and hidden by default. Reuse
the application `.env` file to set `INVAGE_SHOW_SIGNUP_SUBMISSIONS=true` and
restart the app to show it; set it to `false` (or leave it unset) to hide it.
This setting controls only the Management entry: public signup intake, saved
submissions and administrator-protected review APIs remain unchanged.
Search has no result cutoff;
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
confirm the session for guided packages. Renewals require payment review but no
session confirmation or session-conflict checks. A proposed date/time is reflected in the server-generated
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

### Operator notification for new signups

Management → Config includes **Signup notification email** in the existing
portfolio configuration. Set one destination mailbox there; blank disables
notifications. Changes apply to the next signup without a restart, independently
of the Signup submissions page's visibility.

Newly inserted submissions attempt one SMTP notification after the record is
committed. The summary includes reference, customer contact details, package,
server-calculated submitted amount and, for guided packages, requested session in Singapore time.
The original payment-proof bytes are attached with the submitted filename and
content type, and are also retained in the private database. Renewals are labeled
as system subscriptions without a session. The summary
does not claim payment was verified. Identical retries retain the existing record
ID and do not send another notification.

The notification sender uses IONOS independently of customer access emails:

```dotenv
INVAGE_SIGNUP_SMTP_HOST=smtp.ionos.com
INVAGE_SIGNUP_SMTP_PORT=465
INVAGE_SIGNUP_SMTP_USER=support@lextok.com
INVAGE_SIGNUP_SMTP_FROM=support@lextok.com
INVAGE_SIGNUP_SMTP_PASSWORD=<mailbox password installed securely on the server>
```

IONOS documents TLS on port 465, or STARTTLS on port 587, with the full mailbox
address as username. Both modes require encryption and certificate verification.
See [IONOS SMTP settings](https://www.ionos.com/help/index.php?id=2490).
Keep the password in the service environment, never Management config or Git.
Restart the service after changing sender environment variables.

This is an immediate delivery attempt, not a durable mail queue: failure or a
process interruption can leave a saved signup without a notification. SMTP
failure logs a generic diagnostic without credentials or customer contents and
does not fail the customer submission. There is no automatic retry or historical
bulk send; check the saved signups independently when diagnosing mail failures.
SMTP acceptance establishes server acceptance, not inbox delivery. Live sending
must be verified separately after the credentials and recipient are configured.

### Customer access email

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

The access email contains reference, submitted package/amount, confirmed session for guided packages,
login URL and email. A new account gets a cryptographically random password;
normal login is allowed and the message recommends changing it. There is no
forced first-login change or new password expiry. An existing account receives
instructions to use its current password.

The new password is encrypted with the existing database secret codec and
submission-bound authenticated encryption for approved access-message sharing. It never
appears in logs or list responses. After approval, authenticated administrators
can view and copy the complete access message, including the generated temporary
password, in the private review detail. Copying does not send an email or change
email status. Closing the dialog clears the displayed message from the page.
Encryption keys must remain available for these records. Provider acceptance
retains the encrypted generated password so the approver
can still copy the access message for manual sharing. It is displayed only while
it matches the active account password and the account email still matches the
submission. The customer’s chosen replacement password is never displayed.
Older records whose generated password was already removed cannot recover it;
the UI explains this without resetting any password.
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
attempts and decisions have an activity trail. Provider error bodies are not
exposed to admins, and passwords are never logged.
Only the generated signup password may be shown in the approved private review,
under the owner-approved manual-sharing flow. Failure after approval may return an error;
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
