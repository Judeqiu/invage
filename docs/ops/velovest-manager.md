# Velovest manager role

`velovest_manager` is a restricted Velovest role, separate from `user.admin`.
Only the consultant profile registers these APIs and the selected-user control.
Managers have unlimited AI credits while the role is active. Usage is still
recorded, and the normal credit limit applies again when the role is revoked.
The role grants no framework admin tools, billing changes or access to other
administrative sections.

Full administrators assign or revoke it in **Admin → Users → select a user →
Velovest manager** in the selected user's side panel. There is no separate
assignment tab. Only active non-admin accounts can receive this role. Existing
full administrators retain their normal console and cannot receive this role.
No accounts are assigned automatically.

Managers see a Management destination with three tabs:

- **Users:** read-only subscriber account/contact, reference, recorded
  subscription and credit-usage summaries. All non-admin active accounts are
  included, including accounts without a recorded billing subscription. Admins
  are excluded on the server from list/search and direct-ID detail requests.
  No credentials, arbitrary profile fields, private logs, broker information or
  account mutation controls are returned. Billing records are displayed as
  recorded; this view does not recompute entitlement or reset usage.
- **Access:** list and issue normal signup invite codes and copy signup links.
  Admin elevation codes and organization-role invites are not exposed. The
  creation endpoint accepts only an optional comment and account email; callers
  cannot supply roles, organization IDs, custom codes or administrator flags.
- **Signup dates:** a month calendar and disabled-date list. Click a date to
  disable or re-enable it; all dates, including weekends, start enabled.

Assignments live in `velovest_management.role_assignments` in the existing
application database, independently of user-editable profiles and portfolio
state. Changes are transactionally audited in `role_events`. Role lookup checks
the current account and grant on every API request; revocation applies to
existing sessions immediately. Refresh the workspace to update navigation.
All responses are private/no-store. Mutations require same-origin JSON.

The credit exemption uses a live manager-role lookup at the shared effective-cap
resolver, covering chat, tools and mid-turn enforcement. It does not change the
user's administrator flag or billing subscription. The current framework pin is
retained; `scripts/patch-utarus-credit-exemption.mjs` backports the framework hook
at install/build time, including its runtime and TypeScript declarations. Remove
the backport after upgrading to a pin that includes Utarus commit `d3cbab0ee`.

## Upgrade

The dependency pin includes the generic Utarus `webUi.managementUserSections`
extension point. Each selected-user iframe receives a `userId` query parameter;
this is only a selected resource ID, never an authentication identity or grant.
The role API independently requires a full administrator. Framework changes
after v4.2.47 are pin-only for this host; optional MCP/SSO features remain off
unless separately configured. Read the intervening framework release notes.

Before activating this code, apply the additive, rerunnable migration as a
database administrator, with the verified application role:

```sh
psql -v ON_ERROR_STOP=1 -v application_role=<verified role> \
  -f scripts/migration/management-roles.sql <verified application database>
```

Prepare the committed dependency locally and deploy through the canonical
agent-ops script with both Velovest units and `--force-utarus`. Existing account
data, admin flags, subscriptions, credentials and mail configuration are not
changed. Do not deploy other sites or alter any live account assignment without
an explicit request.

Validation: `npm run build`; focused `management-api` and `management-roles`
tests; `node --import tsx tests/management-ui.mjs` renders the real built framework
drawer and the manager workspace with synthetic API responses. PostgreSQL tests
use disposable databases under `utarus_test_admin`, never an application DB.

Managers can optionally enter an Account email when creating an invite. It is
stored on the invitation and becomes the new account's login/contact email on
redemption. Leaving it blank preserves generated addresses. This does not send
an email or verify ownership. An address already in use cannot create a second
account; a failed redemption leaves the invitation unused.

The pinned framework includes schema migration 35 (`invitation_recipient_email`),
which adds a nullable `utarus.invites.recipient_email` column. Run the framework
migration step with the database owner before starting the updated application.
Existing invitation rows retain null and continue to generate addresses.

## Signup dates

Managers use **Management → Signup dates** to disable or re-enable individual
calendar dates. All dates are enabled by default, including weekends. An absent
row means enabled. Overrides persist in `velovest_signup.disabled_dates` in the
existing application database, with the last actor and timestamp. No extra
file or database is required. Reapply `scripts/migration/signup-submissions.sql`
as the database administrator before starting the updated code.

The public date-availability API exposes only disabled dates. Signup displays
calendar dates in Singapore time, with earlier/later navigation and no future
horizon cutoff. Disabled choices are unavailable, and a newly disabled date is
rejected by the submission API even if the form was already open. Date toggles
and intake serialize per date in PostgreSQL. Existing submissions and identical
retries are preserved. Renewal remains independent of onboarding dates.

## Manager interaction behavior

The workspace follows the admin console's neutral styling, compact tabs, tables
and subscriber side drawer. Tab content, search and scroll positions stay in
memory within the open page. Returning to a tab revalidates its data without
clearing the current view. Nothing is cached in browser storage; role checks
remain live on every API request. A denied request clears the private view.

Date changes appear immediately with an explicit Saving state. The date itself
cannot be submitted twice while pending; other dates can still be changed.
Confirmation uses the PATCH response, avoiding a second list request. On failure,
the previous display is restored and the error asks the manager to refresh to
confirm actual persistence before retrying. A refresh response started before a
mutation cannot overwrite the new state. Concurrent save failures stay visible
until reconciled or retried. Calendar arrows support day/week keyboard movement;
month navigation has no date horizon cutoff. Weekends remain eligible by default.

Subscriber details open immediately from the existing list data and revalidate
in the background. The modal drawer supports Escape, focus containment and focus
restoration. Invite creation adds its returned record and signup link without
waiting for another list request; a stale list response cannot remove the new
invite. Server authorization, account permissions and eligibility rules are
unchanged. This UI refinement requires no new migration or framework pin.

The browser regression exercises the real framework shell with synthetic users
and controlled latency/failure responses. Its timings establish client behavior
under that simulated delay, not production server or database latency.
