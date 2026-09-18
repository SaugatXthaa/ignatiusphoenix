// task53b_refresh_cycle.mjs — multi-refresh verification reproducing the
// user's real usage pattern: consecutive /stream requests, tracking when
// each user-named source's cards land.
//
// Contract (Task 36/53): refresh 1 = cold partial (fast sources only);
// refreshes 2+ = background continuation delivers the rest via cache.
// All user-named sources (4khdhub / moviesdrive / movieshunt / hdhub4u /
// uhdmovies) must be present by refresh 3, with real playable URLs.

const PORT = process.argv[2] || '7100';
const BASE = `http://127.0.0.1:${PORT}`;
const ROUNDS = parseInt(process.argv[3] || '4', 10);

const PROBES = [
  { label: 'MOVIE Inception', path: 'movie/tt1375666.json' },
  { label: 'SERIES GoT S1E1', path: 'series/tt0944947:1:1.json' },
];

// card-name labels → source ids
const LABELS = {
  '4khdhub': ['4khdhub ·', '4khdhub.one'],
  'moviesdrivev2': ['moviesdrive'],
  'movieshuntv2': ['movieshunt'],
  'hdhub4uv2': ['hdhub4u'],
  'uhdmovies': ['uhdmovies'],
};

function classify(streams) {
  const found = {};
  let htmlCards = 0, extOnly = 0;
  for (const s of streams) {
    const name = String(s.name || '');
    const url = s.url || '';
    if (s.externalUrl && !url) extOnly++;
    if (/^html:/i.test(url)) htmlCards++;
    const lower = name.toLowerCase();
    for (const [id, pats] of Object.entries(LABELS)) {
      if (pats.some(p => lower.includes(p))) {
        found[id] = found[id] || { cards: 0, playable: 0 };
        found[id].cards++;
        if (url && !/^html:/i.test(url)) found[id].playable++;
      }
    }
  }
  return { found, htmlCards, extOnly };
}

let pass = 0, fail = 0;
const failures = [];

for (const probe of PROBES) {
  console.log(`\n=== ${probe.label} (${ROUNDS} refreshes) ===`);
  const timeline = {};
  let lastCounts = 0, lastHtml = 0;
  for (let r = 1; r <= ROUNDS; r++) {
    const t0 = Date.now();
    let streams = [];
    try {
      const res = await fetch(`${BASE}/stream/${probe.path}`, { signal: AbortSignal.timeout(60000) });
      streams = (await res.json()).streams || [];
    } catch (e) {
      console.log(`  r${r}: FETCH ERROR ${e.message}`);
      continue;
    }
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    const { found, htmlCards, extOnly } = classify(streams);
    lastCounts = streams.length; lastHtml = htmlCards;
    const summary = Object.entries(found).map(([id, v]) => `${id}:${v.playable}`).join(' ') || '(none yet)';
    console.log(`  r${r}: ${streams.length} cards @${dt}s — ${summary}`);
    for (const [id, v] of Object.entries(found)) {
      timeline[id] = timeline[id] || { round: r, playable: 0 };
      timeline[id].round = Math.min(timeline[id].round, r);
      timeline[id].playable = Math.max(timeline[id].playable, v.playable);
    }
    // stop early when everything landed
    if (Object.keys(timeline).length === Object.keys(LABELS).length) break;
  }
  for (const [id, info] of Object.entries(timeline)) {
    const ok = info.playable >= 1 && info.round <= 3;
    if (ok) { pass++; console.log(`  [PASS] ${id} landed r${info.round} (${info.playable} playable)`); }
    else { fail++; failures.push(`${probe.label} ${id}`); console.log(`  [FAIL] ${id} round=${info.round} playable=${info.playable}`); }
  }
  for (const id of Object.keys(LABELS)) {
    if (!timeline[id]) { fail++; failures.push(`${probe.label} ${id} NEVER`); console.log(`  [FAIL] ${id} NEVER landed in ${ROUNDS} refreshes`); }
  }
  console.log(`  hygiene: htmlCards=${lastHtml} extOnly-as-total-check total=${lastCounts}`);
  if (lastHtml > 0) { fail++; failures.push(`${probe.label} html cards`); console.log('  [FAIL] html cards present'); }
  else { pass++; console.log('  [PASS] zero html cards'); }
}

console.log(`\n=== RESULT: ${pass} PASS / ${fail} FAIL ===`);
if (failures.length) console.log('FAILURES:', failures.join(' | '));
process.exit(fail ? 1 : 0);
