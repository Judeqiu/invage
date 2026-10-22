# Velovest trading shell

The consultant product profile opts into Utarus's optional `webUi.shell` trading layout. Other Invage profiles keep the classic layout. The wordmark is the asset from the supplied Lovable reference, stored locally at `webui/velovest-wordmark.png`.

Primary navigation matches the reference: Dashboard, Positions, Trades, Insights, AI Chat and Brokers. Brokers opens the existing `/settings/brokers` page; old broker URLs retain their redirects. Other destinations, Management where permitted, notification badges, account identity and sign-out remain accessible through More. Workspace displays `Wheel · trader desk` as a product label; it is not an account switch.

Existing dashboard, Positions, Trades and Insights version switches, caching and API behavior remain independent of the shell. No database migration or configuration switch is required. The shell requires the committed Utarus pin in package.json and package-lock.json, including optional header sync support. Deploy the matching committed framework package through Agent Ops fast-deploy with `--force-utarus`; never deploy only the Invage source against an older framework bundle. The framework keeps the classic appearance for every agent that omits `webUi.shell`.

Validation covers manifest compatibility and invalid configurations, six primary destinations, nested Settings active state, responsive overflow, keyboard and pointer dismissal, secondary navigation, badges and sign-out. Desktop and phone screenshots are checked against the reference.

Deployment target: `victorconsultant` on `lextokprod02`, `/opt/victorconsultant`, both `victorconsultant` and `victorconsultant-drive` services. Verify the previous committed source mirror, prepare a clean committed archive with mode 0755, and leave both services available during staging. Start all replacement services immediately at cutover, then verify source/framework hashes, database readiness, authenticated shell navigation, public assets and both login endpoints. Capture the live deployment backup after startup, verify its encrypted off-server copy, preserve option-ID migration evidence, then rotate the prior complete deployment backup.

Utarus v4.2.29 also places the mobile feedback button below the complete trading header. Verify their bounding boxes do not overlap after rollout; the classic header keeps its original feedback position.


The consultant header includes a Sync brokers control beside More. Its authenticated
`/api/domain/invage/broker-sync/status` endpoint returns per-account timestamps from
`last_sync.at` (the actual sync attempt, rather than the statement's `as_of` date),
with synced, failed, paused, queued and never-synced states. The hover/focus panel
shows each broker and account; on phones it opens below the complete navigation.
The action reuses the dashboard's deduplicated background sync. The dashboard
hides its local sync button only after the shell announces the replacement and
continues to track progress and refresh portfolio data after completion. Other
profiles and standalone dashboards retain their local sync button. Both source
repositories must include the header-sync changes; deploy the committed framework
pin together with Invage, rather than copying only dashboard assets.
