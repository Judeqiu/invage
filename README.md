# Invage (WalletStreet) — Portfolio Analyst Agent

Invage is a **domain agent** for investment portfolio analysis. It is built the same way as [Binary](https://github.com/Judeqiu/binary):

| Layer | Source |
|-------|--------|
| Framework (Telegram + Slack + CLI + **WebUI chat**, invite/admin, PostgreSQL user state, skills, firecrawl) | [`utarus`](https://github.com/Judeqiu/utarus) |
| BinDrive file portal + WebUI SPA | **Utarus** (`framework.startWebApp` / `bindrive_*`) |
| Domain (portfolio, Yahoo Finance, 3-axis analysis, reports, landing register) | **this repo** |

Channels (same agent process, shared PostgreSQL user/portfolio state):

| Channel | Pattern | Env |
|---------|---------|-----|
| **Telegram** | like Binary | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_IDS` |
| **Slack** | like Marie (Socket Mode via Utarus) | `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_ADMIN_IDS` |
| **WebUI** | Utarus chat SPA | `WEBAPP_PORT` |
| **Public onboard** | landing → Slack bind | `investor.lextok.com` + `INVAGE_*` env (see landing/) |

```
invage (domain)  ──depends on──►  utarus (framework + BinDrive + WebUI)
     │
     ├── createFramework({ extension: invageExtension })
     ├── startTelegram() + startSlack()
     ├── startWebApp({ extraRouters: [landing register] })  # when WEBAPP_PORT set
     ├── src/tools/*          portfolio / analyzer / report / snapshot
     ├── src/market/*         Yahoo Finance + 3-axis engine
     └── src/onboard/*        landing register + Slack /bind handshake
```

Pinned framework release:

```json
"utarus": "github:Judeqiu/utarus#v4.0.0-beta.13"
```
---

## Prerequisites

- Node.js 22.13+ and PostgreSQL 18
- DeepSeek API key
- Optional: Telegram bot token, `gws` CLI for email reports

## Install

```bash
git clone https://github.com/Judeqiu/invage.git
cd invage
npm install
cp .env.example .env
```

Edit `.env`:

```env
DEEPSEEK_API_KEY=sk-...
UTARUS_AGENT_NAME=Wallet Street
UTARUS_LOADED_BY_HOST=1
# Prefer ABSOLUTE path (relative ./data lands under node_modules/utarus)
UTARUS_DATA_ROOT=/absolute/path/to/invage/data

# Telegram (optional)
TELEGRAM_BOT_TOKEN=
TELEGRAM_ADMIN_IDS=

# Slack Socket Mode (optional — same as Marie credentials shape)
SLACK_BOT_TOKEN=
SLACK_APP_TOKEN=
SLACK_SIGNING_SECRET=
SLACK_ADMIN_IDS=

WEBAPP_PORT=3001
WEBAPP_ADMIN_CREDENTIALS={"admin":"change-me"}
UTARUS_REPORTS_URL=http://localhost:3001
```

## Database lifecycle (v4 personal mode)

Set every `UTARUS_DATABASE_*` value in `.env.example`, including a dedicated
32-byte encryption key. Keep the same key available for restoration. Initialize
an empty database with `node --env-file=.env node_modules/utarus/dist/database/cli.js initialize personal`,
then run the same command with `check personal` before starting either service.
For existing users, initialization alone is **not a migration**.

User credentials, profiles, portfolios, cash, deposits, playbooks and logs live
in one revisioned SQL aggregate. Mutations use `loadInvestor` / `saveInvestor`;
stale revisions fail. Reports, drive files, chat/session history and knowledge
remain under `UTARUS_DATA_ROOT`. Old YAML is recovery material, not a writable
v4 user store. Both processes bind an explicit personal-mode database runtime
and drain work before closing it.

The beta.42 migration runbook is [here](docs/plans/2026-09-15-v4-migration.md).
It preserves personal accounts and requires full-state reconciliation plus a
restorable code/files/database/key backup. Optional `INVAGE_BOOKS_DATABASE_URL`
must remain unset for this migration: cross-database journal/user writes are
not a single transaction.

Database tests require an isolated `UTARUS_TEST_DATABASE_URL` naming
`utarus_test_admin`; the test role creates and drops uniquely named test databases.
Run `npm test` plus `UTARUS_LOADED_BY_HOST=1 node --test tests/migration/*.test.mjs`.

## Run

```bash
# Agent: CLI + any configured chat interfaces
npm run dev

# Web-only production (Velovest): HTTP + scheduler, no CLI
WEB_ONLY=true WEBAPP_PORT=3030 npm run dev

# Production: configured bots, no CLI
BOT_ONLY=true npm run dev

# Telegram only / Slack only
TELEGRAM_ONLY=true npm run dev
SLACK_ONLY=true npm run dev

# BinDrive portal — separate process (same as Binary systemd bindrive unit)
npm run webapp
```

---

## Slack app from manifest

Ready-made manifests (Socket Mode + slash commands matching Utarus):

| File | Format |
|------|--------|
| [`slack-app-manifest.yaml`](slack-app-manifest.yaml) | YAML (recommended in Slack UI) |
| [`slack-app-manifest.json`](slack-app-manifest.json) | JSON |

**Create the app in ~1 minute:**

1. Open [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From an app manifest**
2. Choose workspace → paste **`slack-app-manifest.yaml`** → Create
3. Still required manually (Slack does not put these in the manifest):
   - **App-Level Token** (`connections:write`) → `SLACK_APP_TOKEN` (`xapp-...`)
   - **Install to Workspace** → `SLACK_BOT_TOKEN` (`xoxb-...`)
   - **Signing Secret** → `SLACK_SIGNING_SECRET`
   - Your **member ID** → `SLACK_ADMIN_IDS`
4. Put them in `.env` (or `/opt/invage/.env` on lextok03) and start the agent:

```bash
ssh lextok03 'systemctl enable invage && systemctl restart invage && journalctl -u invage --no-pager -n 20'
```

Slash command `url` fields in the manifest are placeholders; Socket Mode delivers commands over the websocket.

---

## Architecture (parity with Binary)

```
src/
  index.ts              # dotenv → createFramework → Telegram + Slack + CLI
  extension.ts          # DomainExtension (purpose, tools, skills, enrichMessage)
  skills.ts             # registerDomainSkill for investment-analysis + bindrive
  admin-bootstrap.ts    # validate migrated admin identities
  webapp/server.ts      # re-export startBinDrive from utarus
  state/portfolio-state.ts   # portfolio domain model; investor-store.ts persists revisions
  market/               # Yahoo Finance + analyzer
  tools/                # domain tools (telegram_user_id OR slack_user_id)
  report/               # HTML report template
```

**Not forked here** (live in Utarus): agent pool, config, Telegram/Slack/CLI, invite tools, user-state tools, BinDrive routes/auth, skill-tool, firecrawl, write_report.

---

## Domain tools

| Tool | Role |
|------|------|
| `add_holding` / `update_holding` / `remove_holding` / `get_portfolio` / `clear_portfolio` | Portfolio CRUD (equities + options call/put) in the revisioned PostgreSQL user aggregate |
| `portfolio_analyzer` | 3-axis analysis + market summary |
| `save_report` | HTML report → BinDrive + signed URL (`kind=analysis` default, or `kind=dashboard` for value-change dashboard) |
| `save_snapshot` / `list_snapshots` | Dated P/L JSON snapshots (feed dashboard history) |
| WebUI **Dashboard** tab | Live portfolio dashboard (`DomainExtension.webUi`) — allocation donut, invested-vs-current bars, fund index vs SPY benchmark over snapshot history, archive-date views in the chat shell |
| `send_report` | Email via `gws` Gmail CLI |

Framework also provides: `get_user`, invite/admin codes, `bindrive_*`, `use_skill`, etc.

---

## Data model

Users: `data/users/<slug>.yaml` (Utarus shape + optional `portfolio:` map).

BinDrive: `data/drive/<slug>/` (served by Utarus BinDrive; login with `user.auth_token`).

See [docs/data-model.md](docs/data-model.md).

---

## Tests

```bash
npm test
npm run build
```
