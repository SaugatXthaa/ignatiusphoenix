#!/usr/bin/env node
/** Task 57: local test of the hls.lol migration (atlantic + natsuki). */
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { getStreams } = require_('/home/z/my-project/phoenix-analysis/src/nuvio/atlantic.cjs');

const TMDB_API = process.env.TMDB_API_KEY || '439c478a771f35c05022f9feabcca01c';
async function meta(tmdbId, type) {
  const r = await fetch(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_API}&append_to_response=external_ids`);
  const j = await r.json();
  return { title: (type === 'tv' ? j.name : j.title), year: (j.release_date || j.first_air_date || '').slice(0, 4), imdbId: j.external_ids?.imdb_id || '' };
}

console.log('=== natsuki header test ===');
const nh = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', 'Origin': 'https://atlantic.st', 'Referer': 'https://atlantic.st/' };
const nr = await fetch('https://natsuki.hls.lol/subs?tmdbId=27205&type=movie', { headers: nh, signal: AbortSignal.timeout(10000) }).catch(e => ({ status: 0, err: e.message }));
console.log('natsuki status:', nr.status, nr.err || '');
if (nr.status === 200) { const t = await nr.text(); console.log('natsuki body head:', t.slice(0, 200)); }

console.log('\n=== atlantic getStreams (Inception movie) ===');
const m = await meta(27205, 'movie');
const t0 = Date.now();
const streams = await getStreams(27205, 'movie', null, null, { title: m.title, year: m.year, imdbId: m.imdbId, hostUrl: 'http://localhost:7000/', fetcher: null, ctx: null });
console.log(`count=${streams.length} @${Date.now() - t0}ms`);
for (const s of streams.slice(0, 8)) console.log('  ', s.quality, '|', s.title?.slice(0, 70), '|', String(s.url).slice(0, 90));

console.log('\n=== atlantic getStreams (GoT S1E1 tv) ===');
const g = await meta(1399, 'tv');
const t1 = Date.now();
const gs = await getStreams(1399, 'tv', 1, 1, { title: g.title, year: g.year, imdbId: g.imdbId, hostUrl: 'http://localhost:7000/', fetcher: null, ctx: null });
console.log(`count=${gs.length} @${Date.now() - t1}ms`);
for (const s of gs.slice(0, 8)) console.log('  ', s.quality, '|', s.title?.slice(0, 70), '|', String(s.url).slice(0, 90));
