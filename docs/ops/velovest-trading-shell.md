# Velovest trading shell

The consultant product profile opts into Utarus's optional `webUi.shell` trading layout. Other Invage profiles keep the classic layout. The wordmark is the asset from the supplied Lovable reference, stored locally at `webui/velovest-wordmark.png`.

Primary navigation matches the reference: Dashboard, Positions, Trades, Insights, AI Chat and Brokers. Brokers opens the existing `/settings/brokers` page; old broker URLs retain their redirects. Other destinations, Management where permitted, notification badges, account identity and sign-out remain accessible through More. Workspace displays `Wheel · trader desk` as a product label; it is not an account switch.

Existing dashboard, Positions, Trades and Insights version switches, caching and API behavior remain independent of the shell. No database migration or configuration switch is required. The new shell requires the pinned Utarus commit in package.json and package-lock.json. Deploy the matching committed framework package through Agent Ops fast-deploy with `--force-utarus` (the package version remains 4.2.27 while the Git pin changes); never deploy only the Invage source against an older framework bundle.

Validation covers manifest compatibility and invalid configurations, six primary destinations, nested Settings active state, responsive overflow, keyboard and pointer dismissal, secondary navigation, badges and sign-out. Desktop and phone screenshots are checked against the reference.
