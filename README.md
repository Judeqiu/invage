# Invage (Invester) — Portfolio Analyst Agent

Invage is a **domain agent** for investment portfolio analysis. It is built the same way as [Binary](https://github.com/Judeqiu/binary):

| Layer | Source |
|-------|--------|
| Framework (Telegram + Slack + CLI, invite/admin, user YAML, skills, firecrawl) | [`utarus`](https://github.com/Judeqiu/utarus) |
| BinDrive file portal | **Utarus** (`startBinDrive` / `bindrive_*` tools) |
| Domain (portfolio, Yahoo Finance, 3-axis analysis, reports) | **this repo** |

Channels (same agent process, shared user/portfolio YAML):

| Channel | Pattern | Env |
|---------|---------|-----|
| **Telegram** | like Binary | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_IDS` |
| **Slack** | like Marie (Socket Mode via Utarus) | `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_ADMIN_IDS` |

```
invage (domain)  ──depends on──►  utarus (framework + BinDrive)
     │
     ├── createFramework({ extension: invageExtension })
     ├── startTelegram() + startSlack()   # either or both
     ├── src/tools/*          portfolio / analyzer / report / snapshot
     ├── src/market/*         Yahoo Finance + 3-axis engine
     └── src/webapp/server.ts re-exports startBinDrive from utarus
```

Pinned like Binary:

```json
"utarus": "github:Judeqiu/utarus#bdd9962"
```

---

## Prerequisites

- Node.js 20+
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
UTARUS_AGENT_NAME=Invester
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

## Run

```bash
# Agent: CLI + any configured chat interfaces
npm run dev

# Production: both bots, no CLI
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
  admin-bootstrap.ts    # TELEGRAM_ADMIN_IDS + SLACK_ADMIN_IDS → user YAML
  webapp/server.ts      # re-export startBinDrive from utarus
  state/portfolio-state.ts   # portfolio map on user YAML (tg + slack resolve)
  market/               # Yahoo Finance + analyzer
  tools/                # domain tools (telegram_user_id OR slack_user_id)
  report/               # HTML report template
```

**Not forked here** (live in Utarus): agent pool, config, Telegram/Slack/CLI, invite tools, user-state tools, BinDrive routes/auth, skill-tool, firecrawl, write_report.

---

## Domain tools

| Tool | Role |
|------|------|
| `add_holding` / `update_holding` / `remove_holding` / `get_portfolio` / `clear_portfolio` | Portfolio CRUD on `data/users/<slug>.yaml` |
| `portfolio_analyzer` | 3-axis analysis + market summary |
| `save_report` | HTML report → BinDrive + signed URL |
| `save_snapshot` / `list_snapshots` | Dated P/L JSON snapshots |
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
