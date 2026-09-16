// Task 27 — direct probe of animesuge scraper chain (why 0 cards in ground truth?)
const { getStreams, searchAnimeSuge } = require('/home/z/my-project/phoenix-analysis/src/nuvio/animesuge.cjs');

const t0 = Date.now();
const targets = [
  { name: 'AoT S1E1',      tmdb: 1429,   type: 'tv', s: 1, e: 1 },
  { name: 'Frieren S2E1',  tmdb: 209867, type: 'tv', s: 2, e: 1 },
];
(async () => {
  for (const t of targets) {
    const t1 = Date.now();
    try {
      const streams = await Promise.race([
        getStreams(t.tmdb, t.type, t.s, t.e),
        new Promise(r => setTimeout(() => r('RACE_TIMEOUT_45s'), 45000)),
      ]);
      const dt = ((Date.now() - t1) / 1000).toFixed(1);
      if (Array.isArray(streams)) {
        console.log(`[${t.name}] ${streams.length} streams in ${dt}s`);
        for (const s of streams.slice(0, 4)) {
          console.log(`   - ${s.name || ''} | ${s.title || ''} | url=${String(s.url || '').slice(0, 90)}`);
        }
      } else {
        console.log(`[${t.name}] ${streams} after ${dt}s`);
      }
    } catch (e) {
      console.log(`[${t.name}] ERROR after ${((Date.now()-t1)/1000).toFixed(1)}s: ${e.message}`);
    }
  }
  console.log(`total ${((Date.now()-t0)/1000).toFixed(1)}s`);
  process.exit(0);
})();
