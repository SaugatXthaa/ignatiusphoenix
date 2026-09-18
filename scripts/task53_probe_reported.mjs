#!/usr/bin/env node
/** Task 53: probe the sources the user reported as not showing streams.
 *  Hits /debug/source/<id> (isolated, no client-budget cut) 3 times each
 *  to separate "source is broken" from "budget/cache timing issue".
 *  Also checks freshness of upstream (4khdhub / moviesdrive / movieshunt).
 */
const BASE = 'https://ignatiusphoenix.onrender.com';
const TARGETS = [
  ['4khdhub', 'movie', 'tmdb:27205'],        // Inception
  ['4khdhub', 'movie', 'tmdb:1022789'],      // recent hit (Deadpool-ish recent)
  ['fourkhdhubone', 'movie', 'tmdb:27205'],
  ['hdhub4uv2', 'movie', 'tmdb:27205'],
  ['moviesdrivev2', 'movie', 'tmdb:27205'],
  ['movieshuntv2', 'movie', 'tmdb:27205'],
  ['movieshuntv2', 'series', 'tmdb:1399:1:1'], // GoT S1E1
  ['vegamovies2', 'movie', 'tmdb:27205'],
  ['cinehdplus', 'movie', 'tmdb:27205'],
  ['uhdmovies', 'movie', 'tmdb:27205'],
];
const RUNS = 3;
for (let run = 1; run <= RUNS; run++) {
  console.log(`\n===== RUN ${run} (${new Date().toISOString()}) =====`);
  for (const [id, type, tmdb] of TARGETS) {
    const t0 = Date.now();
    try {
      const r = await fetch(`${BASE}/debug/source/${id}?type=${type}&id=${tmdb}`, { signal: AbortSignal.timeout(55000) });
      const j = await r.json().catch(() => ({}));
      const first = (j.results || j.streams || []).slice(0, 1).map(s => s.title || s.name || '').join('');
      console.log(`  ${id.padEnd(14)} ${type.padEnd(6)} ${String(j.count ?? 'ERR').padStart(3)} str  ${String(Date.now() - t0).padStart(6)}ms  ${j.error ? 'ERR:' + String(j.error).slice(0, 60) : first.slice(0, 50)}`);
    } catch (e) {
      console.log(`  ${id.padEnd(14)} ${type.padEnd(6)} FETCH-FAIL ${String(Date.now() - t0).padStart(6)}ms  ${e.message.slice(0, 50)}`);
    }
  }
}
