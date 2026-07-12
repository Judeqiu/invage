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
  if (raw === '3-axis' || raw === 'analyzer' || raw === 'targets' || raw === 'evaluate') {
    return 'analysis';
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
    '• Plain chat: "add 50 AAPL at $180" · "analyze my portfolio" · "which holdings look undervalued?" · "how will AI impact the stock market?" · "what\'s news on NVDA?"',
    '• Slash: `/guidance <topic>` for a focused how-to',
    '',
    '*Topics* (use as subcommands):',
    '• `start` — first-time setup & invite',
    '• `portfolio` — add/update/remove holdings',
    '• `analysis` — 3-axis + full stock evaluation system',
    '• `value` — *advanced* undervalued discovery (value screen, traps, thesis)',
    '• `research` — web search, filings, *and market themes* (AI, rates, sectors, …)',
    '• `reports` — BinDrive reports, snapshots, email',
    '• `skills` — skill catalog (what I load for each job)',
    '• `chat` — how to talk to me effectively',
    '• `admin` — invite / admin codes (admins)',
    '',
    '*High leverage*',
    '• Undervalued: "Which of my holdings look undervalued?" → `/guidance value`',
    '• Themes: "How will AI / rates / regulation affect markets?" → `/guidance research` (in scope)',
    '• Full analysis stack: `/guidance analysis`',
    '',
    'Example: `/guidance portfolio`  ·  `/guidance value`  ·  `/guidance research`',
  ].join('\n');

const start = (): string =>
  [
    '*Getting started*',
    '',
    '1. *Access* — non-admins need an invite code (`INV-…`). Admins can run `/invitecode` (Slack) to mint one.',
    '2. *Onboarding* — send the code in chat; I collect display name + email, then link your Slack/Telegram ID.',
    '3. *First holdings* — e.g. "Add 100 MSFT at average cost $400 in SL Technology S1"',
    '4. *First analysis* — "Analyze my portfolio" (3-axis + value screen on every holding)',
    '5. *Undervalued sweep* — "Which of my holdings look undervalued?" (uses advanced value system)',
    '6. *Optional research* — "Search web for MSFT earnings guidance" or "Scrape Yahoo key-statistics for AAPL"',
    '7. *Save work* — "Save a report to my drive" or "Take a snapshot"',
    '',
    'See also: `/guidance portfolio` · `/guidance analysis` · `/guidance value` · `/guidance research`',
  ].join('\n');

const portfolio = (): string =>
  [
    '*Portfolio (holdings)*',
    '',
    'I store positions on your user profile (ticker → avg cost, units, optional category).',
    '',
    '*What to say*',
    '• "Add 50 AAPL at $180" / "Update MSFT to 30 shares @ $420"',
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
    '*What to say*',
    '• "Analyze my portfolio" / "3-axis analysis" / "What are my laggards?"',
    '• "Analyze AAPL" / "Full fundamental on NVDA" / "Show PE and targets for AAPL, MSFT"',
    '• "Which of my holdings look undervalued?" / "Is MSFT a value trap?"',
    '',
    '*Rules*',
    '• No buy/sell story without tool numbers',
    '• Missing data → I say so (no invented quotes)',
    '• Price drop alone ≠ undervalued; Street upside alone ≠ buy',
    '• Accumulate / average-down only if trap gate allows',
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
    '*Web research & market themes (Firecrawl + finance sources)*',
    '',
    'Skill: *firecrawl* · Tool: `firecrawl` (search / scrape). Needs FIRECRAWL_API_KEY on the server.',
    '',
    'Use research for news, filings, macro, *and* investment themes (how trends may affect markets).',
    'Quotes/metrics for specific tickers still prefer portfolio analyzer first.',
    '',
    '*Company / filings*',
    '• "Search the web for NVDA earnings this week"',
    '• "Scrape Yahoo analysis for AAPL and summarize targets"',
    '• "Scrape Yahoo key-statistics for MSFT"',
    '• "Find 10-K risk factors for MSFT on SEC"',
    '',
    '*Macro*',
    '• "What did the Fed say about rates?"',
    '• "How do rate cuts usually affect utilities vs growth tech?"',
    '',
    '*Market themes (in scope — I will not refuse these)*',
    '• "Help me understand how AI\'s future will impact the stock market"',
    '• "What sectors benefit most from AI capex?"',
    '• "How might regulation / geopolitics hit semiconductors?"',
    '• "Is the market pricing a soft landing?"',
    '',
    'Theme answers cover: thesis, transmission channels (earnings/multiples/capex), illustrative winners/losers, risks, sources. Optional: map exposure to *your* holdings.',
    '',
    '*With advanced value analysis*',
    '• "Is X undervalued? Also scrape Finviz and key-statistics"',
    '• "Value trap check on Y with 10-K risks"',
    '• Analyzer first (cheapness/quality/trap) → Firecrawl for filings/IR confirmation',
    '',
    '*Preferred sources*',
    '• Live metrics: portfolio analyzer (Yahoo API)',
    '• Narrative: Yahoo Finance, SEC EDGAR, company IR, Reuters/CNBC, Finviz, Fed/BLS',
    '',
    '*Flow*',
    '1. search with ticker/theme + site filters',
    '2. scrape 2–4 best URLs for themes (1–2 for simple news)',
    '3. answer with bullets + source URLs (no invented headlines)',
    '',
    'Not tax advice / not trade execution. Value playbook: `/guidance value`',
  ].join('\n');

