// Task 27 — hindmoviez raw scraper timing (find the slow/broken stage)
const { getStreams } = require('/home/z/my-project/phoenix-analysis/src/nuvio/hindmoviez.cjs');

const t0 = Date.now();
const tick = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

// Log every fetch through a timing shim
const origFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const t1 = Date.now();
  try {
    const res = await origFetch(url, opts);
    console.log(`[${tick()}] ${res.status} ${String(url).slice(0, 100)} (${Date.now() - t1}ms)`);
    return res;
  } catch (e) {
    console.log(`[${tick()}] ERR ${String(url).slice(0, 100)} — ${e.message}`);
    throw e;
  }
};

(async () => {
  try {
    const streams = await Promise.race([
      getStreams('tt4154796', 'movie', null, null),
      new Promise(r => setTimeout(() => r('TIMEOUT_75s'), 75000)),
    ]);
    if (Array.isArray(streams)) {
      console.log(`\n${tick()} RESULT: ${streams.length} streams`);
      for (const s of streams.slice(0, 5)) console.log(`  - ${s.quality || s.name} | ${String(s.url).slice(0, 80)}`);
    } else console.log(`\n${tick()} RESULT: ${streams}`);
  } catch (e) {
    console.log(`${tick()} ERROR: ${e.message}`);
  }
  process.exit(0);
})();
