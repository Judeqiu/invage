import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

const source = readFileSync('webui/report.js', 'utf8');
const card = source.slice(source.indexOf('function cssBarCard('), source.indexOf('function coverageForUnderlying('));
function render(rows: unknown[], expansion = new Map(), extra = {}) {
  return runInNewContext(`${card};cssBarCard('Premium', rows, 'Before fees', options)`, {
    rows, options: { id: 'premium', ccy: 'USD', yearGroups: true, yearExpansion: expansion, ...extra },
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

it('previews months per year while retaining full totals and every signed row behind Show more', () => {
  const rows = Array.from({length: 8}, (_, i) => ({year:'2026',label:`month-${i}`,value:i-4,display:String(i-4)}));
  const html = render(rows, new Map(), {limit:5});
  expect(html).toContain('-4.00');
  expect(html).toContain('Show 3 more');
  expect(html).toContain('Show less');
  expect(html.match(/class="bar-row"/g)).toHaveLength(rows.length);
  expect(html).toContain('data-expansion-key="premium:2026"><summary>');
  const expanded = render(rows,new Map(),{limit:5,rowExpansion:new Map([['premium:2026',true]])});
  expect(expanded).toContain('data-expansion-key="premium:2026" open');
  expect(render(rows.slice(0,5),new Map(),{limit:5})).not.toContain('Show less');
});
