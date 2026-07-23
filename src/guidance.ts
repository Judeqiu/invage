/**
 * /guidance — teach users how to use Invester (skills + workflows).
 *
 * Subcommands are free-text after the slash command, e.g.:
 *   /guidance
 *   /guidance portfolio
 *   /guidance analysis
 *   /guidance value
 *   /guidance research
 */

export const GUIDANCE_SUBCOMMANDS = [
  'start',
  'portfolio',
  'playbook',
  'analysis',
  'value',
  'research',
  'reports',
  'skills',
  'admin',
  'chat',
] as const;

export type GuidanceSubcommand = (typeof GUIDANCE_SUBCOMMANDS)[number] | 'overview' | 'help';

function normalizeSub(args: string): GuidanceSubcommand {
  const raw = (args || '').trim().toLowerCase().split(/\s+/)[0] || '';
  if (!raw || raw === 'help' || raw === '?' || raw === 'index') return 'overview';
  if (raw === 'onboarding' || raw === 'getting-started' || raw === 'begin') return 'start';
  if (raw === 'holdings' || raw === 'positions' || raw === 'pnl' || raw === 'p/l') return 'portfolio';
  if (
    raw === 'playbook' ||
    raw === 'strategy' ||
    raw === 'risk' ||
    raw === 'philosophy' ||
    raw === 'methodology' ||
    raw === 'preferences' ||
    raw === 'config'
  ) {
    return 'playbook';
  }
  if (
    raw === '3-axis' ||
    raw === 'analyzer' ||
    raw === 'targets' ||
    raw === 'evaluate' ||
    raw === 'news' ||
    raw === 'pead' ||
    raw === 'earnings' ||
    raw === 'catalyst' ||
    raw === 'headline'
  ) {
    return raw === 'news' || raw === 'pead' || raw === 'earnings' || raw === 'catalyst' || raw === 'headline'
      ? 'research'
      : 'analysis';
  }
  if (
    raw === 'undervalued' ||
    raw === 'value-screen' ||
    raw === 'valuescreen' ||
    raw === 'trap' ||
    raw === 'traps' ||
    raw === 'cheap' ||
    raw === 'advanced' ||
    raw === 'screen' ||
    raw === 'discovery'
  ) {
    return 'value';
  }
  if (
    raw === 'firecrawl' ||
    raw === 'web' ||
    raw === 'news' ||
    raw === 'filings' ||
    raw === 'sec' ||
    raw === 'earnings'
  ) {
    return 'research';
  }
  if (raw === 'bindrive' || raw === 'drive' || raw === 'report' || raw === 'snapshot' || raw === 'email') {
    return 'reports';
  }
  if (raw === 'skill' || raw === 'list' || raw === 'catalog') return 'skills';
  if (raw === 'invite' || raw === 'onboard' || raw === 'codes') return 'admin';
  if (raw === 'tips' || raw === 'howto' || raw === 'talk') return 'chat';
  if ((GUIDANCE_SUBCOMMANDS as readonly string[]).includes(raw)) {
    return raw as GuidanceSubcommand;
  }
  return 'overview';
}

const overview = (): string =>
  [
    '*Invester — how to use this agent*',
    '',
    'I am your investment research + portfolio agent: holdings, 3-axis analysis, *advanced value screen* (cheap ∩ quality ∩ trap risk), market themes, and web research — then save reports.',
    '',
    '*Quick start*',
    '• Plain chat: "add 50 AAPL at $180" · "analyze my portfolio" · "which holdings look undervalued?" · "how does this NVDA news affect the trend?" · "how will AI impact the stock market?"',
    '• Slash: `/guidance <topic>` for a focused how-to',
    '',
    '*Topics* (use as subcommands):',
    '• `start` — first-time setup & invite',
    '• `portfolio` — add/update/remove holdings',
    '• `playbook` — investment strategy, risk, buy/sell rules (defaults if unset)',
    '• `analysis` — 3-axis + stock eval + indices + HK/China + options (calls/puts)',
    '• `value` — *advanced* undervalued discovery (value screen, traps, thesis)',
    '• `research` — news→price-path, filings (US/HK/China), themes (AI, rates, earnings…)',
    '• `reports` — BinDrive reports, snapshots, email',
    '• `skills` — skill catalog (what I load for each job)',
    '• `chat` — how to talk to me effectively',
    '• `admin` — invite / admin codes (admins)',
    '',
    '*High leverage*',
    '• Undervalued: "Which of my holdings look undervalued?" → `/guidance value`',
    '• News/trend: "Why did AAPL move?" / "Earnings reaction for MSFT" → `/guidance research`',
    '• Themes: "How will AI affect markets?" → `/guidance research`',
    '• Full analysis stack: `/guidance analysis`',
    '',
    'Example: `/guidance portfolio`  ·  `/guidance value`  ·  `/guidance research`',
  ].join('\n');

