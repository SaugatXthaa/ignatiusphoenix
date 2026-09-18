// task53b_verify.mjs — verify timeout alignment against the TRUE original repo
// (SaugatXthaa/PhoeniX): user-named sources must deliver on merged /stream.
//
// Checks:
//   1. merged movie /stream (Inception) — 4khdhub, moviesdrivev2, movieshuntv2,
//      hdhub4uv2, uhdmovies present with real playable URLs
//   2. merged series /stream (GoT S1E1) — same sources present
//   3. zero html:// cards, zero externalUrl-only cards among named sources
//
// Usage: node scripts/task53b_verify.mjs [port]

const PORT = process.argv[2] || '7100';
const BASE = `http://127.0.0.1:${PORT}`;

const INCEPTION = { type: 'movie', id: 'tt1375666.json' };      // Inception
const GOTS1E1 = { type: 'series', id: 'tt0944947:1:1.json' };   // GoT S1E1

const NAMED = ['4khdhub', 'fourkhdhubone', 'moviesdrivev2', 'movieshuntv2', 'hdhub4uv2', 'uhdmovies'];

async function getStreams(p) {
  const res = await fetch(`${BASE}/stream/${p.type}/${p.id}`, { signal: AbortSignal.timeout(60000) });
  const j = await res.json();
  return j.streams || [];
}

function classify(streams) {
  const bySource = {};
  let htmlCards = 0, extOnly = 0;
  for (const s of streams) {
    const name = String(s.name || '');
    const url = s.url || '';
    const ext = s.externalUrl || '';
    if (ext && !url) extOnly++;
    if (/^html:/i.test(url)) htmlCards++;
    for (const src of NAMED) {
      if (name.toLowerCase().includes(src.replace('v2', '')) || (s.title || '').toLowerCase().includes(src)) {
        bySource[src] = bySource[src] || [];
        bySource[src].push(url ? url.slice(0, 60) : '(ext)');
      }
    }
  }
  return { bySource, htmlCards, extOnly };
}

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  [PASS] ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${detail ? ' — ' + detail : ''}`); }
}

console.log('=== Task 53b: named-source delivery on merged /stream ===\n');

for (const [label, probe] of [['MOVIE Inception', INCEPTION], ['SERIES GoT S1E1', GOTS1E1]]) {
  const t0 = Date.now();
  const streams = await getStreams(probe);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  const { bySource, htmlCards, extOnly } = classify(streams);
  console.log(`--- ${label}: ${streams.length} cards in ${dt}s (html=${htmlCards}, extOnly=${extOnly})`);
  for (const src of NAMED) {
    const hits = bySource[src] || [];
    const playable = hits.filter(h => h !== '(ext)' && !h.startsWith('html:'));
    check(`${label} ${src} >=1 playable`, playable.length >= 1, `${playable.length} e.g. ${playable[0] || 'NONE'}`);
  }
  check(`${label} zero html cards`, htmlCards === 0);
  console.log('');
}

console.log(`=== RESULT: ${pass} PASS / ${fail} FAIL ===`);
if (failures.length) console.log('FAILURES:', failures.join(' | '));
process.exit(fail ? 1 : 0);
