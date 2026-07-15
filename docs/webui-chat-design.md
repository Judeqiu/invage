# WebUI Chat

The WebUI chat (SPA + `/api/chat` + admin REST + web login/redeem) lives in
**Utarus**, not Invage.

- Design: see `utarus/docs/webui-chat-design.md`
- Invage only mounts domain extras (landing `POST /api/onboard/register`) via
  `framework.startWebApp({ extraRouters: [...] })`.

Currency/`$` math formatting fix: `utarus/web/src/components/MarkdownRenderer.tsx`
(`singleDollarTextMath: false`).