const start = (): string =>
  [
    '*Getting started*',
    '',
    '1. *Access* — invite code (`INV-…`) or **demo mode** (admin `/demomode on`). Admins mint invites with `/invitecode`.',
    '2. *Instant join* — invite or demo auto-creates profile from Slack/Telegram name (no Q&A).',
    '3. *First holdings* — e.g. "Add 100 MSFT at average cost $400 in SL Technology S1"',
    '4. *Optional playbook* — "Help me set up my playbook" (patient wizard) or keep balanced defaults',
    '5. *First analysis* — "Analyze my portfolio" (3-axis + value screen, playbook-aware thresholds)',
    '6. *Undervalued sweep* — "Which of my holdings look undervalued?" (uses advanced value system)',
    '7. *Optional research* — "Search web for MSFT earnings guidance" or "Scrape Yahoo key-statistics for AAPL"',
    '8. *Save work* — "Save a report to my drive" or "Take a snapshot"',
    '',
    'See also: `/guidance portfolio` · `/guidance playbook` · `/guidance analysis` · `/guidance value`',
  ].join('\n');

const playbook = (): string =>
  [
    '*Investment Playbook (your methodology)*',
    '',
    'Every investor has a unique methodology. Your playbook steers how I frame research and trade suggestions.',
    'If you never set one, I use a *balanced market-standard* default — no interview required.',
    '',
    '*Guided setup (recommended if you are new)*',
    '• Say: "Help me set up my investment playbook" or "Walk me through my risk and strategy"',
    '• I load the *playbook-setup* skill and ask *one easy question at a time* with plain-English explanations',
    '• Paths: full wizard · quick 3 questions · change one setting · explain current · reset defaults',
    '• You can skip any step, keep defaults, or stop early — I save what you already chose',
    '',
    '*Axes*',
    '• *Strategy* — growth · income · capital_preservation',
    '• *Philosophy* — value_investing · growth_investing · dividend_investing',
    '• *Risk* — conservative · balanced · aggressive (+ position / sector caps)',
    '• *Allocation* — max position %, cash target %, max sector %',
    '• *Buy & sell rules* — your criteria + AI recommendation style',
    '• *Rebalancing* — monthly · quarterly · threshold-based',
    '• *Watchlists* — markets, sectors, themes (default discovery universe)',
    '',
    '*What to say*',
    '• "Help me set up my playbook" / "Quick setup — 3 questions"',
    '• "Show my investment playbook" / "What defaults am I on?"',
    '• "Set risk to conservative" / "Switch philosophy to growth investing"',
    '• "Max position 8%, max sector 25%, cash target 10%"',
    '• "Rebalance quarterly" / "Watch themes: AI, energy transition"',
    '• "Watch markets: US, HK, China" / "Add Hong Kong to my markets"',
    '• "Buy only when trap gate passes and upside > 20%"',
    '• "Reset my playbook to defaults"',
    '',
    '*How I use it*',
    '• BUY/SELL language must respect your buy/sell criteria and risk profile',
    '• Size suggestions stay under position/sector limits (I flag breaches)',
    '• Value vs growth vs dividend changes which metrics count as "cheap"',
    '• Discovery without a ticker prefers your watchlist markets/sectors/themes (US default; HK/CN when set)',
    '• `portfolio_analyzer` on your holdings uses playbook-adjusted thresholds',
    '',
    'See also: `/guidance analysis` · `/guidance value` · `/guidance portfolio`',
  ].join('\n');

