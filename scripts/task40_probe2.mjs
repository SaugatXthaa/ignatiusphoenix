// Task 40 part 2 — subtitle endpoint variants + stream playability probes
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

// --- 1. subs.videasy.to variants ---
async function trySubs(label, url, extraHeaders = {}) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...extraHeaders }, signal: AbortSignal.timeout(12000) });
    const body = await res.text();
    console.log(`[subs ${label}] HTTP ${res.status} len=${body.length} :: ${body.slice(0, 160).replace(/\n/g, ' ')}`);
  } catch (e) {
    console.log(`[subs ${label}] ERR ${e.message}`);
  }
}
await trySubs('plain tt1375666', 'https://subs.videasy.to/search?id=tt1375666');
await trySubs('no-tt 1375666', 'https://subs.videasy.to/search?id=1375666');
await trySubs('with referer', 'https://subs.videasy.to/search?id=tt1375666', { 'Referer': 'https://www.vidking.net/', 'Origin': 'https://www.vidking.net' });
await trySubs('root', 'https://subs.videasy.to/');
await trySubs('movie path', 'https://subs.videasy.to/movie/tt1375666');
await trySubs('api path', 'https://subs.videasy.to/api/search?id=tt1375666');
await trySubs('json sub', 'https://subs.videasy.to/search/tt1375666');

// --- 2. Re-probe Yoru for Inception + verify 2160p playability ---
async function yoruProbe(meta) {
  const seedRes = await fetch(`${API}/seed?mediaId=${meta.tmdbId}`, { headers: HEADERS });
  const { seed } = await seedRes.json();
  const u = new URL('/cdn/sources-with-title', API);
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
  const res = await fetch(u, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) { console.log(`[${meta.label}] Yoru HTTP ${res.status}`); return; }
  const json = JSON.parse(decryptPayload(await res.text(), seed, parseInt(meta.tmdbId)));
  console.log(`\n[${meta.label}] Yoru full response:`);
  console.log('  keys:', Object.keys(json));
  for (const s of json.sources || []) {
    console.log(`  - quality=${s.quality} name=${s.name || '-'} url=${String(s.url).slice(0, 130)}`);
    if (s.subtitles?.length) console.log(`    + ${s.subtitles.length} inline subs`);
  }
  console.log('  subtitles[]:', (json.subtitles || []).length);
  // playability probe on each source url
  for (const s of json.sources || []) {
    try {
      const pr = await fetch(String(s.url), { method: 'GET', headers: { ...HEADERS, Range: 'bytes=0-255' }, signal: AbortSignal.timeout(12000) });
      const buf = new Uint8Array(await pr.arrayBuffer());
      const magic = Array.from(buf.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' ');
      const txt = Buffer.from(buf.slice(0, 200)).toString('utf8').slice(0, 80).replace(/\n/g, '|');
      console.log(`    probe [${s.quality}] HTTP ${pr.status} ct=${pr.headers.get('content-type')} cr=${pr.headers.get('content-range')} magic=${magic} :: ${txt}`);
    } catch (e) {
      console.log(`    probe [${s.quality}] ERR ${e.message}`);
    }
  }
  return json;
}

await yoruProbe({ label: 'Inception', type: 'movie', tmdbId: 27205, title: 'Inception', year: '2010', imdbId: 'tt1375666' });

// --- 3. Task S1E1 with proper imdbId (resolve via TMDB find first) ---
const TMDB_KEY = '1865f43a0549ca50d341dd9ab8b29f49';
async function tmdbFind(imdbId) {
  const r = await fetch(`https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_KEY}&external_source=imdb_id`);
  const j = await r.json();
  return j.tv_results?.[0] || j.movie_results?.[0] || null;
}
const taskMeta = await tmdbFind('tt13649940'); // Task 2025 imdb
if (taskMeta) {
  console.log(`\nTask resolved: tmdb=${taskMeta.id} name="${taskMeta.name || taskMeta.title}" year=${(taskMeta.first_air_date || taskMeta.release_date || '').slice(0, 4)}`);
  await yoruProbe({
    label: 'Task S1E1', type: 'tv', tmdbId: taskMeta.id,
    title: taskMeta.name || taskMeta.title,
    year: (taskMeta.first_air_date || '').slice(0, 4), imdbId: 'tt13649940',
    seasonId: 1, episodeId: 1,
  });
} else {
  console.log('Task tmdb find failed');
}
console.log('\nDONE');
