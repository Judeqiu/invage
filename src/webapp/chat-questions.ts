import { randomInt } from 'node:crypto';
import { readProductProfile, type ProductProfileId } from '../agents/roster.js';
import type { ChatEmptyStarter, ChatQuestionLibraryConfig, QuestionPreset } from 'utarus';

// Preset wording and grouping from https://velovest-ai.lovable.app/chat.
// The host supports these options/journal questions in both product profiles.
const GROUPS = [
  {
    id: 'setup_strike',
    label: 'Setup & strike selection',
    questions: [
      ['put_vs_call', 'Cash-secured put vs covered call', 'Cash-secured put vs covered call on {ticker} — what does my own record show?'],
      ['strike_dte', 'Historical strike and DTE', 'What strike and DTE have historically worked best for me on {ticker}?'],
      ['iv_rank', 'IV Rank versus my usual entries', "Is today's IV Rank on {ticker} high or low versus the levels I usually sell at?"],
      ['last_put', 'Last put: break-even and outcome', 'What was my break-even and outcome the last time I sold a put on {ticker}?'],
      ['buying_power', 'Buying power tied up', 'How much buying power do my {ticker} trades typically tie up?'],
    ],
  },
  {
    id: 'technical_analysis',
    label: 'Technical analysis',
    questions: [
      ['support_resistance', 'Support versus resistance trades', 'How did my {ticker} trades around support lines perform versus resistance-line trades?'],
      ['support_assignment', 'Put assignment near support', 'When I sold puts on {ticker} near support, how often was I assigned?'],
      ['granville_volume', 'Granville-style volume analysis', 'What does my Granville-style volume analysis say about {ticker} entries?'],
      ['calls_resistance', 'Short calls at resistance', 'How did my {ticker} short calls perform when price was at resistance?'],
      ['break_even_trend', 'Break-even holds and trends', 'Did my break-even holds on {ticker} coincide with trend reversals or continuations?'],
      ['overbought_oversold', 'Overbought / oversold before losses', "How often did I mention 'overbought' or 'oversold' on {ticker} before a losing trade?"],
    ],
  },
  {
    id: 'assignment_rolls_wheel',
    label: 'Assignment, rolls & wheel',
    questions: [
      ['assignment_history', 'Assignment history and aftermath', 'How often have I been assigned on {ticker}, and what happened after?'],
      ['roll_history', 'Historical roll performance', 'How have my rolls on {ticker} performed historically?'],
      ['concentration_wheel', 'Concentration and wheel cycle', 'Where does {ticker} sit in my concentration and wheel cycle right now?'],
    ],
  },
  {
    id: 'psychology_review',
    label: 'Psychology & review',
    questions: [
      ['emotional_tags', 'Costliest emotional tags', 'Which emotional tags have cost me the most money?'],
      ['repeated_mistakes', 'Repeated mistakes this year', 'Summarise the mistakes I repeated most often this year.'],
      ['setup_win_rate', 'Technical setup win rates', 'Which technical setup in my journal had the highest win rate?'],
      ['profitable_thesis', 'Technical notes before profitable exits', 'What technical notes in my thesis were most often followed by profitable exits?'],
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    questions: [
      ['stock_research_report', 'Stock research report', 'Generate an HTML stock research report for {ticker}. Include company and financial data, valuation, a transparent peer ranking, catalysts, risks, sources and dates. Deliver the report link here in chat so I can open it in the side panel.'],
      ['risk_scenarios_report', 'Create my Risk & scenarios report', 'Create my Risk & scenarios report for all accounts with a 5-trading-day horizon and show it in the sidebar.'],
      ['option_index_report', 'Options with calculated risk indexes', 'Create an options risk-index report for all my recorded open option positions. Automatically fetch the market inputs, calculate an index for each contract using its recorded side, show contract counts, stress losses, quote dates and any unavailable scores, and open the report in the sidebar. Do not ask me to fill in a calculator.'],
    ],
  },
] as const;

function questionGroups(profile: ProductProfileId = readProductProfile()) {
  return GROUPS.map(group => ({ ...group, questions: group.questions.filter(([id]) =>
    id !== 'stock_research_report' || profile === 'consultant') }));
}

/** Empty-chat cards share the composer presets; ticker selection happens in chat. */
export function createInvageChatQuestionStarters(profile: ProductProfileId = readProductProfile()): ChatEmptyStarter[] {
  return questionGroups(profile).flatMap((group) => group.questions.map(([id, title, template]) => ({
    id: `question_${id}`,
    label: id === 'option_index_report' || id === 'stock_research_report' ? title : template.replaceAll('{ticker}', '[ticker]'),
    description: group.label,
    message: template.includes('{ticker}')
      ? `${template.replaceAll('{ticker}', 'the ticker I choose')} First ask me which ticker to use.`
      : template,
  })));
}

/** Startup must check every possible card, before manifest sampling hides any. */
export function assertInvageChatQuestionCatalog(
  catalog: Record<string, string>,
  profile: ProductProfileId = readProductProfile(),
): void {
  const missing = createInvageChatQuestionStarters(profile).flatMap(starter =>
    ['label', 'description', 'message'].map(field => `chat.empty.starter.${starter.id}.${field}`),
  ).filter(key => typeof catalog[key] !== 'string' || !catalog[key].trim());
  if (missing.length) {
    throw new Error(`Missing chat question catalog entries for ${profile}: ${missing.join(', ')}`);
  }
}

/** Sample four distinct questions each time a page requests its WebUI manifest. */
export function sampleInvageChatQuestionStarters(): ChatEmptyStarter[] {
  const starters = createInvageChatQuestionStarters();
  for (let i = 0; i < 4; i++) {
    const selected = randomInt(i, starters.length);
    [starters[i], starters[selected]] = [starters[selected], starters[i]];
  }
  return starters.slice(0, 4);
}

/** Persistent composer library; selection prepares a draft and never sends it. */
export function createInvageChatQuestionLibrary(): ChatQuestionLibraryConfig {
  return {
    enabled: true,
    mode: 'preset',
    categories: questionGroups().map(({ id, label }) => ({ id, label })),
    capabilities: [{
      id: 'options_journal.read',
      description: 'Review the user’s recorded option trades, journal notes, positions, and sourced market data. Call out missing history or data; never invent outcomes or execute trades.',
    }, ...(readProductProfile() === 'consultant' ? [{
      id: 'stock_research.public',
      description: 'Generate a sourced public company research report with dated financials and a disclosed peer-screen methodology through the stock research workflow. No broker or private account records are needed.',
    }] : [])],
    presets: questionGroups().flatMap((group) => group.questions.map(([id, title, template]): QuestionPreset => ({
      id,
      categoryId: group.id,
      title,
      description: id === 'stock_research_report'
        ? 'Research company financials, valuation, peers, catalysts and risks, with dated sources in an HTML side-panel report.'
        : id === 'option_index_report'
        ? 'Automatically score recorded open options and show their calculated indexes, stress losses, quote dates and data gaps in a sidebar report.'
        : template.replaceAll('{ticker}', '[ticker]'),
      template,
      capabilityIds: [id === 'stock_research_report' ? 'stock_research.public' : 'options_journal.read'],
      ...(template.includes('{ticker}') ? {
        fields: [{ id: 'ticker', type: 'text', label: 'Ticker (e.g. TSLA)', required: true, maxLength: 12 }],
      } : {}),
    }))),
  };
}
