# Invester Onboard — Landing Page

Static page that captures a display name and email, mints a `BIND-` token via
the InvesterDrive API, and directs the investor into the Slack workspace to
finish registration with the `/bind` command.

Deployed to Netlify as **investor.lextok.com**. No build step.

## Flow

1. Visitor submits display name + email.
2. `POST /api/onboard/register` → BIND token (proxied to lextok03:3001).
3. Page shows Slack workspace invite link + `/bind BIND-XXXXXXXX`.
4. User joins Slack, DMs **Invester**, sends `/bind …`.
5. Agent creates user YAML + empty portfolio (no INV- code needed).

## Deploy to Netlify

1. Push this repo to GitHub.
2. In Netlify: **Add new site → Import an existing project** → pick this repo.
3. Configure:
   - **Base directory:** `landing/`
   - **Build command:** (leave empty)
   - **Publish directory:** `landing/` (or `.` if Base is already `landing/`)
4. Domain: **investor.lextok.com** (DNS CNAME/A to Netlify).
5. Confirm `netlify.toml` `/api/*` proxy points at InvesterDrive
   (`http://91.98.74.94:3001/api/:splat`).

## Local dev

```bash
npm install -g netlify-cli
cd landing
netlify dev
```

Also run InvesterDrive with onboard env vars:

```bash
# from repo root
INVAGE_PUBLIC_LANDING_URL=http://localhost:8888 \
INVAGE_ONBOARD_TOKEN_TTL_MIN=15 \
INVAGE_SLACK_WORKSPACE_INVITE_URL=https://join.slack.com/t/... \
npm run webapp
```

## Required server env (lextok03 `/opt/invage/.env`)

```env
INVAGE_PUBLIC_LANDING_URL=https://investor.lextok.com
INVAGE_ONBOARD_TOKEN_TTL_MIN=15
INVAGE_SLACK_WORKSPACE_INVITE_URL=https://join.slack.com/t/<workspace>/shared_invite/...
```

## Slack app

Add slash commands `/bind` and `/onboard` (see `slack-app-manifest.yaml`), then
reinstall the app to the workspace so Socket Mode picks them up.
