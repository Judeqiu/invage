---
layout: default
title: Investment Playbook — Invester
---

**[Home](/invage/)** | **[Data Model](/invage/data-model.html)** | **[Playbook](/invage/playbook.html)**

# Investment Playbook

How each user configures **strategy, philosophy, risk, allocation, buy/sell rules, rebalancing, and watchlists** — and how Invester uses those settings to shape research and trade suggestions.

If a user never configures a playbook, Invester applies a **balanced market-standard default**. No interview is required for ordinary analysis.

---

## Why it exists

Every investor has a different methodology. The playbook is the product’s way to encode that methodology per user so that:

- BUY / SELL language matches *their* risk and criteria  
- Position and sector sizing respect *their* caps  
- Value vs growth vs dividend screens use *their* lens  
- Discovery without a ticker prefers *their* markets / sectors / themes  

It is **not** a brokerage account and does **not** place trades.

---

## Configuration axes

| Axis | Options / fields | What it steers |
|------|------------------|----------------|
| **Strategy** | `growth` · `income` · `capital_preservation` | Optimize for appreciation, yield, or drawdown control |
| **Philosophy** | `value_investing` · `growth_investing` · `dividend_investing` | Which “cheap / quality” metrics matter (PE, PEG, FCF, yield) |
| **Risk** | `conservative` · `balanced` · `aggressive` | Buy upside bar, take-profit speed, deep-loss SELL, assertiveness |
| **Allocation** | max position % · cash target % · max sector % | Concentration guards when sizing suggestions |
| **Buy & sell rules** | free-text criteria + AI style | Hard constraints before BUY/SELL wording |
| **Rebalancing** | `monthly` · `quarterly` · `threshold` (+ drift pp) | When to flag rebalance / concentration drift |
| **Watchlists** | markets · sectors · themes | Default universe for undervalued / theme discovery |

---

## Defaults (balanced market-standard)

Used when `playbook` is missing from the user YAML (or a field is omitted).

| Field | Default |
|-------|---------|
| strategy | `growth` |
| philosophy | `value_investing` |
| risk.profile | `balanced` |
| max position | 10% |
| max sector | 35% |
| cash target | 5% |
| AI recommendation style | `balanced` |
| rebalancing | `quarterly` (threshold 5 pp if threshold mode) |
| markets | `[US]` |
| sectors / themes | empty |
| buy criteria | Cheapness or quality-growth with trap gate PASS; Street upside when available; clear thesis (why cheap / what closes gap / kill criteria) |
| sell criteria | Thesis broken, trap HIGH, deep loss with no recovery path vs targets, or material overvaluation vs median with risk-profile take-profit rules |

---

## Storage

Top-level key on the same user file as the portfolio: `data/users/<slug>.yaml`.

```yaml
playbook:
  strategy: growth
  philosophy: value_investing
  allocation:
    max_position_pct: 10
    cash_target_pct: 5
    max_sector_pct: 35
  buy_sell:
    buy_criteria: "..."
    sell_criteria: "..."
    ai_recommendation_style: balanced
  rebalancing:
    mode: quarterly
    threshold_pct: 5
  risk:
    profile: balanced
    position_limit_pct: 10
    sector_exposure_pct: 35
  watchlists:
    markets: [US]
    sectors: []
    themes: []
```

Invalid enums or out-of-range percents **fail fast** (no silent clamp beyond documented sync of position/sector caps). See [Data Model](data-model.html).

---

## Tools

| Tool | Purpose |
|------|---------|
| `get_playbook` | Resolve effective playbook (defaults filled). Reports whether user-configured or default. |
| `update_playbook` | Partial update of any axis. Channel-bound via `telegram_user_id` or `slack_user_id`. |

Examples of fields on `update_playbook`: `strategy`, `philosophy`, `risk_profile`, `max_position_pct`, `max_sector_pct`, `cash_target_pct`, `buy_criteria`, `sell_criteria`, `ai_recommendation_style`, `rebalance_mode`, `rebalance_threshold_pct`, `markets`, `sectors`, `themes`.

---

## How the agent uses the playbook

### 1. Message context (every turn)

For linked users, `enrichMessage` injects compact **Investment Playbook** guidance: strategy, philosophy, risk, caps, thresholds, buy/sell rules, and watchlists. The model should treat this as hard guidance for framing and suggestions.

