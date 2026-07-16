# Invage Architecture — Layering & Integration with Utarus

**Status:** design review (2026-07-15, updated 2026-07-15). Records the as-is classification of every file under `src/`, surfaces misplacements, and proposes a refactor order. **Steps 1 + 2 of the refactor plan are DONE** — see §5 for status. The doc is the source of truth for "what lives where and why" — when in doubt, file position follows this table, not vibes.

---

## 1. Two-layer model

```
┌──────────────────────────────────────────────────────────┐
│  invage/  (DOMAIN — investor agent)                      │
│  • investor tools, market data, playbook, skills         │
│  • investor-specific onboarding (BIND-token QR flow)     │
│  • HTML report rendering                                 │
└──────────────────────────────────────────────────────────┘
                        │ depends on
                        ▼
┌──────────────────────────────────────────────────────────┐
│  utarus/  (FRAMEWORK — agent platform)                   │
│  • DomainExtension contract, agent cache, model client   │
│  • user state YAML, BinDrive, auth/sessions              │
│  • access gate (invite/admin/demo), skills framework     │
│  • Telegram / Slack / CLI interfaces                     │
│  • (GAP) WebUI chat layer — see §5                       │
└──────────────────────────────────────────────────────────┘
```

The contract between the layers is the `DomainExtension` interface (`utarus/src/extension.ts`). Invage plugs in by exporting `invageExtension` and calling `createFramework({ extension: invageExtension })` in `src/index.ts`.

Anything an investor shares with the next domain agent (Binary, Marie, …) belongs in utarus. Anything that says "portfolio", "ticker", "playbook", or "Yahoo Finance" belongs in invage.

---

## 2. DomainExtension — the only integration surface

Invage implements exactly these fields of `utarus.DomainExtension`:

| Field | Invage provides | Notes |
|---|---|---|
| `purpose` | `INVAGE_PURPOSE` (long string in `extension.ts:27`) | Appended to framework system prompt |
| `tools` | `() => createInvageTools()` | Fresh array per call |
| `skills` | `INVAGE_SKILLS` from `skills.ts` | Static — investor knowledge docs |
| `telegramCommands` | `/guidance` | One command |
| `slackCommands` | `/guidance`, `/bind`, `/onboard` | Three commands |
| `webCommands` | `/guidance`, `/bind`, `/onboard` | Same set as Slack (WebUI composer) |
| `enrichMessage` | Prepends `[Investor context: ...]` block | Per-turn context injection |
| `buildSessionAnnouncement` | — | Not used |
| `resolveEntitySlug` | — | Not used (invage has no sub-entity like sellers) |

The framework provides — free — agent lifecycle, model client (DeepSeek), tool dispatcher, usage caps, BinDrive, skills loader, firecrawl, post-html-report, user-state tools, invite tools, access gate, demo mode, sessions.

---

## 3. File-by-file classification (as-is)

Legend: ✅ correctly placed · 🔁 duplicates utarus · ⬆️ generic, should upstream · 🎯 investor-domain, stays.

### `src/` (top-level)

| File | LOC | Class | Note |
|---|---|---|---|
| `index.ts` | — | 🎯 | Process entrypoint; wires `createFramework({ extension: invageExtension })`. Stays. |
| `extension.ts` | 264 | 🎯 | The `DomainExtension` impl. Stays. |
| `admin-bootstrap.ts` | — | 🎯 | First-run admin creation. Stays. |
| `guidance.ts` | 533 | 🎯 | `/guidance` slash command text. Stays. |
| `skills.ts` | 179 | 🎯 | Investor skill markdown registration. Stays. |

### `src/webapp/` — WebUI chat layer

