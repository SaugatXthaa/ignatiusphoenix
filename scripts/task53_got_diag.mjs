#!/usr/bin/env node
const BASE = 'https://ignatiusphoenix.onrender.com';

function findSources(streams, needles) {
  const hit = {};
  for (const s of streams) {
    const full = `${s.title || ''}\n${s.name || ''}\n${s.description || ''}`.toLowerCase();
    for (const n of needles) if (full.includes(n)) hit[n] = (hit[n] || 0) + 1;
  }
  return hit;
}

// GoT via /debug/stream — its own resolve with per-source timings
const t0 = Date.now();
const d = await fetch(`${BASE}/debug/stream?type=series&id=tmdb:1399:1:1`, { signal: AbortSignal.timeout(60000) }).then(x => x.json());
console.log(`GoT debug: total ${d.totalMs}ms streams ${d.totalStreams} partial=${d.partial}`);
const srcs = d.sources || [];
console.log('slowest 12:', srcs.slice(0, 12).map(t => `${t.id}(${t.status[0]})${t.count}@${(t.durationMs / 1000).toFixed(1)}s`).join('  '));
console.log('movieshuntv2 timing:', JSON.stringify(srcs.find(t => t.id === 'movieshuntv2') || 'not-in-timings'));
console.log('moviesdrivev2 timing:', JSON.stringify(srcs.find(t => t.id === 'moviesdrivev2') || 'not-in-timings'));
console.log(`wall ${Date.now() - t0}ms`);

// attribution over full title text
const r = await fetch(`${BASE}/stream/series/tmdb:1399:1:1.json`, { signal: AbortSignal.timeout(45000) });
const j = await r.json();
console.log('\nGoT /stream:', (j.streams || []).length, 'streams');
console.log('attribution:', JSON.stringify(findSources(j.streams || [], ['movieshunt', 'moviesdrive', 'uhdmovies', '4khdhub', 'hdhub4u', 'cinehdplus'])));