const portfolio = (): string =>
  [
    '*Portfolio (holdings)*',
    '',
    'I store positions on your user profile (ticker → avg cost, units, optional category).',
    '',
    '*What to say*',
    '• "Add 50 AAPL at $180" / "Update MSFT to 30 shares @ $420"',
    '• "Add 100 0700.HK at HKD 350" / "Add 50 600519.SS at 1600" (use Yahoo suffixes)',
    '• "Remove TSLA" / "Show my portfolio" / "Clear portfolio" (I will confirm first)',
    '• Category tip: use fund labels like `SL Technology S1`, `SL Healthcare S1`, …',
    '',
    '*What I do*',
    '• Use portfolio tools bound to *your* Slack/Telegram id (never invent another user\'s id)',
    '• Cost basis = avg_price × units (not live market value until analysis)',
    '',
    '*Next — analysis stack*',
    '• `/guidance analysis` — 3-axis P/L vs Street targets',
    '• `/guidance value` — advanced undervalued / trap screen on those holdings',
    '• `/guidance reports` — save HTML report / snapshot',
  ].join('\n');

const analysis = (): string =>
  [
    '*Investment analysis system*',
    '',
    'Skill: *investment-analysis* · Tool: *portfolio_analyzer* (Yahoo Finance live data)',
    '',
    'I use three layers. Use plain English; I load the skill and tools for you.',
    '',
    '── *Part A — Portfolio 3-axis* ──',
    '1. *Laggards* — your cost > analyst high target',
    '2. *Overpriced* — price > median target',
    '3. *Buy opportunities* — upside to median > ~15%',
    '   ↳ Buy language still needs fundamentals / trap check (Part C)',
    '',
    '── *Part B — Stock evaluation* ──',
    '• Business + industry lens → statements → valuation range → value/growth/moat → risks',
    '• Live metrics: PE, forward PE, PEG, P/B, ROE, ROA, FCF yield, EV/EBITDA, leverage, growth',
    '• Depth via Firecrawl: 10-K, IR, Yahoo key-statistics, Finviz (see `/guidance research`)',
    '',
    '── *Part C — Undervalued discovery (advanced)* ──',
    '• Funnel: cheapness ∩ quality/health ∩ value-trap gate ∩ thesis',
    '• Tool emits a *VALUE SCREEN* block: cheapness / quality / trapRisk + signal lines',
    '• Full playbook + example prompts: `/guidance value`',
    '',
    '── *Part D — News → price-path (trend hypothesis)* ──',
    '• Classify event → surprise vs expectations → underreact / overreact / already priced',
    '• Earnings: PEAD-style multi-week *watch* after hard surprises — not next-tick fortune telling',
    '• Full how-to + examples: `/guidance research`',
    '',
    '── *Part E — Index framework* ──',
    '• Evaluate vs fit-for-purpose benchmarks: SPY/QQQ/IWM, sector ETFs, `^HSI`, CSI 300, MCHI/FXI…',
    '• Primary = listing region; secondary = sector/style — not every name vs SPY alone',
    '',
    '── *Part F — Multi-market (US · HK · China)* ──',
    '• Yahoo suffixes: US plain · HK `0700.HK` · Shanghai `600519.SS` · Shenzhen `000001.SZ`',
    '• Dual-list / ADR: compare venues with currency; AH premium only when both quotes sourced',
    '• Filings: SEC (US) · HKEXnews (HK) · CNINFO/SSE/SZSE (A-shares)',
    '',
    '── *Part G — Options (calls & puts)* ──',
    '• Underlying thesis first → strike/expiry → chain scrape for premium/IV (never invent Greeks)',
    '• Long call/put, covered call, protective put, collar — naked shorts discouraged by default',
    '',
    '*What to say*',
    '• "Analyze my portfolio" / "3-axis analysis" / "What are my laggards?"',
    '• "Analyze AAPL" / "Full fundamental on NVDA" / "Show PE and targets for AAPL, MSFT"',
    '• "Analyze 0700.HK" / "Compare BABA vs 9988.HK" / "Is 600519.SS expensive vs CSI 300?"',
    '• "How is NVDA doing vs QQQ and SPY?" / "Benchmark my HK names to Hang Seng"',
    '• "Should I buy calls on AAPL?" / "Protective put on my MSFT?" / "Covered call income ideas"',
    '• "Which of my holdings look undervalued?" / "Is MSFT a value trap?"',
    '• "Why did NVDA move?" / "How does this earnings news affect the trend?"',
    '',
    '*Rules*',
    '• No buy/sell story without tool numbers',
    '• **Every fact in my reply is tool-checked** (quote/scrape) or labeled as hypothesis — I do not invent IPOs, tickers, or prices',
    '• Missing data → I say so (no invented quotes, IV, or Greeks)',
    '• Price drop alone ≠ undervalued; Street upside alone ≠ buy',
    '• Headline alone ≠ guaranteed short-term direction',
    '• Accumulate / average-down only if trap gate allows',
    '• Options need strike/expiry (or explicit structure-only); max loss stated when premium known',
    '',
    'Related: `/guidance value` · `/guidance research` · `/guidance chat`',
  ].join('\n');

