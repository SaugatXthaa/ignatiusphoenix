// task53b_prod_verify.mjs — production multi-refresh verification of the
// user-named sources against https://ignatiusphoenix.onrender.com
//
// Usage: node scripts/task53b_prod_verify.mjs

const BASE = 'https://ignatiusphoenix.onrender.com';
const ROUNDS = parseInt(process.argv[2] || '4', 10);

const PROBES = [
  { label: 'MOVIE Inception', path: 'movie/tt1375666.json' },
  { label: 'MOVIE Endgame', path: 'movie/tt4154796.json' },
  { label: 'SERIES GoT S1E1', path: 'series/tt0944947:1:1.json' },
];

const LABELS = {
  '4khdhub': ['4khdhub'],
  'moviesdrivev2': ['moviesdrive'],
  'movieshuntv2': ['movieshunt'],
  'hdhub4uv2': ['hdhub4u'],
  'uhdmovies': ['uhdmovies'],
};

function classify(streams) {
  const found = {};
  let htmlCards = 0;
  for (const s of streams) {
    const name = String(s.name || '');
    const url = s.url || '';
    if (/^html:/i.test(url)) { htmlCards++; continue; }
    const lower = name.toLowerCase();
    for (const [id, pats] of Object.entries(LABELS)) {
      if (pats.some(p => lower.includes(p))) {
        found[id] = found[id] || { cards: 0, playable: 0, sample: '' };
        found[id].cards++;
        if (url.startsWith('http')) {
          found[id].playable++;
          if (!found[id].sample) found[id].sample = url.slice(0, 55);
        }
      }
    }
  }
  return { found, htmlCards };
}

let pass = 0, fail = 0;
const failures = [];

for (const probe of PROBES) {
  console.log(`\n=== ${probe.label} (${ROUNDS} refreshes on production) ===`);
  const timeline = {};
  let total = 0, htmlTotal = 0;
  for (let r = 1; r <= ROUNDS; r++) {
    const t0 = Date.now();
    let streams = [];
    try {
      const res = await fetch(`${BASE}/stream/${probe.path}`, { signal: AbortSignal.timeout(45000) });
      streams = (await res.json()).streams || [];
    } catch (e) {
      console.log(`  r${r}: FETCH ERROR ${e.message}`);
      continue;
    }
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    const { found, htmlCards } = classify(streams);
    total = streams.length; htmlTotal += htmlCards;
    const summary = Object.entries(found).map(([id, v]) => `${id}:${v.playable}`).join(' ') || '(none yet)';
    console.log(`  r${r}: ${streams.length} cards @${dt}s — ${summary}`);
    for (const [id, v] of Object.entries(found)) {
      timeline[id] = timeline[id] || { round: r, playable: 0, sample: '' };
      timeline[id].round = Math.min(timeline[id].round, r);
      timeline[id].playable = Math.max(timeline[id].playable, v.playable);
      if (v.sample && !timeline[id].sample) timeline[id].sample = v.sample;
    }
  }
  // expectations: uhdmovies is movies-only (both repos); everything else should
  // land within the refresh window via first response or background cache
  for (const [id, info] of Object.entries(timeline)) {
    const isMovieOnly = id === 'uhdmovies';
    const relevant = !(isMovieOnly && probe.label.startsWith('SERIES'));
    if (!relevant) { console.log(`  [INFO] ${id} movies-only by design — skipped for series`); continue; }
    const ok = info.playable >= 1 && info.round <= ROUNDS;
    if (ok) { pass++; console.log(`  [PASS] ${id} landed r${info.round} (${info.playable} playable) e.g. ${info.sample}`); }
    else { fail++; failures.push(`${probe.label} ${id}`); console.log(`  [FAIL] ${id} playable=${info.playable}`); }
  }
  for (const id of Object.keys(LABELS)) {
    if (id === 'uhdmovies' && probe.label.startsWith('SERIES')) continue;
    if (!timeline[id]) { fail++; failures.push(`${probe.label} ${id} NEVER`); console.log(`  [FAIL] ${id} NEVER landed in ${ROUNDS} refreshes`); }
  }
  if (htmlTotal > 0) { fail++; failures.push(`${probe.label} html`); console.log(`  [FAIL] ${htmlTotal} html cards`); }
  else { pass++; console.log('  [PASS] zero html cards'); }
}

console.log(`\n=== RESULT: ${pass} PASS / ${fail} FAIL ===`);
if (failures.length) console.log('FAILURES:', failures.join(' | '));
