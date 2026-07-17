# WebUI Chat (Invage)

The WebUI is **owned by Utarus**, not Invage.

## Read these (in order)

1. **[utarus/docs/webui-integration.md](https://github.com/Judeqiu/utarus/blob/main/docs/webui-integration.md)** — how any domain agent enables browser chat  
2. **[utarus/docs/integration-guide.md](https://github.com/Judeqiu/utarus/blob/main/docs/integration-guide.md)** — `DomainExtension`, state, channels  
3. **[utarus/docs/webui-chat-design.md](https://github.com/Judeqiu/utarus/blob/main/docs/webui-chat-design.md)** — architecture  

## What Invage owns

| Piece | Path |
|---|---|
| Boot WebUI | `src/index.ts` → `framework.startWebApp({ extraRouters })` |
| Web enrich (`userSlug` branch) | `src/extension.ts` |
| Domain slash commands (`webCommands`) | `src/extension.ts` — same set as `slackCommands` |
| **WebUI plugin (Dashboard tab)** | `src/extension.ts` → `webUi: createInvageWebUi()` |
| Dashboard API | `GET /api/domain/invage/dashboard` — live model JSON |
| Dashboard page (iframe) | `webui/dashboard/` served at `/domain-assets/invage/dashboard/` |
| Landing QR register | `src/onboard/api.ts` (mounted as extra router) |
| Optional drive-only process | `src/webapp/server.ts` |
| E2E | `tests/webui-e2e.mjs` |

### Dashboard tab (domain plugin)

Utarus SPA shell loads `GET /api/webui/manifest` from `DomainExtension.webUi`. Invage registers:

| Field | Value |
|---|---|
| Nav | **Dashboard** → `/dashboard` (`layout-dashboard` icon) |
| Route | `pageKind: iframe` → `/domain-assets/invage/dashboard/index.html` |
| API | `GET /api/domain/invage/dashboard` (session auth) — live prices + snapshot history |
| Static | `webui/` → `/domain-assets/invage/` |

The page is **dynamic**: Refresh / optional 60s auto-refresh re-fetches Yahoo prices and reloads snapshot history. Same model as `save_report kind=dashboard` (not a frozen HTML file).

## Domain `webCommands` (parity with Slack)

Utarus intercepts composer messages matching `/name args` and returns
`{ kind: 'reply', text }` without calling the LLM. Catalog:
`GET /api/chat/commands` (also powers SPA `/help`).

Invage registers the **same domain commands** as Slack:

| Command | Admin | Handler |
|---|---|---|
| `/guidance [topic]` | no | `createGuidanceCommand()` |
| `/bind BIND-…` | no | `handleBindWebCommand` → handshake with `web: true` |
| `/onboard list\|reject …` | yes | `handleOnboardWebCommand` |

Framework-reserved (do **not** register): `/clear`, `/help`.

## What Invage does **not** own

- React SPA  
- `/api/chat/*` conversations / SSE  
- Web login / redeem / admin REST  

Those ship inside the pinned `utarus` dependency (`web/dist`, `src/webapp/chat/*`).