const value = (): string =>
  [
    '*Advanced analysis — undervalued discovery*',
    '',
    'This is the high-leverage path: find *mispriced* names, not just stocks that fell.',
    'Skill: *investment-analysis* Part C · Tool: *portfolio_analyzer* value screen',
    '',
    '── *What “undervalued” means here* ──',
    'A candidate must clear all of:',
    '1. *Cheap* on a fit-for-purpose yardstick (earnings, cash flow, book for banks, peers — not price drop alone)',
    '2. *Quality / health* OK or improving (ROE, margins, FCF; not a melting ice cube)',
    '3. *Trap gate* PASS (not structurally broken)',
    '4. *Thesis* — why cheap · what closes the gap · kill criteria',
    '',
    '── *What the analyzer returns* ──',
    'On portfolio or multi-ticker runs you get a *VALUE SCREEN* block:',
    '• `cheapness` = YES | MIXED | NO | UNKNOWN',
    '• `quality` = STRONG | OK | WEAK | UNKNOWN',
    '• `trapRisk` = LOW | ELEVATED | HIGH | UNKNOWN',
    '• Signal lines with live numbers (PE, FCF yield, EV/EBITDA, ROE, D/E, …)',
    '• Per-name metrics: PE / fwd PE / PEG / P/B / ROE / ROA / FCF yield / EV/EBITDA / growth',
    '',
    'Prefer: cheapness YES (or MIXED), trapRisk LOW, quality not WEAK — then deep-dive.',
    'Reject or watch: trapRisk HIGH/ELEVATED even if “cheap”; quality WEAK + cheap = classic *value trap*.',
    '',
    '── *How to leverage it (recipes)* ──',
    '',
    '*1. Holdings undervalued sweep*',
    'Say: "Which of my holdings look undervalued?"',
    '    "Find undervalued ideas in my portfolio"',
    '    "Rank my portfolio by value screen"',
    'I: run analyzer on all holdings → rank VALUE SCREEN → short list → optional deep dive.',
    '',
    '*2. Single-name undervalued / trap verdict*',
    'Say: "Is AAPL undervalued?"',
    '    "Is MSFT a value trap?"',
    '    "Value assessment for JPM"',
    'I: metrics + cheapness/quality/trap + thesis bullets (or WATCH if data incomplete).',
    '',
    '*3. Multi-ticker screen*',
    'Say: "Value screen AAPL, MSFT, JPM, XOM"',
    '    "Compare undervaluation for these tickers: …"',
    'I: analyzer on the list → ranked VALUE SCREEN → call out traps vs candidates.',
    '',
    '*4. Buy / average-down discipline*',
    'Say: "Should I average down on BA?"',
    'I: 3-axis + trap gate — refuse size-up if trap FAIL/WATCH without thesis.',
    '',
    '*5. Deep value with filings*',
    'Say: "Is KO undervalued? Pull key-statistics and 10-K risks"',
    'I: analyzer first, then Firecrawl (Yahoo stats / Finviz / SEC) for narrative and extra fields.',
    '',
    '── *Industry yardsticks (I choose automatically)* ──',
    '• Banks / financials → P/B + ROE (not EV/EBITDA alone)',
    '• Software / asset-light → FCF / growth multiples (not book)',
    '• Most operating cos → PE, fwd PE, FCF yield, EV/EBITDA when present',
    '• Utilities / financials excluded from Magic Formula–style ROC ranking',
    '',
    '── *What I will not do* ──',
    '• Call a stock undervalued only because it dropped',
    '• Dump an unfiltered screener list as “buys”',
    '• Invent PE, FCF, EV/EBITDA, or F-Scores',
    '• Promise guaranteed outperformance — process + ranges + risks only',
    '',
    '── *After the screen* ──',
    '• "Deep dive on the top 3 undervalued names"',
    '• "Save this value analysis as an HTML report"',
    '• "Take a portfolio snapshot"',
    '',
    'Basics: `/guidance analysis`  ·  Research depth: `/guidance research`  ·  Holdings: `/guidance portfolio`',
  ].join('\n');

