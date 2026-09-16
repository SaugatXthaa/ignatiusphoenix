// Task 40 part 5 — subtitle URL validation + flaky provider re-sweep
import { Fetcher } from '../src/utils/Fetcher.js';
import { decryptPayload } from '../src/utils/speedracelight.js';

const fetcher = new Fetcher(console);
const API = 'https://api.speedracelight.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = {
  'Origin': 'https://www.vidking.net',
  'Referer': 'https://www.vidking.net/',
  'User-Agent': UA,
};

async function getStreams(meta, endpoint, extraParams) {
  const seedRes = await fetch(`${API}/seed?mediaId=${meta.tmdbId}`, { headers: HEADERS });
  const { seed } = await seedRes.json();
  const u = new URL(`/${endpoint}`, API);
  u.searchParams.set('title', meta.title);
  u.searchParams.set('mediaType', meta.type);
  u.searchParams.set('year', meta.year || '');
  u.searchParams.set('episodeId', String(meta.episodeId || 1));
  u.searchParams.set('seasonId', String(meta.seasonId || 1));
  u.searchParams.set('tmdbId', String(meta.tmdbId));
  u.searchParams.set('imdbId', meta.imdbId || '');
  u.searchParams.set('enc', '2');
  u.searchParams.set('seed', seed);
  u.searchParams.set('_t', String(Date.now()));
  if (extraParams) for (const [k, v] of Object.entries(extraParams)) u.searchParams.append(k, v);
  const res = await fetch(u, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${endpoint}`);
  return JSON.parse(decryptPayload(await res.text(), seed, parseInt(meta.tmdbId)));
}

// 1. Validate the two subtitle URL families
const inc = await getStreams({ type: 'movie', tmdbId: 27205, title: 'Inception', year: '2010', imdbId: 'tt1375666' }, 'cdn/sources-with-title').catch(e => ({ err: e.message }));
if (inc.sources) {
  const sub = (inc.subtitles || [])[0];
  if (sub) {
    console.log(`cdn inline sub: lang=${sub.lang} url=${String(sub.url).slice(0, 120)}`);
    try {
      const r = await fetch(sub.url, { headers: { 'User-Agent': UA, Referer: 'https://www.vidking.net/' }, signal: AbortSignal.timeout(10000) });
      const t = await r.text();
      console.log(`  → HTTP ${r.status} ct=${r.headers.get('content-type')} head=${t.slice(0, 80).replace(/\n/g, '|')}`);
    } catch (e) { console.log(`  → ERR ${e.message}`); }
  } else console.log('cdn: no inline subs this run');
}
const inc2 = await getStreams({ type: 'movie', tmdbId: 27205, title: 'Inception', year: '2010', imdbId: 'tt1375666' }, 'm4uhd/sources-with-title').catch(e => ({ err: e.message }));
if (inc2.sources) {
  const sub = (inc2.subtitles || [])[0];
  if (sub) {
    console.log(`m4uhd sub: lang=${sub.lang} url=${String(sub.url).slice(0, 140)}`);
    try {
      const r = await fetch(sub.url, { headers: { 'User-Agent': UA, Referer: 'https://www.vidking.net/' }, signal: AbortSignal.timeout(10000) });
      const t = await r.text();
      console.log(`  → HTTP ${r.status} ct=${r.headers.get('content-type')} head=${t.slice(0, 80).replace(/\n/g, '|')}`);
    } catch (e) { console.log(`  → ERR ${e.message}`); }
  } else console.log('m4uhd: no subs this run');
}

// 2. Flaky provider re-sweep ×2 rounds with fresh seeds each
const cases = [
  ['hdmovie', null], ['hdmovie', { qualityFilter: 'English' }], ['lamovie', null],
  ['meine', { language: 'german' }], ['superflix', null], ['vsrc', null], ['downloader2', null],
];
const meta = { type: 'movie', tmdbId: 27205, title: 'Inception', year: '2010', imdbId: 'tt1375666' };
for (let round = 1; round <= 2; round++) {
  console.log(`\n--- flaky sweep round ${round} ---`);
  await Promise.all(cases.map(async ([ep, params]) => {
    try {
      const j = await getStreams(meta, ep, params);
      const n = (j.sources || []).length;
      const qs = (j.sources || []).map(s => s.quality).join(',');
      console.log(`[${ep}${params ? '+' + JSON.stringify(params) : ''}] ok — ${n}: ${qs}`);
    } catch (e) {
      console.log(`[${ep}] ${e.message.slice(0, 50)}`);
    }
  }));
}
console.log('\nDONE');
