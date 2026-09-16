// Task 22: generic harness for nuvio .cjs scrapers of the 6 suspect sources
const path = require('node:path');

const CASES = [
  { mod: 'anineko.cjs',      args: [1429, 'tv', 1, 1],      label: 'anineko AoT S1E1' },
  { mod: 'nikastream.cjs',   args: [1061474, 'movie'],      label: 'nikastream Superman' },
  { mod: 'stellar.cjs',      args: [1429, 'tv', 1, 1],      label: 'stellar AoT S1E1' },
  { mod: 'moviesdrive_v2.cjs', args: [1061474, 'movie'],    label: 'moviesdrive_v2 Superman' },
  { mod: 'hindmoviez.cjs',   args: [1061474, 'movie'],      label: 'hindmoviez Superman' },
  { mod: 'pantyflix.cjs',    args: null,                     label: 'pantyflix (skip-if-absent)' },
];

(async () => {
  for (const c of CASES) {
    const file = path.join('/home/z/my-project/phoenix-analysis/src/nuvio', c.mod);
    let mod;
    try { mod = require(file); } catch (e) { console.log(`\n=== ${c.label}: LOAD FAIL ${e.message.slice(0, 80)}`); continue; }
    if (!c.args || typeof mod.getStreams !== 'function') {
      console.log(`\n=== ${c.label}: exports=${Object.keys(mod).join(',')} (no harness run)`);
      continue;
    }
    const t0 = Date.now();
    try {
      const fn = mod.getStreams.length >= 2 ? mod.getStreams(...c.args) : mod.getStreams(...c.args);
      const out = await fn;
      const arr = Array.isArray(out) ? out : (out?.streams || []);
      console.log(`\n=== ${c.label}: ${arr.length} streams in ${Date.now() - t0}ms ===`);
      for (const s of arr.slice(0, 4)) console.log(`  - ${(s.name || s.title || '?').toString().slice(0, 70)} | ${(s.url || '').slice(0, 70)}`);
    } catch (e) {
      console.log(`\n=== ${c.label}: THREW ${e.message.slice(0, 100)}`);
    }
  }
  process.exit(0);
})();
