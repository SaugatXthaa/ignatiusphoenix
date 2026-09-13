// audit17_mh_probe.mjs — direct MoviesHuntV2 scraper probe (bypasses source wrapper)
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const mod = require_(path.join(__dirname, '..', 'src', 'nuvio', 'movieshunt_v2.cjs'));

const CASES = [
  ['F1', '911430', 'movie', null, null],
  ['Superman', '1061474', 'movie', null, null],
  ['Endgame', '299534', 'movie', null, null],
  ['BB-S1E1', '1396', 'tv', 1, 1],
];

for (const [name, tmdb, type, s, e] of CASES) {
  const t0 = Date.now();
  try {
    const streams = await Promise.race([
      mod.getStreams(tmdb, type, s, e),
      new Promise(r => setTimeout(() => r('__TIMEOUT__'), 40000)),
    ]);
    const dt = Date.now() - t0;
    if (streams === '__TIMEOUT__') console.log(`${name}: TIMEOUT at ${dt}ms`);
    else console.log(`${name}: ${Array.isArray(streams) ? streams.length : 'non-array'} streams in ${dt}ms`,
      Array.isArray(streams) && streams.length ? `\n  sample: ${JSON.stringify(streams[0]).slice(0, 160)}` : '');
  } catch (err) {
    console.log(`${name}: ERROR ${String(err?.message || err).slice(0, 120)}`);
  }
}
