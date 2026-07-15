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
| Landing QR register | `src/onboard/api.ts` (mounted as extra router) |
| Optional drive-only process | `src/webapp/server.ts` |
| E2E | `tests/webui-e2e.mjs` |

## What Invage does **not** own

- React SPA  
- `/api/chat/*` conversations / SSE  
- Web login / redeem / admin REST  

Those ship inside the pinned `utarus` dependency (`web/dist`, `src/webapp/chat/*`).
