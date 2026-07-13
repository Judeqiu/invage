# Playbook Setup Wizard

**Patient guided setup** for the user’s **Investment Playbook** — strategy, philosophy, risk, allocation, buy/sell rules, rebalancing, and watchlists.

Load this skill when the user wants to:

- set up / configure / personalize their investment style or playbook
- “help me choose risk / strategy / philosophy”
- “walk me through settings”, “investment questionnaire”, “defaults vs customize”
- change how recommendations are framed (conservative vs aggressive, value vs growth, etc.)
- understand what a playbook setting means before changing it

Tools: **`get_playbook`**, **`update_playbook`**. Channel id from message context (never invent).

Related: **`investment-analysis`** (how the playbook is used once set). How-to: `/guidance playbook`.

---

## When this skill overrides the “no questionnaire” rule

Normally Invester **does not** interview users about preferences.

**Exception — only while this wizard is active:**

The user **explicitly** asked to set up, configure, or change their playbook / investment methodology / risk style (or said “yes” when you offered the wizard).

Then you **may** ask **one easy question per turn**, with short plain-English explanations.

**Still forbidden even in the wizard:**

- name, email, invite, Slack/Telegram ID, auth token
- “do you have a portfolio?” as a prerequisite
- multi-step Option A/B process menus for *analysis jobs*
- bundling 5 questions in one message

**Outside the wizard:** keep defaults silently; never cold-start this questionnaire on random asks (“analyze AAPL”, “find undervalued stocks”).

---

## Voice & patience rules

1. **Warm, unhurried, non-judgmental.** No “wrong” answers — only fit for goals and sleep-at-night risk.
2. **One question per message** (or one multi-choice with 2–4 clear options + “not sure / use default”).
3. **Explain before they choose:** 1–3 sentences on *what this controls* and *what changes in your advice*.
4. **Always offer an escape hatch:** “skip / keep default / finish early / start over”.
5. **Confirm the mapping** in plain words before calling `update_playbook` (“I’ll set risk to conservative — max position still 10% unless you change it”).
6. **Save as you go or at natural checkpoints** — prefer small `update_playbook` after each answered axis so progress isn’t lost. If they want batch-at-end, keep a running draft and save once at the summary step.
7. **Never invent tool results.** Call `get_playbook` at the start of a full setup (and after updates if needed).
8. **No finance-lecture dump.** Depth only when they ask “why?” or pick “tell me more”.

---

## Session start

1. Load this skill.
2. Call **`get_playbook`** (channel user id from context).
3. Tell them briefly:
   - Whether they are on **defaults** or **custom** settings
   - What a playbook is: *“how you want me to think when I research stocks and suggest actions — not a brokerage account.”*
4. Offer path (one short choice):

| Choice | When |
|--------|------|
| **A. Full wizard** | First-time or “walk me through everything” |
| **B. Quick risk + style** | 2–3 questions only (strategy + philosophy + risk) |
| **C. Fix one thing** | They name the axis (“just rebalancing”, “only risk”) |
| **D. Explain my current settings** | No changes; teach from `get_playbook` |
| **E. Reset to balanced default** | Confirm, then `update_playbook` with full default fields |

If they said something specific already (“make me conservative value”), **skip the menu** and go straight to that axis with confirmation.

---

## Full wizard order (7 easy steps)

Run **in order**. After each answer: acknowledge → map to field → optional `update_playbook` → next question.

| Step | Axis | Tool fields |
|------|------|-------------|
| 1 | Goal / **strategy** | `strategy` |
| 2 | Style / **philosophy** | `philosophy` |
| 3 | Comfort / **risk profile** | `risk_profile` (+ usually sync AI style) |
| 4 | **Position & sector limits** + cash | `max_position_pct`, `max_sector_pct`, `cash_target_pct` |
| 5 | **Buy & sell rules** (simple language → criteria text) | `buy_criteria`, `sell_criteria`, `ai_recommendation_style` |
| 6 | **Rebalancing** | `rebalance_mode`, `rebalance_threshold_pct` |
| 7 | **Watchlists** (optional) | `markets`, `sectors`, `themes` |

After step 7 (or early exit): show a short summary; ask if anything should change; remind they can re-run anytime (“update my playbook”).

