# SG Real-Estate Portfolio

**Invester skill** for Singapore physical real estate as a **household portfolio sleeve** — comps, policy-aware buy costs, yield/LTV, mark quality, and allocation vs liquid portfolio / REITs.

Complements `family-treasury` (books + projections). Does **not** replace `investment-analysis` for listed REITs as securities. Not a listing shopper product (no multi-unit PropertyGuru packs, shortlist UX, layout, or interior design).

**Not legal, tax, or licensed property advice.** Educational / planning framing only.

---

## When to load

| Ask | Load |
|-----|------|
| HDB comps / “is my mark fair?” / psf vs recent sales | This skill |
| Stamp duty / ABSD / SSD / cooling measures (SG) | This skill + `firecrawl` for live IRAS tables |
| Yield, LTV, equity, carry on owned property | This skill (+ household tools) |
| Physical RE vs portfolio vs REIT allocation | This skill (+ `investment-analysis` for REIT securities) |
| Second property / SG buy + affordability | **This skill AND `family-treasury`** |
| Pure multi-year cash flow / NW without policy or comps | `family-treasury` only |
| “Find me condos under 2M” multi-unit hunt | **Do not** shopping-pack — redirect (see Anti-shopping) |

---

## Hard rules

1. **No invented comps, rates, rents, or yields.** Transaction prices → `property_intel` this turn. Numeric BSD/ABSD/SSD → Firecrawl IRAS (or user-pasted official table) **this turn** with as-of date; if verify fails → qualitative only or refuse numeric duty amounts.
2. **Empty comps ≠ invent “typical” town prices.**
3. **No multi-unit listing shopping packs** or shortlist/layout language.
4. **Tool-before-claim** for sold prices, psf, and duty numbers.
5. **Fail-fast** on missing rent (yield blocked), missing FX (cross-ccy LTV/allocation blocked), unlinked mortgage (LTV unknown unless user confirms free-and-clear).
6. **Never auto-write** property marks from comps — recommend `update_property` only after user accepts.
7. Still **Invester** — not conveyancing, IRAS filing, or bank underwriting.

---

## Plain language

Gloss once, then you may reuse the short form:

- **ABSD** — extra buyer stamp duty (rises with residency and how many homes you own)
- **BSD** — base buyer stamp duty on purchase price / market value
- **SSD** — seller stamp duty if you sell within a holding period
- **psf** — price per square foot (HDB tool PSF is approximate: sqm × 10.7639)
- **Freehold** vs **99-year lease** — lease decay often depresses price as remaining lease shortens
- **Comps** — comparable recent recorded sales

Prefer town names (Tampines) over district codes alone.

---

## Tools

| Tool | Use |
|------|-----|
| `property_intel` | **HDB** (`market=hdb`): data.gov.sg resale 1990–present — `list_sources` / `search_transactions` / `price_summary`; filters town, flat_type, street_name, month_from/to. **Private** (`market=private`): URA `PMI_Resi_Transaction` sold comps — requires `URA_ACCESS_KEY`; filters **project**, street_name, district, market_segment (CCR/RCR/OCR), property_type, month_from/to (**at least one filter**). Label URA as **sold** (not asking). PSF approx via sqm×10.7639. No channel ids. |
| `ura_carpark` | URA car parks: `availability` (live lots), `details` (rates/name/capacity), `lookup` (join). Filters carpark_no, name, lot_type, veh_cat. Requires `URA_ACCESS_KEY`. |
| `firecrawl` | Live IRAS/HDB pages; **named** listing URL only when URA miss (not multi-unit packs) |
| `get_household` / property & liability CRUD | Marks, mortgages, cash flows |
| `run_projection` / `compare_scenarios` | Affordability after all-in cost known |
| `portfolio_analyzer` / `get_quote` | Liquid book + REIT MTM |

Private market (`market=private`): fails without URA implementation — do not invent sold prices; for a **named** unit only, firecrawl may supply asking price labeled as such.

---

## Dual-load with family-treasury