const research = (): string =>
  [
    '*Research, news → price-path & market themes*',
    '',
    'Skills: *firecrawl* (sources) + *investment-analysis* Part D (news → trend hypothesis).',
    'Tool: `firecrawl` search/scrape + `portfolio_analyzer` for live metrics. Needs FIRECRAWL_API_KEY.',
    '',
    '── *News → stock trend (smart path analysis)* ──',
    'I do **not** promise next-tick predictions. I structure:',
    '1. Primary source (PR / 8-K / IR / Reuters) + facts/numbers',
    '2. Event class (earnings, guidance, M&A, product, macro, pure narrative…)',
    '3. Surprise vs expectations when sourced',
    '4. **Regime:** underreaction | overreaction | already priced | unknown',
    '5. **Horizon:** days–weeks (e.g. PEAD watch after hard earnings) vs multi-quarter fundamental path',
    '6. Value/trap gate before any buy language',
    '',
    '*What to say*',
    '• "Why did NVDA move today?"',
    '• "AAPL reported earnings — how does this affect the trend?"',
    '• "Should I buy the dip after this bad news on BA?"',
    '• "Analyze the price path after MSFT guidance cut"',
    '',
    '*Priors I use*',
    '• Hard public news → possible multi-day/week **drift** (esp. earnings surprises / PEAD)',
    '• Big move with **no** fundamental news → possible **reversal** hypothesis',
    '• Mega-cap first headline → often **already priced** for retail; don\'t chase',
    '• Soft media/opinion → weak signal; extreme sentiment can reverse',
    '',
    '── *Company / filings* ──',
    '• "Search the web for NVDA earnings this week"',
    '• "Scrape Yahoo key-statistics for MSFT"',
    '• "Find 10-K risk factors for MSFT on SEC"',
    '• "Find 0700.HK latest interim on HKEXnews"',
    '• "Pull 600519.SS annual report announcement (CNINFO)"',
    '',
    '── *Multi-market & indices* ──',
    '• "Compare Tencent 0700.HK vs Hang Seng"',
    '• "BABA vs 9988.HK dual listing"',
    '• "Screen liquid Hang Seng / CSI 300 value ideas" (playbook markets HK/CN help)',
    '',
    '── *Options (chain via Yahoo scrape)* ──',
    '• "Scrape AAPL options chain for next expiry"',
    '• "Long call structure on SPY after analyzing the underlying"',
    '',
    '── *Macro & themes (in scope)* ──',
    '• "What did the Fed say about rates?"',
    '• "How will AI impact the stock market?"',
    '• "What sectors benefit from AI capex?"',
    '',
    'Theme answers: thesis, transmission channels, illustrative winners/losers, risks, sources.',
    '',
    '── *With value analysis* ──',
    '• "Is X undervalued after this news?" → Part D path + Part C value/trap',
    '• Analyzer metrics first → Firecrawl for primary news',
    '',
    '*Flow (single-name news)*',
    '1. scrape primary source',
    '2. portfolio_analyzer on ticker',
    '3. Part D news-path verdict + sources',
    '',
    'Not tax advice / not trade execution. Value: `/guidance value` · Analysis stack: `/guidance analysis`',
  ].join('\n');

