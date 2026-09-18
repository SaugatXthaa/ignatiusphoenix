#!/usr/bin/env node
/** Task 53 production verification: multi-refresh /stream checks with
 *  source attribution for the user-reported sources. */
const BASE = 'https://ignatiusphoenix.onrender.com';
const MARKERS = {
  movie: ['4KHDHub', 'HDHub4u', 'MoviesDrive', 'MoviesHunt', 'UHDMovies', 'Vegamovies'],
  series: ['MoviesHunt', 'MoviesDrive', 'CineHDPlus'],
};

async function refresh(type, id, label) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/stream/${type}/${id}.json`, { signal: AbortSignal.timeout(45000) });
  const j = await r.json();
  const streams = j.streams || [];
  const dt = Date.now() - t0;
  const found = (MARKERS[type] || []).filter(m =>
    streams.some(s => `${s.title || ''}\n${s.name || ''}\n${s.description || ''}`.toLowerCase().includes(m.toLowerCase()))
  );
  console.log(`${label}: ${streams.length} streams in ${dt}ms  | user-reported present: ${found.join(', ') || 'NONE'}`);
  return { dt, n: streams.length, found };
}

console.log('=== MOVIE Inception (tmdb:27205) — 2 refreshes ===');
const m1 = await refresh('movie', 'tmdb:27205', 'movie-r1');
const m2 = await refresh('movie', 'tmdb:27205', 'movie-r2');

console.log('\n=== SERIES GoT S1E1 (tmdb:1399:1:1) — 2 refreshes ===');
const s1 = await refresh('series', 'tmdb:1399:1:1', 'got-r1');
const s2 = await refresh('series', 'tmdb:1399:1:1', 'got-r2');

console.log('\n=== VERDICT ===');
const okTime = (x) => x.dt < 19000;
console.log(`response times under 19s: movie ${m1.dt}/${m2.dt}ms series ${s1.dt}/${s2.dt}ms → ${[m1,m2,s1,s2].every(okTime) ? 'PASS' : 'CHECK'}`);
console.log(`4khdhub/hdhub4u/moviesdrive/movieshunt/uhdmovies in movie responses: r1=[${m1.found}] r2=[${m2.found}]`);
console.log(`movieshunt/moviesdrive in GoT response: r1=[${s1.found}] r2=[${s2.found}]`);
