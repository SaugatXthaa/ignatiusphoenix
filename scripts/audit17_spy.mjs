// audit17_spy.mjs — run an obfuscated scraper with a fetch spy to trace its API calls
// Usage: node scripts/audit17_spy.mjs <provider.cjs name> <tmdbId> <movie|tv> [season] [episode]
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const name = process.argv[2] || 'movieblast';
const tmdb = process.argv[3] || '299534';
const type = process.argv[4] || 'movie';
const season = process.argv[5] ? parseInt(process.argv[5]) : null;
const episode = process.argv[6] ? parseInt(process.argv[6]) : null;

const origFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url || String(input);
  const t0 = Date.now();
  try {
    const res = await origFetch(input, init);
    const ct = res.headers.get('content-type') || '';
    let body = '';
    if (ct.includes('json') || ct.includes('text')) {
      try { body = (await res.clone().text()).slice(0, 200); } catch {}
    }
    console.log(`[SPY] ${init?.method || 'GET'} ${url.slice(0, 150)} → ${res.status} (${Date.now() - t0}ms) ${ct.slice(0, 30)}`);
    if (body && res.status !== 200) console.log(`[SPY]   body: ${body.replace(/\s+/g, ' ').slice(0, 150)}`);
    return res;
  } catch (e) {
    console.log(`[SPY] ${url.slice(0, 150)} → THREW ${String(e?.message || e).slice(0, 80)} (${Date.now() - t0}ms)`);
    throw e;
  }
};

const require_ = createRequire(import.meta.url);
const mod = require_(path.join(__dirname, '..', 'src', 'nuvio', `${name}.cjs`));
const t0 = Date.now();
try {
  const streams = await Promise.race([
    mod.getStreams(tmdb, type, season, episode),
    new Promise(r => setTimeout(() => r('__TIMEOUT__'), 45000)),
  ]);
  if (streams === '__TIMEOUT__') console.log(`RESULT: TIMEOUT`);
  else {
    console.log(`RESULT: ${Array.isArray(streams) ? streams.length : 0} streams in ${Date.now() - t0}ms`);
    for (const s of (streams || []).slice(0, 3)) console.log(`  - ${s.quality} | ${String(s.url).slice(0, 110)}`);
  }
} catch (e) {
  console.log('RESULT: ERROR', String(e?.message || e).slice(0, 100));
}