const reports = (): string =>
  [
    '*Reports & BinDrive*',
    '',
    'Skill: *bindrive* · Tools: save report, snapshots, email, framework bindrive_*',
    '',
    '*What to say*',
    '• "Save an analysis report to my drive" (`save_report` kind=analysis)',
    '• "Show my portfolio dashboard" / "Save a value-change dashboard" (`save_report` kind=dashboard)',
    '• WebUI: open the **Dashboard** tab (live value + history; refresh for new prices)',
    '• "Save this value screen / undervalued short list as HTML"',
    '• "Give me this as an HTML report" / "Post HTML of the full analysis"',
    '• "Take a portfolio snapshot" / "List my snapshots" (snapshots feed dashboard history)',
    '• "Email the analysis/dashboard report to me" (`send_report` kind=analysis|dashboard; uses profile email when possible)',
    '• "List files in my drive"',
    '',
    '*HTML in Slack*',
    '• Ask explicitly for **HTML** → I publish a browser page + link (opens correctly on phone)',
    '• Do not open Slack’s file preview for .html (it shows source); use the view link',
    '',
    '*Where files live*',
    '• Your BinDrive folder on InvesterDrive (web portal + bot tools)',
    '• HTML reports get a short-lived signed view link when configured',
    '',
    'Portal (deploy): often `http://host:3001` — login with your user auth token from onboarding.',
  ].join('\n');

const skills = (): string =>
  [
    '*Skills catalog*',
    '',
    'I load skills on demand (specialist knowledge). You don\'t call them by name — just ask; I load the right one.',
    '',
    '• *investment-analysis* — portfolio 3-axis + stock evaluation + undervalued + **news→path** + **indices** + **HK/China** + **options**',
    '  ↳ Part A: Laggards / Overpriced / Buy opportunities',
    '  ↳ Part B: full name evaluation (industry lens, valuation, moat)',
    '  ↳ Part C: advanced value funnel (cheap ∩ quality ∩ trap + thesis)',
    '  ↳ Part D: news → price-path (under/overreaction, PEAD watch, earnings)',
    '  ↳ Part E: index framework (SPY/QQQ/HSI/CSI 300/sector & style ETFs)',
    '  ↳ Part F: multi-market US · HK · China A/H · dual-list/ADR',
    '  ↳ Part G: options calls/puts (structure, IV when scraped, hedges)',
    '  ↳ Tool: portfolio_analyzer VALUE SCREEN (cheapness / quality / trapRisk)',
    '• *playbook-setup* — patient wizard for strategy / risk / buy-sell / watchlists (user-initiated)',
    '  ↳ One easy question per turn · get_playbook / update_playbook · `/guidance playbook`',
    '  ↳ Watchlist markets: US, HK, CN/China (discovery universe)',
    '• *firecrawl* — primary news, filings (SEC/HKEX/CNINFO), options chains, themes (pair with D/F/G)',
    '• *bindrive* — reports, files, portal tokens',
    '• *getting-started* / *admin* (framework) — user state & invite codes',
    '',
    'Focused how-tos: `/guidance portfolio` · `playbook` · `analysis` · `value` · `research` · `reports` · `start`',
  ].join('\n');

const admin = (): string =>
  [
    '*Admin commands*',
    '',
    'Requires admin (bootstrap TELEGRAM_ADMIN_IDS / SLACK_ADMIN_IDS or ADM- code).',
    '',
    '*Slack*',
    '• `/invitecode [comment]` — mint user invite (`INV-…`)  ⚠️ not `/invite` (reserved by Slack)',
    '• `/invites [all|unused|used]` — list invites',
    '• `/admincode [comment]` — mint admin onboard (`ADM-…`)',
    '• `/admincodes` · `/revoke ADM-…`',
    '• `/demomode on|off|status` — when **on**, anyone can chat; missing profiles auto-created',
    '• `/list` · `/get <slug>`',
    '',
    '*Telegram* (when enabled)',
    '• Same ideas via `/invite`, `/invites`, `/admincode`, `/demomode`, …',
    '',
    'Users redeem by pasting an invite in a DM, or join freely while demo mode is on.',
  ].join('\n');

