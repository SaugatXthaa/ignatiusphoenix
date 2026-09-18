#!/usr/bin/env node
/** Task 53: reproduce the user's real-world flow — hit the FULL /stream
 *  endpoint (all 70 sources + 15s client budget) cold and warm, then check
 *  WHICH of the user-reported sources land streams in the actual response.
 *  Parses the manifest config slug the same way Stremio does.
 */
const BASE = 'https://ignatiusphoenix.onrender.com';

async function fullStream(type, tmdb, label) {
  const t0 = Date.now();
  const url = `${BASE}/stream/${type}/${tmdb}.json`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
    const j = await r.json();
    const dt = Date.now() - t0;
    const streams = j.streams || [];
    // attribute streams to sources via title prefix (cards carry "SourceName\n")
    const byName = {};
    for (const s of streams) {
      const t = (s.title || s.name || '').split('\n')[0].trim();
      byName[t] = (byName[t] || 0) + 1;
    }
    console.log(`\n=== ${label} ${type} ${tmdb}: ${streams.length} streams in ${dt}ms (partial=${dt > 14000 ? 'likely' : 'no'})`);
    const want = ['4khdhub', '4KHDHub', 'HDHub', 'MoviesDrive', 'Movies Hunt', 'MoviesHunt', 'CineHD', 'UHD', 'Vega', 'Drives'];
    for (const [name, n] of Object.entries(byName).sort((a, b) => b[1] - a[1])) {
      const hit = want.some(w => name.toLowerCase().includes(w.toLowerCase()));
      console.log(`  ${hit ? '>>>' : '   '} ${name}: ${n}`);
    }
    return streams.length;
  } catch (e) {
    console.log(`=== ${label} ${type} ${tmdb}: FETCH-FAIL after ${Date.now() - t0}ms: ${e.message.slice(0, 60)}`);
    return -1;
  }
}

// 3 consecutive refreshes — reproduces the user's "refresh and check again" flow
for (let i = 1; i <= 3; i++) {
  await fullStream('movie', 'tt27205', `refresh${i}`);   // Inception (tt id like Stremio)
}