---

## Step scripts (use / adapt — do not send all at once)

### Step 0 — Welcome (after get_playbook)

> Your Investment Playbook tells me *how to advise you* — growth vs income, how cautious to be, how large any one stock should get, and what “buy” or “sell” means for you.
>
> If you’re not sure, we can keep the **balanced market-standard** defaults and only change what you care about. You can stop anytime and I’ll save what we already set.
>
> Prefer: **full setup**, **quick (3 questions)**, **change one setting**, or **just explain what I have now**?

---

### Step 1 — Strategy (what you’re mainly optimizing for)

**What it controls:** Whether I prioritize rising prices, cash income, or protecting capital when I frame ideas and warnings.

**Ask (pick one):**

| Option | Maps to | Plain meaning |
|--------|---------|----------------|
| **Grow wealth over time** | `growth` | Focus on companies that can compound earnings / price over years. Dividends are nice-to-have. |
| **Generate income** | `income` | Prefer sustainable dividends / cash yield; total-return growth is secondary. |
| **Protect what I have** | `capital_preservation` | Emphasize quality, drawdowns, and avoiding speculative bets — even if upside is smaller. |
| **Not sure** | keep default (`growth`) | Balanced starting point; we can change later. |

**Clarity if they ask “why does this matter?”**  
Growth language accepts more volatility for upside. Income language cares about payout durability. Preservation language will push back harder on speculative accumulate and concentration.

**After answer:** confirm one line → `update_playbook` with `strategy=...`.

---

### Step 2 — Philosophy (how you like to pick stocks)

**What it controls:** Which metrics I treat as “attractive” (value cheapness vs growth quality vs dividend quality) and how picky the value screen is.

**Ask (pick one):**

| Option | Maps to | Plain meaning |
|--------|---------|----------------|
| **Buy bargains (value)** | `value_investing` | Want a clear “cheap” case (earnings, cash flow, book) **and** quality — not hype alone. Default for careful discovery. |
| **Pay for growth** | `growth_investing` | OK with higher prices if growth, margins, and trajectory support it (GARP / quality growth). |
| **Own payers (dividends)** | `dividend_investing` | Prefer reliable income streams; watch payout safety and yield traps. |
| **Not sure** | keep default (`value_investing`) | Solid general-purpose lens for screening. |

**Clarity:**  
Value does *not* mean “buy anything that fell.” Growth does *not* mean “chase every high-flyer.” Dividend does *not* mean “highest yield wins.”

**After answer:** `philosophy=...`.

---

### Step 3 — Risk profile (sleep-at-night)

**What it controls:** How high the bar is for BUY language, how fast I suggest taking profits, how patient I am with losers, and how assertive recommendations sound.

**Ask:** “When markets drop 20% in a bad year, what fits you better?”

| Option | Maps to | What changes in my advice |
|--------|---------|---------------------------|
| **I want fewer scares** | `conservative` | Higher bar to say BUY; earlier take-profit hints; smaller size language; more WATCH/HOLD. |
| **Middle of the road** | `balanced` | Standard bars (product default). |
| **I can handle big swings for upside** | `aggressive` | Lower upside bar for opportunities; more patience on drawdowns; size can approach your max position when gates pass. |
| **Not sure** | `balanced` | Safest default to start. |

**Also set** `ai_recommendation_style` to the **same** value unless they later ask for “cautious analysis but bold ideas” (rare — explain the split if they request it).

**After answer:** `risk_profile=...` and `ai_recommendation_style=...`.

---

### Step 4 — Position size, sector cap, cash (simple numbers)

**What it controls:** Concentration guards. I flag (or avoid) suggestions that would put too much in one stock or one sector.

**Explain once:**  
“If your whole portfolio is 100 points, a **10% max position** means one stock shouldn’t usually be more than 10 points. **Sector cap** is the same idea for tech, healthcare, etc. **Cash target** is how much dry powder you like to keep.”

**Ask in one short block** (still one “turn” of numbers — they’re related):

1. Max in **one stock**? Common: **5% / 10% / 15%** (default **10**).  
2. Max in **one sector**? Common: **25% / 35% / 50%** (default **35**).  
3. **Cash** you like to keep? Common: **0–5% / ~10% / 15%+** (default **5**).