const chat = (): string =>
  [
    '*How to talk to Invester*',
    '',
    '• Be concrete: ticker, shares, avg cost, category',
    '• One job per message when possible ("analyze" then "save report")',
    '• I use tools **before** stating market facts (prices, IPO status, filings) — wait for the reply; challenge me if something looks invented',
    '• I **never** cold-ask name/email/"do you have a portfolio?" or process menus for research. I *will* ask one easy playbook question at a time if *you* start setup ("help me set my playbook").',
    '• Slack: reactions (👀 → work → done) when scopes allow',
    '• Don\'t paste secrets or other people\'s auth tokens',
    '',
    '*Leverage advanced analysis*',
    '• Prefer explicit asks: "undervalued", "value screen", "value trap", "average down?"',
    '• After a screen: "deep dive top 3" · "compare trap risk" · "save HTML report"',
    '• Combine: "Is KO undervalued? Pull key-statistics and 10-K risks"',
    '• Multi-market: use Yahoo suffixes (`0700.HK`, `600519.SS`); "vs Hang Seng / CSI 300"',
    '• Options: name underlying + call/put + strike/expiry when you can; "protective put on my shares"',
    '',
    '*News → trend (also in scope)*',
    '• "Why did NVDA move?" / "Earnings reaction — what\'s the path hypothesis?"',
    '• "Should I buy after this headline?" → I apply path regime + value/trap gates',
    '',
    '*Market themes (also in scope)*',
    '• "How will AI impact the stock market?" / "What does that mean for my portfolio?"',
    '• "Which sectors are exposed to rate cuts / AI capex / regulation?"',
    '',
    '*Examples*',
    '• "Add 40 LLY at 780 category SL Healthcare S1"',
    '• "Analyze portfolio and list laggards only"',
    '• "Which of my holdings look undervalued?"',
    '• "Value screen AAPL, MSFT, JPM"',
    '• "Is BA a value trap? Should I average down?"',
    '• "AAPL earnings just dropped — analyze the price trend path"',
    '• "Help me understand how AI will impact the stock market"',
    '• "Research latest NEE guidance from IR or SEC"',
    '• "Save report and snapshot today"',
    '',
    'Playbooks: `/guidance value` · `/guidance analysis` · `/guidance research`',
  ].join('\n');

/**
 * Render guidance text for slash command args or free-text topic.
 */
export function renderGuidance(args: string = ''): string {
  const sub = normalizeSub(args);
  switch (sub) {
    case 'start':
      return start();
    case 'portfolio':
      return portfolio();
    case 'playbook':
      return playbook();
    case 'analysis':
      return analysis();
    case 'value':
      return value();
    case 'research':
      return research();
    case 'reports':
      return reports();
    case 'skills':
      return skills();
    case 'admin':
      return admin();
    case 'chat':
      return chat();
    case 'help':
    case 'overview':
    default:
      // Unknown topic → overview + hint
      if (args.trim() && sub === 'overview' && args.trim().toLowerCase() !== 'help') {
        return [
          `Unknown topic \`${args.trim()}\`.`,
          '',
          overview(),
        ].join('\n');
      }
      return overview();
  }
}

/** Single domain command descriptor for both Slack and Telegram. */
export function createGuidanceCommand(): {
  name: string;
  description: string;
  adminOnly: boolean;
  usageHint: string;
  handle: (args: string) => string;
} {
  return {
    name: 'guidance',
    description:
      'How to use Invester: portfolio, playbook, 3-axis analysis, value screen, research, reports',
    adminOnly: false,
    usageHint: '[start|portfolio|playbook|analysis|value|research|reports|skills|admin|chat]',
    handle: (args: string) => renderGuidance(args),
  };
}
