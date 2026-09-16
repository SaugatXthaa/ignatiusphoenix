// Task 40 part 4 — inspect master playlists for AUDIO/SUBTITLES groups + dub check
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

async function getStreams(meta, endpoint) {
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
  const res = await fetch(u, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${endpoint}`);
  return JSON.parse(decryptPayload(await res.text(), seed, parseInt(meta.tmdbId)));
}

// 1. One Piece: master playlist inspection (audio/sub groups?)
try {
  const j = await getStreams({ type: 'tv', tmdbId: 37854, title: 'One Piece', year: '1999', imdbId: 'tt0388629', seasonId: 1, episodeId: 1 }, 'cdn/sources-with-title');
  if (j.playlist) {
    const m = await fetch(j.playlist, { headers: HEADERS, signal: AbortSignal.timeout(12000) });
    const txt = await m.text();
    console.log(`=== One Piece master.m3u8 (HTTP ${m.status}) ===`);
    console.log(txt.slice(0, 2500));
  }
} catch (e) { console.log('One Piece ERR', e.message); }

// 2. Frieren: m4uhd Auto HLS playlist inspection
try {
  const j = await getStreams({ type: 'tv', tmdbId: 209867, title: "Frieren: Beyond Journey's End", year: '2023', imdbId: 'tt22024441', seasonId: 1, episodeId: 1 }, 'm4uhd/sources-with-title');
  const s = j.sources?.[0];
  if (s) {
    const m = await fetch(s.url, { headers: HEADERS, signal: AbortSignal.timeout(12000) });
    const txt = await m.text();
    console.log(`=== Frieren m4uhd playlist (HTTP ${m.status}) first 1500 ===`);
    console.log(txt.slice(0, 1500));
  }
} catch (e) { console.log('Frieren m4uhd ERR', e.message); }

// 3. hdmovie (Vyse English / Fade Hindi) on One Piece — dub candidates?
for (const [nm, filt] of [['Vyse-English', 'English'], ['Fade-Hindi', 'Hindi']]) {
  try {
    const j = await getStreams({ type: 'tv', tmdbId: 37854, title: 'One Piece', year: '1999', imdbId: 'tt0388629', seasonId: 1, episodeId: 1 }, 'hdmovie/sources-with-title');
    let srcs = (j.sources || []).filter(s => s && s.url);
    if (filt) {
      const f = srcs.filter(s => String(s.quality || '').toLowerCase().includes(filt.toLowerCase()));
      if (f.length) srcs = f;
    }
    console.log(`=== One Piece hdmovie [${nm}]: ${srcs.length} sources ===`);
    for (const s of srcs.slice(0, 3)) console.log(`   q=${s.quality} url=${String(s.url).slice(0, 110)}`);
  } catch (e) { console.log(`hdmovie [${nm}] ERR`, e.message?.slice(0, 60)); }
}

// 4. Inception 2160p media playlist — codec check (hevc? 4K real?)
try {
  const j = await getStreams({ type: 'movie', tmdbId: 27205, title: 'Inception', year: '2010', imdbId: 'tt1375666' }, 'cdn/sources-with-title');
  const s2160 = (j.sources || []).find(s => s.quality === '2160p');
  if (s2160) {
    const m = await fetch(s2160.url, { headers: HEADERS, signal: AbortSignal.timeout(12000) });
    const txt = await m.text();
    const firstSeg = txt.split('\n').find(l => l && !l.startsWith('#'));
    console.log(`=== Inception 2160p media playlist (HTTP ${m.status}) ===`);
    console.log(txt.slice(0, 800));
    if (firstSeg) {
      const base = s2160.url.replace(/[^/]*$/, '');
      const segUrl = firstSeg.startsWith('http') ? firstSeg : base + firstSeg;
      const sr = await fetch(segUrl, { method: 'GET', headers: { ...HEADERS, Range: 'bytes=0-63' }, signal: AbortSignal.timeout(12000) });
      const buf = new Uint8Array(await sr.arrayBuffer());
      console.log(`segment probe: HTTP ${sr.status} ct=${sr.headers.get('content-type')} magic=${Array.from(buf.slice(0, 12)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    }
  }
} catch (e) { console.log('Inception 2160 ERR', e.message); }

console.log('\nDONE');