### 2. Portfolio analyzer

When `portfolio_analyzer` runs on a **saved** portfolio (channel user):

- Loads the user’s playbook  
- Derives analysis thresholds (buy min upside, strong-buy, deep-loss SELL, take-profit / trail-stop premiums)  
- Tilts value-screen PE/PEG/FCF bars by philosophy  
- Prints a playbook summary line on the analysis output  

Ad-hoc ticker-only analysis (no channel user) keeps global product thresholds.

### 3. Recommendation rules (skill)

The `investment-analysis` skill requires:

1. Filter BUY/SELL through buy/sell criteria and risk profile  
2. Express size as % of portfolio; flag breaches of position/sector caps  
3. Philosophy tilt (value / growth / dividend)  
4. Strategy tilt (income vs growth vs preservation)  
5. Prefer watchlist universes when no ticker is named  
6. Mention rebalance when mode / drift warrants it  

### 4. Threshold tilt (summary)

| Risk | Effect (relative to balanced) |
|------|-------------------------------|
| **Conservative** | Higher bar for BUY; earlier take-profit; more WATCH/HOLD; smaller size language |
| **Balanced** | Product standard (~15% buy upside, ~30% strong-buy, −30% deep-loss SELL) |
| **Aggressive** | Lower buy bar; more patience on drawdowns; size can approach max position when gates pass |

| Philosophy | Effect |
|------------|--------|
| **Value** | Tighter PE “cheap” bars; high valueBias |
| **Growth** | Looser PE / PEG bars; higher growthBias |
| **Dividend** | Income bias; FCF/yield emphasis |

Exact numbers are computed in `src/playbook/thresholds.ts`.

---

## Guided setup (skill)

Skill id: **`playbook-setup`**  
Knowledge: `src/skills/knowledge/playbook-setup.md`

### When it runs

**Only user-initiated.** Examples:

- “Help me set up my investment playbook”  
- “Walk me through risk and strategy”  
- “Quick setup — 3 questions”  
- “Change my playbook to conservative value”  

**Not** started cold on pure research asks (“analyze AAPL”, “find undervalued stocks”). Those use defaults silently.

### Wizard paths

| Path | Behavior |
|------|----------|
| Full wizard | 7 steps: strategy → philosophy → risk → limits → buy/sell → rebalance → watchlists |
| Quick | Strategy + philosophy + risk only |
| One setting | Single-axis change with explanation |
| Explain | Teach current settings, no mutation |
| Reset | Restore balanced defaults (after confirm) |

### Patience rules

- **One easy question per turn**  
- Plain-English options + what changes in advice  
- Skip / keep default / stop early always available  
- Prefer `update_playbook` after each confirmed axis so progress is saved  
- Fail fast on invalid numbers; surface tool errors verbatim  

Slash help: `/guidance playbook`

---

## Chat examples

```
Show my investment playbook
Help me set up my playbook
Quick setup — 3 questions
Set risk to conservative
Switch philosophy to growth investing
Max position 8%, max sector 25%, cash target 10%
Rebalance quarterly
Watch themes: AI, energy transition
Reset my playbook to defaults
```

---

## Code map

| Path | Role |
|------|------|
| `src/playbook/types.ts` | Types + `DEFAULT_PLAYBOOK` |
| `src/playbook/resolve.ts` | Merge/validate + patches |
| `src/playbook/thresholds.ts` | Risk/philosophy-derived analyzer bars |
| `src/playbook/guidance.ts` | Agent-facing guidance string |
| `src/tools/playbook.ts` | `get_playbook` / `update_playbook` |
| `src/state/portfolio-state.ts` | `getPlaybook` / `updatePlaybook` on user YAML |
| `src/extension.ts` | Inject guidance; wizard exception to no-questionnaire rule |
| `src/skills/knowledge/playbook-setup.md` | Wizard skill |
| `src/skills/knowledge/investment-analysis.md` | How playbook steers analysis |
| `tests/playbook.test.ts` | Defaults, patches, threshold tilts |

---

## Related docs

- [Data Model](data-model.html) — YAML shape, isolation, tools  
- [Home](index.html) — product overview and 3-axis framework  

---

*Source: [github.com/Judeqiu/invage](https://github.com/Judeqiu/invage)*
