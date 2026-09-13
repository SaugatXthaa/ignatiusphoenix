// Task 22: time every speedracelight request inside a real videasyto sweep
const timings = [];
if (!globalThis.__task22TimingShim) {
  globalThis.__task22TimingShim = true;
  const orig = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    const isSL = /speedracelight\.com/i.test(url);
    const t0 = Date.now();
    try {
      const res = await orig(input, init);
      if (isSL) {
        const label = decodeURIComponent(url.split('?')[0].replace('https://api.speedracelight.com/', '')) +
          (url.includes('seed') ? ' (seed)' : '');
        timings.push({ label, ms: Date.now() - t0, status: res.status });
      }
      return res; // body untouched — scraper reads it normally
    } catch (e) {
      if (isSL) {
        const label = decodeURIComponent(url.split('?')[0].replace('https://api.speedracelight.com/', ''));
        timings.push({ label, ms: Date.now() - t0, status: 'ERR:' + (e?.name || e?.message || '') });
      }
      throw e;
    }
  };
}

const mod = await import('../src/nuvio/videasyto.cjs');
const cases = [
  { args: ['299534', 'movie'], name: 'Endgame movie' },
  { args: ['1396', 'tv', '1', '1'], name: 'BreakingBad S1E1' },
];
for (const c of cases) {
  timings.length = 0;
  const t0 = Date.now();
  const streams = await mod.getStreams(...c.args);
  console.log(`\n=== ${c.name}: ${streams.length} streams in ${Date.now() - t0}ms ===`);
  for (const t of timings.sort((a, b) => b.ms - a.ms)) {
    console.log(`  ${String(t.ms).padStart(6)}ms  ${t.status}  ${t.label.slice(0, 50)}`);
  }
}
process.exit(0);
