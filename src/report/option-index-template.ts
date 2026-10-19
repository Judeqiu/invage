import type { OptionIndexResult } from '../risk/option-index.js';

export interface OptionIndexReportRow {
  id: string; account: string; contract: string; side: 'long' | 'short'; quantity: number;
  result: OptionIndexResult | null; error: string | null;
}
const esc = (v: unknown) => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const money = (n: number) => `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
export function buildOptionIndexReport(rows: OptionIndexReportRow[], generatedAt = new Date().toISOString()): string {
  const scoreOf = (r: OptionIndexReportRow) => r.result?.scores.find(s => s.side === r.side);
  const supported = rows.filter(r => scoreOf(r)), unbounded = supported.filter(r => scoreOf(r)!.unboundedLoss).length;
  const sorted = [...rows].sort((a, b) => (scoreOf(b)?.index ?? -1) - (scoreOf(a)?.index ?? -1));
  const body = sorted.map(r => {
    const s = scoreOf(r), unavailable = r.error || 'Score unavailable';
    return `<tr><td>${esc(r.account)}</td><td>${esc(r.contract)}<small>${esc(r.id)}</small></td><td>${esc(r.side)}</td><td>${esc(r.quantity)}</td>` +
      (s ? `<td class="index">${s.index.toFixed(2)}%</td><td>${esc(money(s.stressLoss))}</td><td>${esc(money(s.stressLoss * r.quantity))}</td><td>${s.unboundedLoss ? '<strong class="danger">UNBOUNDED</strong>' : esc(money(s.maximumLoss! * r.quantity))}</td>`
        : `<td colspan="4">Unavailable: ${esc(unavailable)}</td>`) + '</tr>';
  }).join('');
  const evidence = rows.map(r => `<details><summary>${esc(r.contract)} · ${esc(r.side)} · ${esc(r.account)}</summary>` +
    (r.result ? `<p>Option last trade: ${esc(r.result.market.optionAsOf)}. Underlying quote: ${esc(r.result.market.spotAsOf)}.</p><p>${esc(r.result.market.source)}. IV ${(r.result.market.impliedVolatility * 100).toFixed(2)}%; IV timestamp unavailable.</p><p>${esc(r.result.market.rateReference)}.</p><p>${esc(r.result.market.dividendReference)}.</p><p>Estimated exit cost per contract: ${esc(money(r.result.assumptions.estimatedExitCost))}. ${esc(r.result.assumptions.costReference)}.</p><ul>${r.result.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>`
      : `<p>Unavailable: ${esc(r.error || 'No verified score')}</p>`) + '</details>').join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Options risk-index report</title>
<style>body{font:15px/1.6 system-ui,sans-serif;background:#f7fafe;color:#172033;margin:0}main{max-width:1500px;margin:auto;padding:32px 24px}h1{font:40px Georgia,serif;margin:12px 0}h2{font:28px Georgia,serif}.muted,small{color:#626c81}small{display:block;overflow-wrap:anywhere}.cards{display:flex;gap:16px;flex-wrap:wrap;margin:24px 0}.card{background:white;border:1px solid #d8e0ed;border-radius:12px;padding:18px;flex:1;min-width:150px}.value{font-size:30px}.table{overflow:auto;background:white;border:1px solid #d8e0ed;border-radius:12px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:12px;text-align:left;border-bottom:1px solid #e5e9ef;vertical-align:top}th{white-space:nowrap}.index{font-size:20px;color:#5147d8}.danger{color:#c6002c}details{background:white;border:1px solid #d8e0ed;border-radius:8px;padding:14px;margin:12px 0}summary{cursor:pointer;font-weight:600}p{max-width:1100px}li{margin:6px 0}footer{font-size:12px;color:#626c81;margin-top:32px}</style></head><body><main>
<p class="muted">Velovest · ${esc(generatedAt)}</p><h1>Options risk-index report</h1>
<p>Calculated indexes for recorded open option lots. Market inputs are fetched automatically. No manual calculator inputs.</p>
<div class="cards"><div class="card">Recorded lots<div class="value">${rows.length}</div></div><div class="card">Scored lots<div class="value">${supported.length}</div></div><div class="card">Unavailable<div class="value">${rows.length - supported.length}</div></div><div class="card">Unbounded short-call legs<div class="value">${unbounded}</div></div></div>
<p><strong>Index = 100 × worst scenario loss per contract / current underlying notional (spot × 100 shares).</strong> This is a percentage of underlying notional, not account equity, probability of loss or a 0–100 safety grade. Rows are sorted by finite stress index; that number does not bound uncovered-call loss.</p>
<div class="table"><table><thead><tr><th>Account</th><th>Option</th><th>Side</th><th>Contracts</th><th>Index<br>% of notional</th><th>Stress loss<br>per contract</th><th>Stress loss<br>× quantity</th><th>Expiry max loss<br>× quantity</th></tr></thead><tbody>${body}</tbody></table></div>
<p>Each index uses a five-calendar-day horizon capped at actual expiry, underlying shocks −30%, −15%, 0%, +15%, +30%, and IV shifts −20, 0, +20 percentage points, floored at 1%. American pricing is a 200-step Jarrow–Rudd approximation with continuous dividend yield. These are conditional test scenarios, not forecast probabilities.</p>
<p>Each leg is scored independently. Position loss columns multiply per-contract estimates, including their estimated costs, by recorded quantity; actual multi-contract order fees may differ. Portfolio hedges and covering stock are not modeled. <strong>Do not sum these indexes or interpret this table as portfolio risk.</strong> Expected Shortfall, account-equity impact, stressed liquidity and actual broker margin are unavailable. Unavailable rows are retained with their reasons.</p>
<h2>Quote evidence and limitations</h2>${evidence}
<footer>Indicative analysis only. Quote/model discrepancies and dated inputs can materially change these results. No trades were executed or holdings changed.</footer>
</main></body></html>`;
}