const reports = (): string =>
  [
    '*Reports & BinDrive*',
    '',
    'Skill: *bindrive* · Tools: save report, snapshots, email, framework bindrive_*',
    '',
    '*What to say*',
    '• "Save an analysis report to my drive"',
    '• "Save this value screen / undervalued short list as HTML"',
    '• "Give me this as an HTML report" / "Post HTML of the full analysis"',
    '• "Take a portfolio snapshot" / "List my snapshots"',
    '• "Email the report to me" (uses your profile email when possible)',
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
    '• *investment-analysis* — portfolio 3-axis + stock evaluation + undervalued discovery',
    '  ↳ Part A: Laggards / Overpriced / Buy opportunities',
    '  ↳ Part B: full name evaluation (industry lens, valuation, moat)',
    '  ↳ Part C: advanced value funnel (cheap ∩ quality ∩ trap + thesis)',
    '  ↳ Tool: portfolio_analyzer VALUE SCREEN (cheapness / quality / trapRisk)',
    '• *firecrawl* — web search/scrape + finance sources + *market themes* (AI, rates, sectors)',
    '• *bindrive* — reports, files, portal tokens',
    '• *getting-started* / *admin* (framework) — user state & invite codes',
    '',
    'Focused how-tos: `/guidance portfolio` · `analysis` · `value` · `research` · `reports` · `start`',
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
    '• `/list` · `/get <slug>`',
    '',
    '*Telegram* (when enabled)',
    '• Same ideas via `/invite`, `/invites`, `/admincode`, …',
    '',
    'Users redeem by pasting the code in a DM.',
  ].join('\n');

const chat = (): string =>
  [
    '*How to talk to Invester*',
    '',
    '• Be concrete: ticker, shares, avg cost, category',
    '• One job per message when possible ("analyze" then "save report")',
    '• I may use tools first (no filler); wait for the reply',
    '• Slack: reactions (👀 → work → done) when scopes allow',
    '• Don\'t paste secrets or other people\'s auth tokens',
    '',
    '*Leverage advanced analysis*',
    '• Prefer explicit asks: "undervalued", "value screen", "value trap", "average down?"',
    '• After a screen: "deep dive top 3" · "compare trap risk" · "save HTML report"',
    '• Combine: "Is KO undervalued? Pull key-statistics and 10-K risks"',
    '',
    '*Market themes (also in scope)*',
    '• "How will AI impact the stock market?" / "What does that mean for my portfolio?"',
    '• "Which sectors are exposed to rate cuts / AI capex / regulation?"',
    '• I research with sources — I do not brush these off as off-topic',
    '',
    '*Examples*',
    '• "Add 40 LLY at 780 category SL Healthcare S1"',
    '• "Analyze portfolio and list laggards only"',
    '• "Which of my holdings look undervalued?"',
    '• "Value screen AAPL, MSFT, JPM"',
    '• "Is BA a value trap? Should I average down?"',
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
      'How to use Invester: portfolio, 3-axis analysis, advanced undervalued value screen, research, reports',
    adminOnly: false,
    usageHint: '[start|portfolio|analysis|value|research|reports|skills|admin|chat]',
    handle: (args: string) => renderGuidance(args),
  };
}
