#!/usr/bin/env node
const BASE = 'https://ignatiusphoenix.onrender.com';
for (const [type, id] of [['movie', 'tmdb:27205'], ['series', 'tmdb:1399:1:1'], ['movie', 'tt1375666']]) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}/stream/${type}/${id}.json`, { signal: AbortSignal.timeout(60000) });
    const j = await r.json();
    console.log(`${type.padEnd(6)} ${id.padEnd(16)} → ${(j.streams || []).length} streams  ${Date.now() - t0}ms  ${j.error ? 'ERR:' + j.error : ''}`);
  } catch (e) { console.log(`${type.padEnd(6)} ${id} FETCH-FAIL ${e.message.slice(0, 50)}`); }
}
