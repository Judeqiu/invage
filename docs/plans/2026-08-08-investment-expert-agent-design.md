# Investment Expert — Local Peer Agent Design

**Date:** 2026-08-08  
**Status:** Validated design (implementation follows this doc)  
**Scope:** New multi-local peer on the Invage host, same pattern as Bookkeeper / Accountant.

---

## Overview

**Investment Expert** is a dedicated peer agent for **portfolio + thesis** work: playbook-aware holdings review, single-name deep dives, undervalued discovery, news→path, and options structure analysis. It reads the user’s portfolio and playbook, uses live market tools and Firecrawl, and packages SOTA recipes via **skill + agent KB** (like Accountant).

It does **not** mutate books, run the playbook wizard, or design payment plans.

| Concern | Owner |
|---------|--------|
| Bare messages, billing, WebUI shell, playbook wizard, full toolset | **Invester** (`invage`, default) |
| Portfolio + thesis (read-only books) | **@InvestmentExpert** (`investment-expert`) |
| Journal / reconcile / holding CRUD | **@Bookkeeper** |
| Payment plans / cash efficiency | **@Accountant** |

---

## Identity

| Field | Value |
|-------|--------|
| Agent id | `investment-expert` |
| Label | Investment Expert |
| Mention | `@InvestmentExpert` |
| LLM routing | `{ default: 'heavy' }` |
| Billing / webUi | None (host default owns shell) |

---

## Sole responsibility

**In scope**

- Holdings review: 3-axis, P/L, concentration vs playbook caps  
- Single-name valuation / quality / trap gates (investment-analysis Parts B–C)  
- Research analyst pack (Part H): full breakdown, statement deep dive, valuation under/fair/over, industry & competitive, risk scenarios, technical structure (secondary)  
- Undervalued discovery tilted by playbook markets / philosophy  
- News → price-path (Part D) with Firecrawl  
- Options structure (Part G) — never invent premiums/Greeks  
- Index-relative and multi-market context (Parts E–F)  
- Sizing / BUY-SELL language filtered by `get_playbook`  
- Optional HTML analysis via `save_report`

**Out of scope**

| Need | Hand off |
|------|----------|
| Holding / cash / FD / household mutations | `@Bookkeeper` or Invester |
| Playbook setup / `update_playbook` | **Invester** only |
| Payment plans / avalanche / opportunity cost | `@Accountant` |
| Property shopping / stamp duty deep dives | Invester + `property_intel` |
| Trade execution | None (educational only) |

---

## Tools

`createInvestmentExpertTools()` — **read / research only**:

| Tool | Role |
|------|------|
| `get_portfolio` | Holdings, cash, deposits, options (cost basis) |
| `get_playbook` | Strategy, risk, caps, buy/sell, watchlists |
| `get_quote` | Live marks this turn |
| `portfolio_analyzer` | Metrics, 3-axis, value screen, playbook thresholds |
| `save_report` | Optional HTML analysis |

Framework-supplied (Utarus): Firecrawl, agent/user KB tools, BinDrive as needed.

**Excluded:** portfolio CRUD, cash/FD mutations, household/projection, payment plan, opportunity cost, property_intel, `update_playbook`, send_report, snapshots.

**Implementation:** explicit `createGetPortfolioTool()` / `createGetPlaybookTool()` exports — not a silent filter over full factories.

---

## Skills

| Skill id | Role |
|----------|------|
| `investment-analysis` | Core SOTA recipes (Parts A–H; H = research analyst pack) |
| `firecrawl` | News, filings, screens, options chain text |
| `bindrive` | Save/share reports |

Bodies from existing `src/skills/knowledge/*.md`. No `playbook-setup`, `family-treasury`, or `payment-planning` on this peer.

---

## Agent KB

| Path | Purpose |
|------|---------|
| `kb-seed/agents/investment-expert.yaml` | System seed |
| `data/kb/agents/investment-expert.yaml` | Runtime (via `scripts/seed-agent-kb.mjs`) |

**Purpose rule:** on portfolio review / ticker thesis / undervalued / news-path work, call `search_kb` (or `list_kb` scope=agent) **this turn** before freehand recipes.

**Seed themes (v1)**

1. Hard rules (tool-before-claim, fail-fast, playbook filters, educational disclaimer)  
2. Tools map  
3. Playbook application  
4. Recipes (portfolio sweep, single ticker→H1, undervalued, news path, options, concentration, research pack)  
5. Hand-off matrix  
6. Output templates (short pointers)  
7. Research analyst pack Part H (H1–H6 product map)

**YAGNI:** case-rehearsal / stakeholder council not in v1.

---

## enrichMessage

Prefix (must append user text): slug/display name, holdings count, free-cash hint, playbook one-liner, channel id for tools, read-only + hand-off reminders.

Pattern: `` `${prefix}\n\n${ctx.text}` `` — never drop user text.

---

## Wiring checklist

| File | Change |
|------|--------|
| `src/tools/portfolio.ts` | Export `createGetPortfolioTool()` |
| `src/tools/playbook.ts` | Export `createGetPlaybookTool()` |
| `src/tools/index.ts` | `createInvestmentExpertTools()` |
| `src/agents/investment-expert.ts` | DomainExtension |
| `src/index.ts` | Register peer |
| `src/extension.ts` | Mention `@InvestmentExpert` in Invester purpose |
| `kb-seed/agents/investment-expert.yaml` | Seed corpus |
| `scripts/seed-agent-kb.mjs` | Add `investment-expert` to `AGENTS` |
| `tests/investment-expert-agent.test.ts` | Allowlist / denylist / purpose / skills / routing |

---

## Default agent consults peers (utarus ≥ v3.0.0-beta.10)

On multi-local hosts, framework tools (every local agent including Invester):

| Tool | Role |
|------|------|
| `list_local_agents` | Peer id / label / purpose |
| `invoke_local_agent` | Run a peer turn; return reply (max depth 1) |

Invester purpose instructs when to consult Bookkeeper / Accountant / Investment Expert and synthesize. See utarus `docs/releases/v3.0.0-beta.10.md` and `docs/multi-agent-host-guide.md` §4.3.

**Pin:** `"utarus": "github:Judeqiu/utarus#v3.0.0-beta.10"`

## Non-goals (v1)

- Case rehearsal council seats  
- Household reads on this peer  
- Playbook wizard on this peer  
- Stand-alone product / separate deploy  
- Multi-LLM seat swarm  

---

## Success criteria

- Room invite can `@InvestmentExpert` and get playbook-aware analysis without write tools  
- Unit tests enforce tool surface and purpose contracts  
- Agent KB seed installs via existing seed script  
- Invester remains default; analysis still available on Invester for bare messages  