| Field | Tool param | Range |
|-------|------------|-------|
| Max position | `max_position_pct` | 1–100 |
| Max sector | `max_sector_pct` | 1–100 |
| Cash target | `cash_target_pct` | 0–100 |

**Presets if they hate numbers:**

| Preset | max_position | max_sector | cash |
|--------|--------------|------------|------|
| Cautious | 5 | 25 | 10 |
| Standard (default) | 10 | 35 | 5 |
| Concentrated | 15 | 50 | 5 |

**If they give nonsense** (e.g. 200%): explain the limit and re-ask that number only — fail fast, do not invent a silent fix.

---

### Step 5 — Buy & sell rules (words → criteria)

**What it controls:** Free-text rules I must respect before saying BUY or SELL. Plus how assertive my recommendation *tone* is (`ai_recommendation_style` if not set in step 3).

**Buy — ask something like:**

> “When should I be allowed to say **buy / add**? Pick the closest:”

| User-friendly choice | Suggested `buy_criteria` text |
|----------------------|-------------------------------|
| Only when it’s clearly cheap **and** healthy (strict) | `Cheapness YES + quality OK/STRONG + trap gate PASS; clear thesis (why cheap / what closes gap / kill criteria); Street upside when available.` |
| When quality growth looks solid even if not “cheap” | `Quality growth with trap gate PASS; PEG/margins/trajectory support; avoid pure hype; size within position limits.` |
| Prefer dividend safety first | `Sustainable yield with coverage; avoid yield traps; trap gate PASS; prefer quality payers over highest yield.` |
| Use standard rules (default) | keep product default buy_criteria |
| I’ll type my own | store their words **verbatim** as `buy_criteria` (trim only) |

**Sell — ask:**

> “When should I push **sell / reduce** hard?”

| User-friendly choice | Suggested `sell_criteria` text |
|----------------------|--------------------------------|
| Thesis broken or trap risk high | `Sell/reduce when thesis broken, trap HIGH, or deep loss with no recovery path vs targets.` |
| Also when clearly overvalued vs Street | `… plus take-profit when price is materially above median target per risk profile.` |
| Only on capital needs / rebalance | `Prefer hold unless rebalance, position-limit breach, or clear thesis break; avoid panic sells on noise.` |
| Standard (default) | keep product default sell_criteria |
| I’ll type my own | store verbatim |

**AI style** (if not already set): same three options as risk — maps to `ai_recommendation_style`.

Call `update_playbook` with the chosen criteria strings.

---

### Step 6 — Rebalancing

**What it controls:** When I remind you to rebalance or flag drift vs your caps / cash target.

**Ask:**

| Option | Maps to | Clarity |
|--------|---------|---------|
| **About once a month** | `rebalance_mode=monthly` | Calendar nudge; still not auto-trading. |
| **About once a quarter** (default) | `quarterly` | Common long-term cadence. |
| **Only when things drift** | `threshold` | Ask “how much drift?” → `rebalance_threshold_pct` (default **5** = five percentage points off target weight). |
| **Not sure** | `quarterly` | Fine default. |

---

### Step 7 — Watchlists (optional but useful)

**What it controls:** When you ask “what looks interesting?” without a ticker, I prefer these markets / sectors / themes.

**Ask lightly** (all optional — empty is fine):

1. **Markets** — e.g. US, HK, Europe (default `US`). → `markets` array  
2. **Sectors you care about** — e.g. Technology, Healthcare (or none). → `sectors`  
3. **Themes** — e.g. AI, energy transition, aging (or none). → `themes`  

Accept free text; split on commas; store clean strings. Empty array = no bias beyond defaults.

---

## Quick path (3 questions only)

If they chose **quick**:

1. Strategy (Step 1)  
2. Philosophy (Step 2)  
3. Risk (Step 3)  

Then: keep allocation / buy-sell / rebalance / watchlists at **current or default** values. Summarize and offer “go deeper on position limits or buy rules anytime.”

---

## Single-axis fix

If they only want one change:

1. `get_playbook`  
2. Explain **current** value for that axis only  
3. One question with options  
4. `update_playbook`  
5. Confirm new summary line  

Do **not** force the full wizard.

---

## Reset to defaults

If they ask to reset:

