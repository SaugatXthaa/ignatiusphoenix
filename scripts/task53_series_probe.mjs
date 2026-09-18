#!/usr/bin/env node
const BASE = 'https://ignatiusphoenix.onrender.com';
// CineHDPlus is series-only (es/mx) — probe with a Spanish series (La Casa del Dragón tmdb:94973, GoT tmdb:1399)
for (const [id, tid] of [['cinehdplus', 'tmdb:1399:1:1'], ['movieshuntv2', 'tmdb:94973:1:1']]) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}/debug/source/${id}?type=series&id=${tid}`, { signal: AbortSignal.timeout(55000) });
    const j = await r.json();
    console.log(`${id} series ${tid} → ${j.count} streams  ${Date.now() - t0}ms  ${(j.results || []).slice(0, 1).map(s => (s.title || '').slice(0, 60)).join('')}`);
    if (j.count === 0 && j.logs) console.log('  logs:', j.logs.slice(0, 6).join(' | ').slice(0, 300));
  } catch (e) { console.log(`${id} FETCH-FAIL ${e.message.slice(0, 40)}`); }
}
