import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

const source = readFileSync('webui/report.js', 'utf8');
const card = source.slice(source.indexOf('function cssBarCard('), source.indexOf('function coverageForUnderlying('));
function render(rows: unknown[], expansion = new Map()) {
  return runInNewContext(`${card};cssBarCard('Premium', rows, 'Before fees', options)`, {
    rows, options: { id: 'premium', ccy: 'USD', yearGroups: true, yearExpansion: expansion },
    esc: (s: unknown) => String(s), fmtPrettyMoney: (n: number) => n.toFixed(2),
  });
}
it('groups all recorded months by year without losing signed values or unavailable totals', () => {
  const rows = [
    { year: '2026', label: 'Nov 2026', value: 6142, display: '6142' },
    { year: '2026', label: 'Oct 2026', value: 117635, display: '117635' },
    { year: '2026', label: 'Sep 2026', value: -2000, display: '-2000' },
    { year: '2025', label: 'Dec 2025', value: 0, display: '0' },
    { year: '2025', label: 'Nov 2025', value: null, display: '—' },
  ];
  const html = render(rows);
  expect(html).toContain('121777.00');
  expect(html).toContain('Unavailable');
  expect(html.match(/class="bar-row"/g)).toHaveLength(5);
  expect(html.match(/data-year="\d{4}" open/g)).toHaveLength(2);
  const collapsed = render(rows, new Map([['2026', false]]));
  expect(collapsed).toContain('data-year="2026"><summary>');
  expect(collapsed).toContain('data-year="2025" open');
});