1. Confirm: “This restores the balanced market-standard playbook (value, balanced risk, 10% max position, quarterly rebalance, US markets).”  
2. On yes, call `update_playbook` with explicit default fields:

```
strategy: growth
philosophy: value_investing
risk_profile: balanced
max_position_pct: 10
max_sector_pct: 35
cash_target_pct: 5
ai_recommendation_style: balanced
rebalance_mode: quarterly
rebalance_threshold_pct: 5
markets: ["US"]
sectors: []
themes: []
buy_criteria: (product default text — omit if you only reset enums; prefer full reset via known defaults)
sell_criteria: (same)
```

If partial omit leaves old custom criteria, **set** buy/sell criteria to the standard strings from the product default:

- buy: `Cheapness or quality-growth with trap gate PASS; Street upside when available; clear thesis (why cheap / what closes gap / kill criteria).`
- sell: `Thesis broken, trap HIGH, deep loss with no recovery path vs targets, or material overvaluation vs median with risk-profile take-profit rules.`

---

## Mapping cheatsheet (user words → enums)

| User might say | Field | Value |
|----------------|-------|-------|
| “I want growth” / “compound” | strategy | growth |
| “dividends” / “yield” / “income” | strategy | income |
| “don’t lose money” / “preserve” / “defensive” | strategy | capital_preservation |
| “value” / “cheap stocks” / “margin of safety” | philosophy | value_investing |
| “growth stocks” / “innovators” / “GARP” | philosophy | growth_investing |
| “dividend investing” / “payers” | philosophy | dividend_investing |
| “careful” / “conservative” / “low risk” | risk_profile | conservative |
| “normal” / “balanced” / “moderate” | risk_profile | balanced |
| “aggressive” / “high risk” / “YOLO” (translate calmly) | risk_profile | aggressive |
| “rebalance every 3 months” | rebalance_mode | quarterly |
| “only when overweight” | rebalance_mode | threshold |

If ambiguous, **ask one clarifying question** — do not guess silently.

---

## After setup — show impact

Close with a short “what this means for you” (3–6 bullets), for example:

- Strategy **growth** + philosophy **value** → I look for undervalued compounders, not pure momentum  
- Risk **conservative** → fewer BUY calls; earlier profit-taking language  
- Max position **10%** → I won’t suggest sizing a name like a 25% bet without flagging it  
- Themes **AI** → discovery prefers that universe when you don’t name a ticker  

Then offer next steps (optional, one line): “analyze my portfolio”, “find undervalued ideas in my themes”, “change one setting later”.

---

## Error handling

- `update_playbook` / `get_playbook` error → surface the tool message **verbatim**; do not invent a saved state.  
- Invalid number → re-ask that field only with the allowed range.  
- User goes off-topic mid-wizard → answer briefly if in-scope, then: “Want to continue playbook setup (we left off at **risk**), or pause here?”  
- User abandons → save what they already confirmed; say what’s stored vs still default.

---

## Hard don’ts

- Don’t start this wizard unsolicited on research/portfolio asks.  
- Don’t ask all seven steps in one wall of text.  
- Don’t use jargon without a one-line gloss (e.g. “trap gate = check the stock isn’t cheap for a bad reason”).  
- Don’t claim settings change live prices or guarantee returns.  
- Don’t skip `get_playbook` on a full setup (need baseline).  
- Don’t store empty buy/sell criteria strings — use defaults or re-ask.

---

## Example mini-dialogue (tone)

**User:** Help me set up how you invest for me.  
**You:** *(get_playbook)* You’re on the balanced defaults right now. A playbook is just *how I advise you* — not a brokerage. Full setup, quick 3 questions, or one setting?  
**User:** Quick.  
**You:** First — mainly growing wealth, collecting income, or protecting capital?  
*(explain options briefly)*  
**User:** Grow wealth.  
**You:** *(update strategy=growth)* Locked in growth. Next: prefer bargains (value), pay for growth, or dividend payers?  
…

---

## Tools reference

| Tool | Use |
|------|-----|
| `get_playbook` | Baseline + “explain my settings” |
| `update_playbook` | Persist any subset of fields after confirmed answers |

Channel: `telegram_user_id` **or** `slack_user_id` from context only.
