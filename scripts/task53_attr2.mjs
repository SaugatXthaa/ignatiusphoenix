#!/usr/bin/env node
const BASE = 'https://ignatiusphoenix.onrender.com';
function attr(streams, needles) {
  const hit = {};
  for (const s of streams) {
    const full = `${s.title || ''}\n${s.name || ''}\n${s.description || ''}\n${s.url || ''}`.toLowerCase();
    for (const n of needles) if (full.includes(n)) hit[n] = (hit[n] || 0) + 1;
  }
  return hit;
}
const NEEDLES = ['4khdhub', 'hdhub4u', 'moviesdrive', 'movieshunt', 'uhdmovies', 'vegamovies', 'cinehdplus'];

for (const [type, id, label] of [['movie', 'tmdb:27205', 'Inception'], ['series', 'tmdb:1399:1:1', 'GoT S1E1'], ['series', 'tmdb:94973:1:1', 'HotD S1E1']]) {
  const t0 = Date.now();
  const j = await fetch(`${BASE}/stream/${type}/${id}.json`, { signal: AbortSignal.timeout(45000) }).then(r => r.json());
  const streams = j.streams || [];
  console.log(`${label}: ${streams.length} streams in ${Date.now() - t0}ms`);
  console.log('   ', JSON.stringify(attr(streams, NEEDLES)));
}
