// Task 40 part 3 — full JSON dump: playlist field, anime subs/languages, dub check
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

async function fullProbe(label, meta, endpoints) {
  const seedRes = await fetch(`${API}/seed?mediaId=${meta.tmdbId}`, { headers: HEADERS });
  const { seed } = await seedRes.json();
  console.log(`\n===== ${label} (seed ${String(seed).slice(0, 18)}...) =====`);
  for (const ep of endpoints) {
    const u = new URL(`/${ep}`, API);
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
    try {
      const res = await fetch(u, { headers: HEADERS, signal: AbortSignal.timeout(12000) });
      if (!res.ok) { console.log(`[${ep}] HTTP ${res.status}`); continue; }
      const json = JSON.parse(decryptPayload(await res.text(), seed, parseInt(meta.tmdbId)));
      console.log(`[${ep}] sources=${(json.sources || []).length} subs=${(json.subtitles || []).length} playlist=${json.playlist ? (typeof json.playlist === 'string' ? json.playlist.slice(0, 80) : JSON.stringify(json.playlist).slice(0, 200)) : 'null'}`);
      for (const s of json.sources || []) {
        console.log(`   q=${s.quality} name=${s.name || '-'} lang=${s.language || s.lang || '-'} url=${String(s.url).slice(0, 100)}`);
      }
      for (const s of (json.subtitles || []).slice(0, 6)) {
        console.log(`   SUB lang=${s.lang || s.language} url=${String(s.url).slice(0, 100)}`);
      }
      if (json.thumbnail) console.log(`   thumbnail: ${String(json.thumbnail).slice(0, 90)}`);
      if (json.playlist) console.log(`   playlist FULL: ${JSON.stringify(json.playlist).slice(0, 600)}`);
    } catch (e) {
      console.log(`[${ep}] ERR ${e.message?.slice(0, 60)}`);
    }
  }
}

// Frieren S1E1 — anime: full dump of all endpoints that answered last time
await fullProbe('Frieren S1E1 tmdb:209867', {
  type: 'tv', tmdbId: 209867, title: "Frieren: Beyond Journey's End", year: '2023',
  imdbId: 'tt22024441', seasonId: 1, episodeId: 1,
}, ['cdn/sources-with-title', 'm4uhd/sources-with-title', 'hdmovie/sources-with-title', 'lamovie/sources-with-title']);

// One Piece anime (long-running, likely dub) tmdb 37854 S1E1
await fullProbe('One Piece S1E1 tmdb:37854', {
  type: 'tv', tmdbId: 37854, title: 'One Piece', year: '1999',
  imdbId: 'tt0388629', seasonId: 1, episodeId: 1,
}, ['cdn/sources-with-title', 'm4uhd/sources-with-title']);

// Inception — dump playlist field via m4uhd (Breach had Auto HLS + playhq subs)
await fullProbe('Inception m4uhd+cdn playlist check', {
  type: 'movie', tmdbId: 27205, title: 'Inception', year: '2010', imdbId: 'tt1375666',
}, ['cdn/sources-with-title', 'm4uhd/sources-with-title', 'downloader2/sources-with-title']);

console.log('\nDONE');
