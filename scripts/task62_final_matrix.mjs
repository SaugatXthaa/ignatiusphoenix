// Task 62 FINAL production verification matrix.
// Titles: Obsession (movie, screenshot title), GoT S1E1 (series), Frieren S2E1 (anime), Squid Game S1E1 (kdrama).
// Checks per title: card count, source count, 4K presence, subtitle coverage, html-card count,
// + ffmpeg playability sample through 2 cards (redirect/proxy/direct paths).
import { spawn } from 'child_process';
import fs from 'fs';

const BASE = 'https://ignatiusphoenix.onrender.com';
const OUT = '/home/z/my-project/phoenix-analysis/scripts/task62';

function attrib(s) {
  const m = (s.behaviorHints?.bingeGroup || '').match(/^phoenix-([a-z0-9]+)/i);
  return m ? m[1] : 'other';
}
function playTest(url, seconds = 8) {
  return new Promise((resolve) => {
    const child = spawn('timeout', ['-k', '3', '80', 'ffmpeg', '-nostdin', '-v', 'info', '-stats', '-i', url, '-t', String(seconds), '-f', 'null', '-']);
    let err = '';
    child.stderr.on('data', c => { err += c.toString(); });
    child.on('close', () => {
      const stats = err.split('\r').filter(l => /frame=/.test(l)).pop() || '';
      const m = stats.match(/frame=\s*(\d+).*time=(\d+:\d+:\d+)/);
      const decoded = m ? `${m[1]} frames @ ${m[2]}` : 'none';
      const empty = /Output file is empty|File ended prematurely|Error opening input/.test(err);
      resolve({ ok: !empty && !!m && m[1] > 50, decoded, tail: err.replace(/\n/g, ' | ').slice(-160) });
    });
  });
}

const titles = [
  ['movie', 'tt37287335', 'Obsession(movie)'],
  ['series', 'tt0903747:1:1', 'GoT S1E1'],
  ['series', 'tt5691552:2:1', 'Frieren S2E1(anime)'],
  ['series', 'tt10919420:1:1', 'SquidGame S1E1(kdrama)'],
];

const report = {};
for (const [type, id, label] of titles) {
  const t0 = Date.now();
  let d = { streams: [] };
  try { d = await (await fetch(`${BASE}/stream/${type}/${id}.json`, { signal: AbortSignal.timeout(150000) })).json(); } catch (e) { console.log(`${label}: fetch error`); }
  await new Promise(r => setTimeout(r, 40000));
  try { d = await (await fetch(`${BASE}/stream/${type}/${id}.json`, { signal: AbortSignal.timeout(150000) })).json(); } catch (e) {}
  const s = d.streams || [];
  const uniq = new Map();
  for (const x of s) if (x.url) uniq.set(x.url, x);
  const cards = [...uniq.values()];
  const bySrc = {};
  for (const x of cards) { const k = attrib(x); bySrc[k] = (bySrc[k] || 0) + 1; }
  const html = cards.filter(x => /\.(html?)(\?|$)/i.test((x.url || '').split('?')[0]) && !/\.(m3u8|mp4|mkv|ts)(\?|$)/i.test((x.url || '').split('?')[0]));
  const subbed = cards.filter(x => (x.subtitles || []).length > 0).length;
  const fourK = cards.filter(x => /2160|4k/i.test(x.name || '')).length;
  report[label] = {
    cards: cards.length, sources: Object.keys(bySrc).length, fourK,
    subbed, subbedPct: cards.length ? Math.round(subbed / cards.length * 100) : 0, html: html.length,
    sourcesList: Object.entries(bySrc).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '),
  };
  console.log(`\n=== ${label}: ${cards.length} cards, ${Object.keys(bySrc).length} sources, ${fourK} 4K, subs ${subbed}/${cards.length} (${report[label].subbedPct}%), html=${html.length} [${Date.now() - t0}ms total]`);
  console.log('   ' + report[label].sourcesList);

  // playability sample: pick 2 diverse cards (prefer one 4K + one mid)
  const picks = [];
  const g4k = cards.find(x => /range-proxy|googleusercontent/.test(x.url || '') && /4K/i.test(x.name || ''));
  if (g4k) picks.push(['google-4K', g4k]);
  const direct = cards.find(x => /pixeldrain|workers\.dev|dramalinkbd/.test(x.url || ''));
  if (direct) picks.push(['direct-file', direct]);
  for (const [pl, x] of picks.slice(0, 2)) {
    const r = await playTest(x.url);
    console.log(`   play ${pl} (${(x.name || '').replace(/[^a-z0-9· ]/gi, '').slice(0, 32)}): ${r.ok ? 'PLAYS OK' : 'FAIL'} — ${r.decoded}`);
    if (!r.ok) console.log(`     tail: ${r.tail}`);
    report[label][`play_${pl}`] = r.ok ? 'OK' : 'FAIL';
  }
}
fs.writeFileSync(`${OUT}/final_matrix.json`, JSON.stringify(report, null, 1));
console.log('\nsaved final_matrix.json');