| Path | Skills | Order |
|------|--------|-------|
| Books / 5y CF / NW only | `family-treasury` | `get_household` → projection |
| Comps / duties / yield / mark quality only | this skill | tools as above |
| **Second property / SG buy with policy cost** | **both** | (1) SC/SPR/foreigner + property count (2) Firecrawl duties this turn (3) all-in (4) household gaps (5) scenario `one_off` duties + `buy_property` (6) `compare_scenarios` |

When stamp duty or comps change the cash need of a buy scenario, load this skill and verify duties **before** inventing `one_off` amounts.

---

## Buyer identity (duties only)

Clarify only what blocks duty estimates (one short question if missing):

| Status | Typical implication |
|--------|---------------------|
| SC (Singapore Citizen) | Lowest ABSD tier; HDB paths |
| SPR | Higher ABSD; HDB waiting/joint rules |
| Foreigner | Highest ABSD; private subject to regimes; generally no HDB flats |

Also: **first vs second (or more) residential property** after purchase.

Do **not** run a shopping-intake funnel (budget + view + MRT shortlist). Identity is for **policy cost**, not listing hunt.

---

## Stamp duties (framework — verify live)

### BSD / ABSD / SSD

- Apply **current IRAS** bands only after scrape or user-pasted official table this turn.
- State assumptions: citizenship, property count after buy, price P (higher of price/MV when that rule applies).
- Template:

```
Assumptions: [SC/SPR/Foreigner], property count after buy = N, price = P, as-of = [date from page]
BSD ≈ … (bands from verified source)
ABSD ≈ rate% × P = …
Total buyer stamp ≈ BSD + ABSD
SSD if sell within holding period: (verify schedule) …
```

If verify fails: **no numeric ABSD/BSD/SSD amount** — explain qualitatively and stop.

### All-in buy cost

```
All-in C = P + BSD + ABSD + user-stated fees only
```

If duties not verified, duty component of C is **unknown** — do not fill from memory.

Feed verified duty total into family-treasury scenario as `one_off` (cash out) when running affordability.

---

## HDB pathways (orientation only)

| Path | Notes |
|------|-------|
| BTO | Citizens / eligible couples; income ceilings; wait |
| Resale | Market prices via `property_intel` |
| EC | Eligibility & MOP; not pure HDB resale dataset |

Phrase eligibility as “typically requires…” — do not declare definite eligibility without full facts.

---

## Interpreting comps (`property_intel`)

1. Lead with median/avg and **sample size n**.
2. Note storey, remaining lease, flat model as drivers.
3. Compare user mark or target price vs sample.
4. **n &lt; 5** → weak evidence; flag it.
5. Empty sample → refuse mark-quality claim; do not invent typical psf.
6. PSF from tool is approximate (sqm × 10.7639) — say so.

---

## Investor metrics (skill math)

All require explicit inputs. Same currency **or** reporting currency + `projection_assumptions.fx` for every foreign ccy (including LTV/equity).

| Metric | Formula | Required | Fail when |
|--------|---------|----------|-----------|
| **Property equity** | value − linked principal | property + linked mortgage | No link and free-and-clear not confirmed → equity **unknown** (do not invent principal 0) |
| **LTV** | principal / value | same | value = 0; cross-ccy without FX |
| **Gross yield** | (12 × monthly gross rent) / value | rent path + value | rent missing |
| **Net yield** | (12 × (rent − monthly opex)) / value | opex if claiming net | opex missing for net |
| **Cash-on-cash** | annual CF after debt / cash equity in | user-stated equity in + CF, or `properties[].payments` paid_to_date when used as equity in | missing |
| **Paid toward purchase** | sum(`properties[].payments`) | payments ledger present | payments omitted → **unknown** (not 0; do not use scenarios) |
| **Carry (monthly)** | mortgage payment + opex − rent | as available | — |
| **All-in buy** | P + BSD + ABSD + fees | verified rates | duties not verified |
| **Mark vs comps** | (mark − median) / median | property_intel + town/type | empty sample or no town/type |
| **RE allocation** | physical_equity / total_NW; REIT_MTM / total_NW | complete NW in reporting ccy | FX/gaps incomplete |

