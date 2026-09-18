#!/usr/bin/env node
/** Task 53: which sources land in the REAL /stream response (2 refreshes),
 *  for the two titles the user cares about. */
const BASE = 'https://ignatiusphoenix.onrender.com';

async function probe(type, tmdb, label) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/stream/${type}/${tmdb}.json`, { signal: AbortSignal.timeout(60000) });
  const j = await r.json();
  const streams = j.streams || [];
  const byName = {};
  for (const s of streams) {
    const t = (s.title || s.name || '').split('\n')[0].trim();
    byName[t] = (byName[t] || 0) + 1;
  }
  console.log(`\n=== ${label} ${type} ${tmdb}: ${streams.length} streams in ${Date.now() - t0}ms`);
  for (const [name, n] of Object.entries(byName).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${name}: ${n}`);
  }
  return streams;
}

// GoT first (worst case: 1 stream), then Inception twice
await probe('series', 'tmdb:1399:1:1', 'goT-r1');
await probe('series', 'tmdb:1399:1:1', 'goT-r2');
await probe('movie', 'tmdb:27205', 'incep-r1');
await probe('movie', 'tmdb:27205', 'incep-r2');
