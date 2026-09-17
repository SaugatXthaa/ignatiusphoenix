// Task 51: reproduce "after 4-5 refreshes most sources return nothing".
// Simulates a user refreshing the same title N times against PRODUCTION,
// recording per-source yield + total per round.
// Usage: node scripts/task51_refresh_sim.mjs [rounds] [tmdbId] [type]
const BASE = 'https://ignatiusphoenix.onrender.com';
const rounds = parseInt(process.argv[2] || '5', 10);
const id = process.argv[3] || 'tmdb:324857'; // Spider-Man: Homecoming
const type = process.argv[4] || 'movie';

await (await fetch(`${BASE}/manifest.json`)).json();
console.log('prod reachable');
const health = await (await fetch(`${BASE}/health`)).json();
console.log(`health: ${health.sources.length} sources, uptime=${Math.round(health.uptime)}s`);

for (let r = 1; r <= rounds; r++) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/stream/${type}/${id}.json`, { signal: AbortSignal.timeout(60000) });
    const data = await res.json();
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    const streams = data.streams || [];
    // tally by provider tag in the stream name (Phoenix · ... · Source · ...)
    const tally = {};
    for (const s of streams) {
      const name = s.name || '';
      // name format: "Phoenix · 4K · SourceName · Server"
      const parts = name.split('·').map(x => x.trim());
      const src = parts[2] || parts[1] || name;
      tally[src] = (tally[src] || 0) + 1;
    }
    const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    console.log(`\n=== ROUND ${r}: ${streams.length} streams in ${dt}s (partial=${data.partial ?? 'n/a'}) ===`);
    console.log(sorted.map(([k, v]) => `${k}:${v}`).join(' '));
  } catch (e) {
    console.log(`\n=== ROUND ${r}: FAILED ${(Date.now() - t0) / 1000}s — ${e.message} ===`);
  }
}
