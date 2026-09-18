#!/usr/bin/env node
/** Task 53 FINAL verification: 3 refreshes × 3 titles with attribution. */
const BASE = 'https://ignatiusphoenix.onrender.com';
const NEEDLES = ['4khdhub', 'hdhub4u', 'moviesdrive', 'movieshunt', 'uhdmovies', 'vegamovies', 'bollyflix'];

function attr(streams) {
  const hit = {};
  for (const s of streams) {
    const full = `${s.title || ''}\n${s.name || ''}`.toLowerCase();
    for (const n of NEEDLES) if (full.includes(n)) hit[n] = (hit[n] || 0) + 1;
  }
  return hit;
}

async function refresh(type, id, label) {
  const t0 = Date.now();
  const j = await fetch(`${BASE}/stream/${type}/${id}.json`, { signal: AbortSignal.timeout(45000) }).then(r => r.json());
  const streams = j.streams || [];
  console.log(`${label}: ${streams.length} streams in ${Date.now() - t0}ms  | ${JSON.stringify(attr(streams))}`);
  return streams.length;
}

console.log('=== MOVIE: Inception (tmdb:27205) x3 ===');
await refresh('movie', 'tmdb:27205', '  r1');
await refresh('movie', 'tmdb:27205', '  r2');
await refresh('movie', 'tmdb:27205', '  r3');

console.log('=== MOVIE: Endgame (tmdb:299534) x2 ===');
await refresh('movie', 'tmdb:299534', '  r1');
await refresh('movie', 'tmdb:299534', '  r2');

console.log('=== SERIES: GoT S1E1 (tmdb:1399:1:1) x3 ===');
await refresh('series', 'tmdb:1399:1:1', '  r1');
await refresh('series', 'tmdb:1399:1:1', '  r2');
await refresh('series', 'tmdb:1399:1:1', '  r3');

console.log('=== SERIES: Breaking Bad S1E1 (tmdb:1396:1:1) x2 ===');
await refresh('series', 'tmdb:1396:1:1', '  r1');
await refresh('series', 'tmdb:1396:1:1', '  r2');
