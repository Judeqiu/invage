import type { ChatQuestionLibraryConfig, QuestionPreset } from 'utarus';

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
] as const;

/** Persistent composer library; selection prepares a draft and never sends it. */
export function createInvageChatQuestionLibrary(): ChatQuestionLibraryConfig {
  return {
    enabled: true,
    mode: 'preset',
    categories: GROUPS.map(({ id, label }) => ({ id, label })),
    capabilities: [{
      id: 'options_journal.read',
      description: 'Review the user’s recorded option trades, journal notes, positions, and sourced market data. Call out missing history or data; never invent outcomes or execute trades.',
    }],
    presets: GROUPS.flatMap((group) => group.questions.map(([id, title, template]): QuestionPreset => ({
      id,
      categoryId: group.id,
      title,
      description: template.replaceAll('{ticker}', '[ticker]'),
      template,
      capabilityIds: ['options_journal.read'],
      ...(template.includes('{ticker}') ? {
        fields: [{ id: 'ticker', type: 'text', label: 'Ticker (e.g. TSLA)', required: true, maxLength: 12 }],
      } : {}),
    }))),
  };
}
