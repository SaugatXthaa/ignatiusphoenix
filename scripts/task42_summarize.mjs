// Task 42: summarize sweep reports — which sources ship bad cards
import { readFileSync } from 'node:fs';

for (const f of ['task42_report_movie.json', 'task42_report_series.json', 'task42_report_anime.json']) {
  let rep;
  try { rep = JSON.parse(readFileSync(new URL(`./${f}`, import.meta.url))); } catch (e) { console.log(f, 'unreadable:', e.message); continue; }
  console.log(`\n=== ${rep.label} (${f}) ===`);
  const rows = [];
  for (const [src, s] of Object.entries(rep.sources || {})) {
    if (s.total === 0) { rows.push([src, 'EMPTY', 0, 0, 0, 0, '']); continue; }
    const badKinds = Object.entries(s.kinds || {}).filter(([, n]) => n > 0).map(([k, n]) => `${k}:${n}`).join(',') || '-';
    rows.push([src, `${s.ok}/${s.total}`, s.html, s.err, s.bad, 0, badKinds]);
  }
  // only print sources with any issue or empty, plus a total line
  let tot = 0, totOk = 0, totHtml = 0, totErr = 0, totBad = 0;
  for (const [src, okTot, html, err, bad] of rows) {
    const n = parseInt(String(okTot).split('/')[1] || '0', 10);
    tot += n; totOk += parseInt(String(okTot).split('/')[0] || '0', 10); totHtml += html; totErr += err; totBad += bad;
    if (okTot === 'EMPTY' || html > 0 || err > 0 || bad > 0) console.log(`  ${src.padEnd(22)} ok=${okTot} html=${html} err=${err} bad=${bad} ${rows.find(r => r[0] === src)[6]}`);
  }
  console.log(`  TOTAL: ${totOk}/${tot} ok, html=${totHtml} err=${totErr} bad=${totBad}`);
}