| File | LOC | Class | Note |
|---|---|---|---|
| `server.ts` | 119 | ⬆️ | `buildInvageApp()` is generic except `WEB_DIST_DIR`. Should move to utarus as `createWebUiApp(framework, opts)`. |
| `chat/router.ts` | 303 | ⬆️ | Generic chat router. Only investor-tinted line: `loadInvestorState` import for the gate. Replace with a `loadState` hook and upstream. |
| `chat/run-agent.ts` | 181 | ⬆️ | Pure generic. Subscribe to pi-agent-core events → push to stream-registry. Upstream. |
| `chat/sse.ts` | 41 | ⬆️ | Pure SSE wire helpers. Upstream. |
| `chat/stream-registry.ts` | 113 | ⬆️ | Pure in-memory run registry. Upstream. |
| `chat/types.ts` | 87 | ⬆️ | Generic `ChatEvent`, `RunState`, `WebAgent` structural type. Upstream. |
| `chat/extract-assets.ts` | 61 | ⬆️ | Regex scan for `/api/files/<name>?slug=<owner>`. Hardcoded to BinDrive URL pattern — that IS the framework contract, so generic. Upstream. |
| `chat/admin-router.ts` | 135 | ⬆️ | Pure REST wrapper around utarus exports (`createInviteCode`, `listUserSlugs`, `getDemoModeState`, etc.). Upstream. |
| `chat/onboard.ts` | 116 | ⬆️ | `POST /login` + `GET /demo` + `POST /redeem`. Only investor-tinted import: `resolveInvestorBySlug` for state-verification. Replace with utarus `loadState` and upstream. |

**Verdict:** the entire `src/webapp/` directory is generic WebUI-for-Utarus-agent infrastructure. It should move to `utarus/src/webui/` and ship behind a `createWebUi(framework, opts)` API that invage consumes.

### `src/onboard/` — QR / BIND-token flow

| File | LOC | Class | Note |
|---|---|---|---|
| `api.ts` | 73 | 🎯 | `POST /api/onboard/register` (landing-page form). Returns Slack workspace invite + `/bind` command. Investor-specific because it bakes in the Slack workspace URL. |
| `bind-command.ts` | 28 | 🎯 | `/bind` Slack command — entrypoint. |
| `handshake.ts` | 125 | 🎯 | Walks the BIND token, creates the user via utarus `ensureChannelUser`, audits the log. **Refactored 2026-07-15** — now delegates user creation to utarus instead of the deleted `ensureSlackUser`. |
| ~~`user-create.ts`~~ | ~~65~~ | 🔁 | **DELETED 2026-07-15.** Was duplicating utarus `ensureChannelUser`; replaced by direct utarus call in `handshake.ts`. |
| ~~`slug.ts`~~ | ~~36~~ | 🔁 | **DELETED 2026-07-15.** Was duplicating utarus slug derivation; no callers remain. |
| `token-store.ts` | 126 | 🎯 | BIND-token CRUD over `data/onboard_tokens.yaml`. The token format (`BIND-XXXXXXXX`) is investor-specific; the storage pattern is generic but small enough that promoting it to utarus would create an awkward "generic token store" abstraction. Stays. |
| `admin-commands.ts` | 72 | 🎯 | `/onboard list|reject` — investor admin UX. Stays. |
| `types.ts` | — | 🎯 | BIND-token shape. Stays. |

**Verdict:** Step 1 done. `user-create.ts` and `slug.ts` deleted; `handshake.ts` refactored to delegate user creation to utarus `ensureChannelUser` (now accepts `contactEmail`). The rest is investor-domain.

### `src/state/` — investor state on top of utarus user YAML

| File | LOC | Class | Note |
|---|---|---|---|
| `portfolio-state.ts` | 50 | 🎯 | **Refactored 2026-07-15** — now holds only investor-specific helpers (`InvestorState` type, `getPortfolio`/`setPortfolio`, `getPlaybook`/`setPlaybook`/`updatePlaybook`). YAML I/O (`loadState`/`saveState`) and lookups (`resolveUserBy{Slug,SlackUser,TelegramUser}`) come from utarus. Callers cast `UserState → InvestorState` at the boundary since the YAML file carries the extra `portfolio` / `playbook` fields. |

### `src/market/` — Yahoo Finance analytics

| File | LOC | Class | Note |
|---|---|---|---|
| `yf-client.ts` | 3 | 🎯 | 3-line yahoo-finance2 wrapper. Correctly in invage (utarus has no finance scope). |
| `analyzer.ts` | 174 | 🎯 | 3-axis portfolio analysis. |
| `value-assess.ts` | 397 | 🎯 | Undervaluation gates. |
| `fetch-{prices,metrics,targets}.ts` | 158 | 🎯 | Market data fetch. |
| `config.ts`, `types.ts`, `index.ts` | 204 | 🎯 | Config + types. |

**Verdict:** entire directory is clean investor-domain.

### `src/playbook/`

| File | LOC | Class | Note |
|---|---|---|---|
| `types.ts`, `resolve.ts`, `thresholds.ts`, `index.ts`, `guidance.ts` | 855 | 🎯 | Investment playbook schema + resolution + LLM guidance generation. Pure domain. |

