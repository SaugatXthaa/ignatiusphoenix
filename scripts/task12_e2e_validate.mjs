// task12_e2e_validate.mjs — run both scrapers + Range-GET validate every URL
import { createRequire } from 'module';
import { gotScraping } from 'got-scraping';

const require_ = createRequire(import.meta.url);
const md = require_('/home/z/my-project/phoenix-analysis/src/nuvio/moviesdrive_v2.cjs');
const mh = require_('/home/z/my-project/phoenix-analysis/src/nuvio/movieshunt_v2.cjs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function validate(url) {
  try {
    const res = await gotScraping({
      url, method: 'GET',
      headers: { 'User-Agent': UA, Range: 'bytes=0-1023' },
      timeout: { request: 25000 }, throwHttpErrors: false, followRedirect: true, http2: true,
    });
    const ct = String(res.headers['content-type'] || '');
    const cr = String(res.headers['content-range'] || '');
    const ok = res.statusCode === 206 || res.statusCode === 200;
    return { ok, status: res.statusCode, ct, size: cr.split('/')[1] || res.headers['content-length'] || '?' };
  } catch (e) { return { ok: false, status: 'ERR', ct: e.message?.slice(0, 40), size: '?' }; }
}

const CASES = [
  ['MoviesDrive Endgame', () => md.getStreams('299534', 'movie', null, null)],
  ['MoviesDrive BB S01E01', () => md.getStreams('1396', 'tv', 1, 1)],
  ['MoviesHunt Dune2', () => mh.getStreams('693134', 'movie', null, null)],
  ['MoviesHunt BB S01E01', () => mh.getStreams('1396', 'tv', 1, 1)],
];

for (const [label, fn] of CASES) {
  const t0 = Date.now();
  try {
    const streams = await Promise.race([
      fn(),
      new Promise(r => setTimeout(() => r(null), 28000)),
    ]);
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    if (!streams) { console.log(`\n### ${label}: TIMEOUT (${dt}s)`); continue; }
    console.log(`\n### ${label}: ${streams.length} stream(s) in ${dt}s`);
    for (const s of streams) {
      const v = await validate(s.url);
      console.log(`   ${s.quality.padEnd(6)} ${v.ok ? 'OK ' : 'BAD'} ${String(v.status).padEnd(4)} ${String(v.ct).slice(0, 30).padEnd(30)} size=${String(v.size).slice(0, 12)} | ${s.url.slice(0, 70)}`);
    }
  } catch (e) {
    console.log(`\n### ${label}: ERROR ${e.message}`);
  }
}
