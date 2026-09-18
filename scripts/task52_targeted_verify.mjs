#!/usr/bin/env node
/** Task 52: targeted re-verify of per-title/timeout false positives. */
const BASE = 'https://ignatiusphoenix.onrender.com';
const PROBES = [
  ['netlio', 'movie', 'tmdb:299534'],          // Endgame (in its index)
  ['2dhive', 'series', 'tmdb:1429:1:1'],       // AoT (megaplay)
  ['animotvslash', 'series', 'tmdb:1429:1:1'], // AoT (nexabloom)
  ['hindmoviez', 'movie', 'tmdb:27205'],       // Inception (worked @18s earlier)
  ['nikastream', 'series', 'tmdb:209867:1:1'], // Frieren (worked @25.6s earlier)
  ['stellarrip', 'movie', 'tmdb:27205'],       // upstream server check
  ['persianstremio', 'movie', 'tmdb:299534'],  // Endgame
];
for (const [id, type, tmdb] of PROBES) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}/debug/source/${id}?type=${type}&id=${tmdb}`, { signal: AbortSignal.timeout(50000) });
    const j = await r.json();
    console.log(`${id.padEnd(15)} ${j.count ?? 'ERR'} streams  ${Date.now() - t0}ms  ${j.error || ''}`);
  } catch (e) { console.log(`${id.padEnd(15)} FETCH-FAIL ${e.message.slice(0, 40)}`); }
}