### `src/tools/`

| File | LOC | Class | Note |
|---|---|---|---|
| `index.ts` | 19 | 🎯 | Tool registry builder. |
| `portfolio.ts` | 269 | 🎯 | `add_holding` / `remove_holding` / `get_portfolio`. |
| `playbook.ts` | 220 | 🎯 | `get_playbook` / `update_playbook`. |
| `portfolio_analyzer.ts` | 238 | 🎯 | Live quote + metrics + targets. |
| `snapshot.ts` | 171 | 🎯 | Save portfolio snapshot. |
| `save_report.ts` | 85 | 🎯 | Render + save HTML to BinDrive. Depends on portfolio analysis. |
| `send_report.ts` | 105 | 🎯 | Email HTML report via `gws` CLI. Investor-specific rendering. |
| `channel.ts` | 73 | 🎯 | `channelIdParams` + `resolveInvestorFromChannel`. Investor-specific wrapper around `resolveInvestorBy*`. |

**Verdict:** all investor-domain. The only structural observation: `channel.ts` will simplify once utarus exports `resolveUserBySlug` — `resolveInvestorFromChannel` becomes a thin wrapper.

### `src/report/`

| File | LOC | Class | Note |
|---|---|---|---|
| `template.ts` | 132 | 🎯 | Portfolio HTML template with GitHub-dark styling. Pure investor. |

---

## 4. Misplacements summary

### High-priority — pure duplication, delete-and-replace

**✅ DONE 2026-07-15 (Step 1).** All four duplicate categories removed:

| invage file | utarus counterpart | Status |
|---|---|---|
| `onboard/slug.ts` | `uniqueSlug` / `slugBaseFromDisplayName` (utarus onboarding/instant-invite.ts) | ✅ Deleted; no callers remained after `handshake.ts` switched to `ensureChannelUser`. |
| `onboard/user-create.ts` (`ensureSlackUser`) | `ensureChannelUser` (utarus onboarding/instant-invite.ts) | ✅ Deleted; `handshake.ts` calls `ensureChannelUser({ contactEmail, source: 'invite' })` directly. |
| `state/portfolio-state.ts` `loadInvestorState` / `saveInvestorState` / `assertCoherent` / `listUserSlugs` | `loadState` / `saveState` / `listUserSlugs` (utarus state/) | ✅ Deleted; callers import `loadState` / `saveState` from utarus and cast to `InvestorState`. |
| `state/portfolio-state.ts` `resolveInvestorBySlackUser` / `resolveInvestorByTelegramUser` / `resolveInvestorBySlug` | `resolveUserBySlackUser` / `resolveUserByTelegramUser` / `resolveUserBySlug` (utarus state/) | ✅ Deleted; callers import from utarus and cast. |

### Medium-priority — upstream to utarus (enable other domain apps)

| invage area | Proposed utarus home | Why |
|---|---|---|
| `src/webapp/` (entire chat layer) | `utarus/src/webui/` + `createWebUi(framework, opts)` | Every Utarus domain app will want a WebUI. Currently invage pioneers this and the next app would copy-paste ~1000 LOC. |
| `chat/onboard.ts` (`POST /login`, `GET /demo`, `POST /redeem`) | `utarus/src/webui/auth-router.ts` | Generic JSON auth endpoints — every WebUI needs them. |
| `chat/admin-router.ts` | `utarus/src/webui/admin-router.ts` | Generic invite/admin-code/demo REST — direct wrapper around utarus exports. |
| `chat/extract-assets.ts` | `utarus/src/webui/extract-assets.ts` | Pure regex scan for BinDrive URLs — bound to the BinDrive contract, not investor. |

### Lower-priority — gaps to fill in utarus

| Gap | Why it matters | Status |
|---|---|---|
| `utarus.resolveUserBySlug(slug)` (was not exported) | Domain apps shouldn't reimplement slug→state lookup. `channel.ts:resolveInvestorFromChannel` and `extension.ts:enrichMessage` both need this. | ✅ **DONE 2026-07-15 (Step 2)** — added to `utarus/src/state/state-file.ts`, exported from main index. |
| `UserIdentity.id` declared canonical (UUID) | Today `slug` is the implicit primary key in most APIs; `id` is decorative. Document `id` as the channel-independent canonical id, add `get_user_by_id` tool. See [[invage-user-id-formalization]] when written. | Still open. |
| Persistent transcript log | History is in-memory only today; no search across channels. (Out of scope for this review — flagged in prior conversation.) | Still open. |

