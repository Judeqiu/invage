# Velovest manager role

`velovest_manager` is a restricted Velovest role, separate from `user.admin`.
Only the consultant profile registers these APIs and the selected-user control.
It grants no framework admin tools, cap bypass, billing changes or access to
other administrative sections.

Full administrators assign or revoke it in **Admin → Users → select a user →
Velovest manager** in the selected user's side panel. There is no separate
assignment tab. Only active non-admin accounts can receive this role. Existing
full administrators retain their normal console and cannot receive this role.
No accounts are assigned automatically.

Managers see a Management destination with exactly two tabs:

- **Users:** read-only subscriber account/contact, reference, recorded
  subscription and credit-usage summaries. All non-admin active accounts are
  included, including accounts without a recorded billing subscription. Admins
  are excluded on the server from list/search and direct-ID detail requests.
  No credentials, arbitrary profile fields, private logs, broker information or
  account mutation controls are returned. Billing records are displayed as
  recorded; this view does not recompute entitlement or reset usage.
- **Access:** list and issue normal signup invite codes and copy signup links.
  Admin elevation codes and organization-role invites are not exposed. The
  creation endpoint accepts only an optional comment; callers cannot supply
  roles, organization IDs, custom codes or administrator flags.

Assignments live in `velovest_management.role_assignments` in the existing
application database, independently of user-editable profiles and portfolio
state. Changes are transactionally audited in `role_events`. Role lookup checks
the current account and grant on every API request; revocation applies to
existing sessions immediately. Refresh the workspace to update navigation.
All responses are private/no-store. Mutations require same-origin JSON.

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
