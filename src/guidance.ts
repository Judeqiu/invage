/**
 * /guidance — teach users how to use Invester (skills + workflows).
 *
 * Subcommands are free-text after the slash command, e.g.:
 *   /guidance
 *   /guidance portfolio
 *   /guidance research
 */

export const GUIDANCE_SUBCOMMANDS = [
  'start',
  'portfolio',
  'analysis',
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
  if (raw === '3-axis' || raw === 'analyzer' || raw === 'targets') return 'analysis';
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
    'I am your portfolio analyst: track holdings, run 3-axis analysis, research the web, and save reports.',
    '',
    '*Quick start*',
    '• Plain chat: "add 50 AAPL at $180" · "analyze my portfolio" · "what\'s news on NVDA?"',
    '• Slash: `/guidance <topic>` for a focused how-to',
    '',
    '*Topics* (use as subcommands):',
    '• `start` — first-time setup & invite',
    '• `portfolio` — add/update/remove holdings',
    '• `analysis` — 3-axis Laggards / Overpriced / Buy opportunities',
    '• `research` — web search (Firecrawl) + finance sources',
    '• `reports` — BinDrive reports, snapshots, email',
    '• `skills` — skill catalog (what I load for each job)',
    '• `chat` — how to talk to me effectively',
    '• `admin` — invite / admin codes (admins)',
    '',
    'Example: `/guidance portfolio`  ·  `/guidance research`',
  ].join('\n');

const start = (): string =>
  [
    '*Getting started*',
    '',
    '1. *Access* — non-admins need an invite code (`INV-…`). Admins can run `/invitecode` (Slack) to mint one.',
    '2. *Onboarding* — send the code in chat; I collect display name + email, then link your Slack/Telegram ID.',
    '3. *First holdings* — e.g. "Add 100 MSFT at average cost $400 in SL Technology S1"',
    '4. *First analysis* — "Analyze my portfolio" or "Run 3-axis analysis"',
    '5. *Optional research* — "Search web for MSFT earnings guidance"',
    '6. *Save work* — "Save a report to my drive" or "Take a snapshot"',
    '',
    'See also: `/guidance portfolio` · `/guidance analysis` · `/guidance research`',
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
    '*Next*',
    '• `/guidance analysis` — P/L, targets, recommendations',
    '• `/guidance reports` — save HTML report / snapshot',
  ].join('\n');

const analysis = (): string =>
  [
    '*Investment analysis (Invester skill)*',
    '',
    'Skill: *investment-analysis* · Tool: portfolio analyzer (Yahoo Finance live data)',
    '',
    '*Part A — Portfolio 3-axis*',
    '1. *Laggards* — your cost > analyst high target',
    '2. *Overpriced* — price > median target',
    '3. *Buy opportunities* — upside to median > ~15%',
    '',
    '*Part B — Stock evaluation*',
    '• Business + industry lens → statements → valuation range → value/growth/moat → risks',
    '• Live PE/PEG/ROE/targets via analyzer; depth via Firecrawl (10-K, IR)',
    '',
    '*What to say*',
    '• "Analyze my portfolio" / "3-axis analysis"',
    '• "Analyze AAPL" / "Is MSFT overvalued?" / "Full fundamental on NVDA"',
    '• "What are my laggards?" / "Show PE and targets for AAPL, MSFT"',
    '',
    '*Rules*',
    '• No buy/sell story without tool numbers',
    '• Missing data → I say so (no invented quotes)',
    '',
    'News/filings: `/guidance research`',
  ].join('\n');

const research = (): string =>
  [
    '*Web research (Firecrawl + finance sources)*',
    '',
    'Skill: *firecrawl* · Tool: `firecrawl` (search / scrape). Needs FIRECRAWL_API_KEY on the server.',
    '',
    '*What to say*',
    '• "Search the web for NVDA earnings this week"',
    '• "Scrape Yahoo analysis for AAPL and summarize targets"',
    '• "Find 10-K risk factors for MSFT on SEC"',
    '• "What did the Fed say about rates?"',
    '',
    '*Preferred sources I use*',
    '• Quotes/targets first via portfolio analyzer (Yahoo API)',
    '• Narrative: Yahoo Finance pages, SEC EDGAR, company IR, Reuters/CNBC, Finviz, Fed/BLS',
    '',
    '*Flow*',
    '1. search with ticker + company + site filters',
    '2. scrape 1–2 best URLs',
    '3. answer with bullets + source URLs (no invented headlines)',
    '',
    'Portfolio numbers still come from holdings + analyzer — research is context, not cost basis.',
  ].join('\n');

const reports = (): string =>
  [
    '*Reports & BinDrive*',
    '',
    'Skill: *bindrive* · Tools: save report, snapshots, email, framework bindrive_*',
    '',
    '*What to say*',
    '• "Save an analysis report to my drive"',
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
    '• *investment-analysis* — portfolio 3-axis + stock evaluation (valuation, fundamentals, recommendations)',
    '• *firecrawl* — web search/scrape + finance source playbook',
    '• *bindrive* — reports, files, portal tokens',
    '• *getting-started* / *admin* (framework) — user state & invite codes',
    '',
    'Focused how-tos: `/guidance portfolio` · `analysis` · `research` · `reports` · `start`',
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
    'Examples:',
    '• "Add 40 LLY at 780 category SL Healthcare S1"',
    '• "Analyze portfolio and list laggards only"',
    '• "Research latest NEE guidance from IR or SEC"',
    '• "Save report and snapshot today"',
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
    description: 'How to use Invester (portfolio, analysis, research, reports, …)',
    adminOnly: false,
    usageHint: '[start|portfolio|analysis|research|reports|skills|admin|chat]',
    handle: (args: string) => renderGuidance(args),
  };
}