### Rent / opex path (v1)

No `monthly_rent` on property YAML.

1. **User statement this turn** (e.g. rent 3200 SGD/mo) — use; offer `add_cash_flow` if they want it stored.
2. **cash_flow match** after `get_household` / `list_cash_flows`: label/category contains rent/rental or property label/id (case-insensitive). Opex: maint/tax/agent/property or user-named lines.
3. No `property_id` on cash flows — if ambiguous, **one** clarifying question.
4. Neither → **block yield/CoC/carry**; may still answer LTV/equity/mark quality if inputs exist.

### Mortgage link resolution

```
linked = liability where id == property.mortgage_id
      OR (kind == mortgage AND property_id == property.id)
if both disagree → fail-fast, ask which is correct
if none → LTV unknown; do not assume free-and-clear without user confirmation
```

---

## Recipes

### 1. Mark quality (owned home)

1. `get_household` for mark.
2. Town + flat_type from message/label or **one** question.
3. `property_intel` `price_summary` with filters.
4. Compare mark to median; flag thin n.
5. Optional: recommend `update_property` if user accepts — never auto-write.

### 2. Yield pack (investment property)

1. Value + mortgage link + rent path.
2. Report equity, LTV, gross/net, CoC, carry **or** explicit gaps (missing rent → no yield numbers).

### 3. Second property cost (dual-load)

1. Load **both** skills.
2. Identity + count → Firecrawl IRAS → all-in.
3. Household gaps → scenario with `buy_property` + `one_off` duties → `compare_scenarios`.
4. Report affordability verdict from tool only.

### 4. Total wealth RE sleeve

1. `get_household` — properties, liabilities, cash, deposits, treasury.
2. Physical equity per property (mortgage rules); FX if mixed.
3. Portfolio/REIT MTM: prefer live analyzer/`portfolio_value`; if cost basis only, **label cost basis**. REIT MTM only for holdings user identifies as REITs or tool-backed REIT tickers — never invent a REIT list.
4. total_NW = portfolio + free cash + deposits + property − liability principals (reporting ccy).
5. If FX missing or NW incomplete → **refuse allocation %**; list gaps.

### 5. Hold vs sell checklist

SSD window (verify IRAS this turn), mark vs comps if filters available, carry if rent path works, opportunity cost vs `portfolio_return_annual_pct` if assumptions set. No “must sell” pressure.

---

## Anti-shopping (product stance)

**Out of scope:** multi-unit residential listing hunts, PropertyGuru-style shortlists, layout/interior design, multi-unit HTML listing packs.

**In scope:** a **named** unit or user-supplied price for all-in cost, yield (if rent known), and affordability.

If user insists “what’s on the market / find condos under X”:

1. One-line qualitative framing only if useful.
2. Redirect: name a price/unit for portfolio analysis, **or** use the separate SG property shopping agent for listing hunts.
3. Do **not** invent shortlist tools, multi-unit tables of scraped listings as a product pack, or “viewing this week” funnels.

---

## Financing concepts (not underwriting)

| Concept | Framing |
|---------|---------|
| LTV | Loan-to-value limits vary — cite MAS if giving numbers after verify |
| TDSR | Debt service vs income caps |
| MSR | Mortgage servicing ratio for HDB/EC |
| CPF OA | Housing use under CPF rules; not free cash |

Never approve a loan or claim a bank will lend X.

---

## Related

| Skill | When |
|-------|------|
| `family-treasury` | Books, projections, affordability engine — **dual-load** for SG buy with duties |
| `investment-analysis` | REITs and equities as securities |
| `firecrawl` | Official duty tables, named project pages |
| `bindrive` | Saving HTML reports |

---

## What not to do

- Invent comps, typical town prices, rents, or memory-based stamp rates as authoritative numbers  
- Multi-unit shopping packs / shortlist / layout / interior  
- Auto-update property marks from median comps  
- Skip dual-load on second-property + affordability  
- Replace family-treasury projection math with narrative “you can afford it”  
