#!/usr/bin/env node
const BASE = 'https://ignatiusphoenix.onrender.com';
const j = await fetch(`${BASE}/stream/series/tmdb:94973:1:1.json`, { signal: AbortSignal.timeout(45000) }).then(r => r.json());
console.log('HotD /stream:', (j.streams || []).length, 'streams');
for (const s of (j.streams || []).slice(0, 8)) {
  console.log('  -', (s.title || '').split('\n')[0].slice(0, 60), '|', (s.name || '').slice(0, 40), '|', (s.url || s.externalUrl || '').slice(0, 60));
}
// isolated checks of the big producers
for (const [src, tid] of [['cinewave', 'tmdb:94973:1:1'], ['watchseries', 'tmdb:94973:1:1'], ['vidsrcsbs', 'tmdb:94973:1:1']]) {
  const t0 = Date.now();
  try {
    const d = await fetch(`${BASE}/debug/source/${src}?type=series&id=${tid}`, { signal: AbortSignal.timeout(50000) }).then(r => r.json());
    console.log(`${src} isolated: ${d.count} in ${Date.now() - t0}ms ${d.error || ''}`);
    if ((d.results || []).length) console.log('   sample:', JSON.stringify(d.results[0]).slice(0, 200));
  } catch (e) { console.log(`${src} FAIL ${e.message.slice(0, 40)}`); }
}
