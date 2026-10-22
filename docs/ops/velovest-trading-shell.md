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
tracks progress and refreshes portfolio data after header sync completes. Both
dashboard versions omit the original page-level sync and refresh buttons. Both source
repositories must include the header-sync changes; deploy the committed framework
pin together with Invage, rather than copying only dashboard assets.


Wheel Desk incorporates the 21 October dashboard feedback and the Lovable reference.
The overview puts the two premium panels above account value and cash/obligation
cards, with broker artwork on the account selectors. Account selection remains
per channel; `brokerChannels` supplies identities for custom channel names. Section
headings and descriptions share a compact desktop row. The legacy dashboard keeps
its existing layout and probability model.

V2 risk filters cover broker, option right, contract search, and the probability
bands Act now (>60%), Caution (45–60%), and Comfortable (<45%). Missing estimates
appear only under All risks. All scored short contracts can be inspected; unscored
contracts remain in the radar when expiry is within seven days. Exposure cards
include contracts above 30% or expiring within seven days; weighted exposure stays
unavailable if any included contract lacks an estimate.

The user explicitly selected the feedback's probability model: solve IV from the
contract's broker mark with Black–Scholes, r=4%, q=0, and T=DTE/365, then use N(d2)
for calls and N(-d2) for puts. Missing underlying spot or unusable broker marks stay
unscored. Other portfolio pages retain the matched-quote model. The explanation
refers to an available spot rather than claiming no spot feed exists, because the
application already supplements broker snapshots with market quotes.

Both V2 tables use the requested column sequence. Last and Avg Px are per-share
prices; market values and P&L remain position totals. CST BSS (PREMIUM) is signed
position cost basis, explained in column help; recorded opening/roll cash flow is
not replaced or inferred from that basis. Contract labels open the existing AI
panel. Roll relationships, month collapse, history, timeline, and roll views remain
accessible. Desktop tables fit at 1366px and above with the test portfolio; smaller
screens scroll within each table, retaining sticky contract and header cells.

Validation includes the independent 4% model reference values, invalid-mark guards,
account metadata, broker/risk/search filters, AI discussion from both tables, desktop
first-viewport coverage, Section 03 visibility at page bottom, mobile overflow, and
legacy dashboard regressions. Broker artwork is copied from the supplied public
reference; the Webull mark is its embedded PNG.