---

## 5. Recommended refactor order

Each step is independently shippable. Stop after any step.

**Step 1 — Delete pure duplicates.** ✅ **DONE 2026-07-15.** Replaced invage's `slug.ts`, `user-create.ts`, and the I/O+lookup halves of `portfolio-state.ts` with utarus imports. Touch points landed: `onboard/handshake.ts`, `extension.ts`, `tools/channel.ts`, `tools/portfolio.ts`, `tools/playbook.ts`, `webapp/chat/router.ts`, `webapp/chat/onboard.ts`. Tests: 58/58 pass. Uarus commit `0ef82bb` shipped the API surface (`resolveUserBySlug`, public `saveState`/`blankState`/`resolveUserBy{Slug,SlackUser,TelegramUser}`, `ensureChannelUser.contactEmail`); invage package.json pinned to it. ~150 LOC removed from invage.

**Step 2 — Promote `resolveUserBySlug` to utarus.** ✅ **DONE 2026-07-15** (folded into Step 1's utarus commit). Added to `utarus/src/state/state-file.ts`, exported from main index. Invage imports updated.

**Step 3 — Upstream WebUI chat layer.** Move `src/webapp/{server.ts, chat/*}` to `utarus/src/webui/`. Expose `createWebUi(framework, { distDir })` returning an Express app. Invage's `index.ts` calls `framework.app.use(createWebUi(framework, { distDir: 'web/dist' }))`. ~1000 LOC moved. Requires `loadState`-as-hook in the chat router (today's `loadInvestorState` call) — accept a `loadLinkedState?: (slug) => UserState` option.

**Step 4 — Formalize `UserIdentity.id` as canonical.** Update `utarus/src/state/types.ts` docs, add `get_user_by_id` tool. No filesystem migration (slug stays as filename); the change is doctrinal + one new tool.

**Step 5 — Investor design doc tweaks.** Once steps 1–3 land, update this file to reflect the slimmer invage tree.

---

## 6. Integration cheatsheet

How invage wires into utarus, by concern:

| Concern | Utarus exports used | Invage adds |
|---|---|---|
| Boot | `createFramework({ extension })` | `invageExtension` |
| Per-turn context | `enrichMessage(ctx)` hook | `investorContextPrefix(investor, ctx)` |
| User lookup | `resolveUserBySlackUser` / `resolveUserByTelegramUser` / (gap: by slug) | Wraps in `resolveInvestorFromChannel` for tool params |
| Onboarding (instant) | `redeemInviteInstantly`, `ensureChannelUser` | — (uses utarus) |
| Onboarding (QR / BIND) | — | `onboard/handshake.ts` + `/bind` Slack command |
| State I/O | `loadState` / `saveState` | Wraps to add `portfolio` + `playbook` fields |
| Tools | `AgentTool` interface | `tools/{portfolio,playbook,portfolio_analyzer,snapshot,save_report,send_report}.ts` |
| Skills | `Skill` interface + `use_skill` tool | `skills.ts` registers 3 investor knowledge docs |
| Channels | Telegram, Slack, CLI built-in | WebUI (today: invage-local; future: utarus-shared) |
| Files | BinDrive portal + `/api/files/*` | `save_report` writes there |
| Slash commands | `DomainExtension.slackCommands` | `/guidance`, `/bind`, `/onboard` |
| Sessions | `createSession`, `requireAuth` | — |
| HTML delivery | `post_html_report` tool | `save_report` (investor-styled HTML) |

---

## 7. Open questions

1. **WebUI upstream scope.** Move the whole `src/webapp/` to utarus as one block, or split into `webui-core` (router/run-agent/sse/registry) and `webui-admin` (admin-router) so apps can opt into admin separately? Recommend: single block, gated by an `opts.adminRouter: boolean` flag.
2. **BIND-token abstraction.** Worth promoting `onboard/token-store.ts` to utarus as a generic "pre-channel-link token store" (so the next domain app with a QR flow can reuse it)? Recommend: no — the abstraction is awkward and the file is small. Stays in invage.
3. **Transcript persistence.** Out of scope here but blocks "search history across channels" (see prior conversation). Worth a separate design pass.
