// audit17_crosscheck.mjs — second-title cross-check for flagged sources
// Live audit (audit_all_sources_live.mjs) tests ONE title per source, so a 0
// can be a catalog gap rather than a dead source. This re-probes every flagged
// source via /debug/source (cache-bypassed) on DIFFERENT titles:
//   - movie-flagged  → Endgame (tmdb:299534), fallback BB S1E1 if series supported
//   - anime-flagged  → Attack on Titan S1E1 (tmdb:1429:1:1)
// Verdicts: ALIVE (streams on 2nd title → title-gap only), DEAD (0 on both).
const BASE = 'http://127.0.0.1:4598';
const CONC = 4;

const FLAGGED = [
  // [id, firstTitleLabel, firstCount, kind]  kind: 'anime' | 'general'
  ['moviebox', 'Dune2', 0, 'general'],
  ['netlio', 'Dune2', 0, 'general'],
  ['animeflix', 'Naruto', 0, 'anime'],
  ['nowhdtime', 'Dune2', 0, 'general'],
  ['animegg', 'Naruto-TIMEOUT', 0, 'anime'],
  ['hindmoviez', 'Dune2', 0, 'general'],
  ['zxcstream', 'Dune2', 0, 'general'],
  ['animezey', 'Naruto', 0, 'anime'],
  ['anikototv', 'Naruto', 0, 'anime'],
  ['animeworldindia', 'Naruto', 0, 'anime'],
  ['persianstremio', 'Dune2', 0, 'general'],
  ['anichan', 'Naruto', 0, 'anime'],
  ['animesuge', 'Naruto', 0, 'anime'],
  ['bollyflix', 'Dune2', 0, 'general'],
  ['stellarrip', 'Dune2', 0, 'general'],
  ['movieshuntv2', 'Dune2', 0, 'general'],
  ['cinehdplus', 'Dune2', 0, 'general'],
  ['dahmermovies', 'Dune2', 0, 'general'],
  ['dahmermovies4k', 'Dune2', 0, 'general'],
  ['vixsrc', 'Dune2', 0, 'general'],
  ['allwish', 'Dune2', 0, 'general'],
  ['videasyto', 'Dune2-TIMEOUT', 0, 'general'],
];

// contentTypes (from registry) — decides fallback title eligibility
const SERIES_ONLY = new Set(['animezey', 'anikototv', 'animeworldindia', 'cinehdplus']);
const MOVIE_CAPABLE = s => !SERIES_ONLY.has(s);

async function probe(sourceId, type, id) {
  const url = `${BASE}/debug/source/${sourceId}?type=${type}&id=${id}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(42000) });
    const j = await res.json();
    if (j.timedOut) return { count: 0, note: 'timeout-35s' };
    if (j.error) return { count: j.count || 0, note: `error: ${j.error.slice(0, 80)}` };
    return { count: j.count || 0, note: `${j.durationMs}ms` };
  } catch (e) {
    return { count: -1, note: 'probe-fail: ' + String(e?.message || e).slice(0, 60) };
  }
}

async function runOne([id, firstLabel, , kind]) {
  const attempts = [];
  if (kind === 'anime') {
    attempts.push(['series', 'tmdb:1429:1:1', 'AoT-S1E1']);
    attempts.push(['movie', 'tmdb:372058', 'YourName']); // extra datapoint (movie-capable or not — harmless)
  } else {
    attempts.push(['movie', 'tmdb:299534', 'Endgame']);
    if (MOVIE_CAPABLE(id)) attempts.push(['series', 'tt0903747:1:1', 'BB-S1E1']);
  }
  let best = 0;
  const trail = [];
  for (const [type, tid, label] of attempts) {
    const r = await probe(id, type, tid);
    trail.push(`${label}=${r.count}(${r.note})`);
    if (r.count > best) best = r.count;
    if (best > 0) break; // alive — stop early
  }
  return { id, firstLabel, best, trail: trail.join(' | '), verdict: best > 0 ? 'ALIVE' : 'DEAD' };
}

console.log(`Cross-checking ${FLAGGED.length} flagged sources (conc=${CONC})...\n`);
const results = [];
const queue = [...FLAGGED];
const workers = Array.from({ length: CONC }, async () => {
  while (queue.length) {
    const item = queue.shift();
    const r = await runOne(item);
    results.push(r);
    console.log(`${r.verdict === 'ALIVE' ? '🟢' : '🔴'} ${r.id.padEnd(18)} ${r.verdict.padEnd(6)} [1st: ${r.firstLabel}=0] ${r.trail}`);
  }
});
await Promise.all(workers);

const dead = results.filter(r => r.verdict === 'DEAD');
const alive = results.filter(r => r.verdict === 'ALIVE');
console.log(`\n══ CROSS-CHECK SUMMARY ══`);
console.log(`ALIVE (title-gap only): ${alive.length} → ${alive.map(r => r.id).join(', ')}`);
console.log(`DEAD (0 on both titles): ${dead.length} → ${dead.map(r => r.id).join(', ')}`);
