import { describe, expect, it } from 'vitest';
import { parseIbkrNavMarks } from '../src/tools/ibkr_nav.js';

describe('IBKR NAV source inspection', () => {
  it('reads dated total equity marks from a multi-day Flex statement', () => {
    const xml = `<FlexStatement><EquitySummaryInBase>
      <EquitySummaryByReportDateInBase accountId="U123" reportDate="20260930" currency="USD" total="1000.25" cash="200" />
      <EquitySummaryByReportDateInBase accountId="U123" reportDate="20261001" currency="USD" total="1010.50" cash="205" />
    </EquitySummaryInBase></FlexStatement>`;
    expect(parseIbkrNavMarks(xml)).toEqual([
      { account_id: 'U123', date: '2026-09-30', currency: 'USD', total: 1000.25 },
      { account_id: 'U123', date: '2026-10-01', currency: 'USD', total: 1010.5 },
    ]);
  });

  it('does not treat a statement without equity summary as NAV history', () => {
    expect(parseIbkrNavMarks('<FlexStatement><CashReport /></FlexStatement>')).toEqual([]);
  });

  it('rejects a missing total rather than silently using cash as NAV', () => {
    expect(() => parseIbkrNavMarks(`<EquitySummaryInBase>
      <EquitySummaryByReportDateInBase accountId="U123" reportDate="20261001" currency="USD" cash="205" />
    </EquitySummaryInBase>`)).toThrow(/invalid account, date, currency, or total/);
  });
});
