// Task 40 — probe api.speedracelight.com with ALL 9 providers from the current
// vidking VideoPlayer-D5eTfQPp.js bundle, + subs.videasy.to subtitle search.
// Usage: node scripts/task40_probe_srl.mjs
import { Fetcher } from '../src/utils/Fetcher.js';
import { decryptPayload } from '../src/utils/speedracelight.js';

const logger = console;
const fetcher = new Fetcher(logger);

const API = 'https://api.speedracelight.com';
const HEADERS = {
  'Origin': 'https://www.vidking.net',
  'Referer': 'https://www.vidking.net/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

// Full registry from the current bundle
const PROVIDERS = [
  { name: 'Yoru',    endpoint: 'cdn/sources-with-title' },
  { name: 'Cypher',  endpoint: 'downloader2/sources-with-title' },
  { name: 'Breach',  endpoint: 'm4uhd/sources-with-title' },
  { name: 'Neon',    endpoint: 'vsrc/sources-with-title' },
  { name: 'Vyse',    endpoint: 'hdmovie/sources-with-title', qualityFilter: 'English' },
  { name: 'Killjoy', endpoint: 'meine/sources-with-title', params: { language: 'german' } },
  { name: 'Fade',    endpoint: 'hdmovie/sources-with-title', qualityFilter: 'Hindi' },
  { name: 'Omen',    endpoint: 'lamovie/sources-with-title' },
  { name: 'Raze',    endpoint: 'superflix/sources-with-title' },
];

async function getSeed(tmdbId) {
  const res = await fetch(`${API}/seed?mediaId=${tmdbId}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`seed HTTP ${res.status}`);
  const json = await res.json();
  return json.seed;
}

async function probeProvider(seed, p, meta) {
  const u = new URL(`/${p.endpoint}`, API);
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
  if (p.params) for (const [k, v] of Object.entries(p.params)) u.searchParams.append(k, v);

  const t0 = Date.now();
  try {
    const res = await fetch(u, { headers: { ...HEADERS, 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(15000) });
    const ms = Date.now() - t0;
    if (!res.ok) return { name: p.name, status: `HTTP ${res.status}`, ms, sources: [] };
    const body = await res.text();
    let json;
    try {
      json = JSON.parse(decryptPayload(body, seed, parseInt(meta.tmdbId)));
    } catch (e) {
      return { name: p.name, status: `decrypt-fail (${e.message})`, ms, sources: [] };
    }
    let sources = (json.sources || []).filter(s => s && s.url);
    if (p.qualityFilter) {
      const f = sources.filter(s => String(s.quality || '').toLowerCase().includes(p.qualityFilter.toLowerCase()));
      if (f.length) sources = f;
    }
    return {
      name: p.name, status: 'ok', ms,
      sources: sources.map(s => ({ quality: s.quality, url: String(s.url).slice(0, 110), name: s.name || null })),
      subtitles: (json.subtitles || []).slice(0, 3).map(s => ({ lang: s.lang, url: String(s.url).slice(0, 90) })),
      subtitleCount: (json.subtitles || []).length,
    };
  } catch (e) {
    return { name: p.name, status: `ERR ${e.message}`.slice(0, 60), ms: Date.now() - t0, sources: [] };
  }
}

async function probeCase(label, meta) {
  console.log(`\n========== ${label} ==========`);
  console.log(`meta: ${JSON.stringify({ ...meta })}`);
  let seed;
  try {
    seed = await getSeed(meta.tmdbId);
    console.log(`seed: ${String(seed).slice(0, 24)}...`);
  } catch (e) {
    console.log(`SEED FAILED: ${e.message}`);
    return;
  }
  const results = await Promise.all(PROVIDERS.map(p => probeProvider(seed, p, meta)));
  for (const r of results) {
    const srcStr = r.sources.map(s => `${s.quality}`).join(', ') || '-';
    console.log(`[${r.name}] ${r.status} @${r.ms}ms — ${r.sources.length} sources: ${srcStr}`);
    if (r.subtitleCount) console.log(`    subtitles: ${r.subtitleCount} — ${JSON.stringify(r.subtitles)}`);
    if (r.sources.length) console.log(`    url0: ${r.sources[0].url}`);
  }
}

// ---- subtitles probe ----
async function probeSubs(imdbId, label, season, episode) {
  let url = `https://subs.videasy.to/search?id=${imdbId}`;
  if (season) url += `&season=${season}&episode=${episode}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': HEADERS['User-Agent'] }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) { console.log(`[subs ${label}] HTTP ${res.status}`); return; }
    const arr = await res.json();
    const byLang = {};
    for (const s of arr) byLang[s.language] = (byLang[s.language] || 0) + 1;
    console.log(`[subs ${label}] HTTP ${res.status} — ${arr.length} subs, langs: ${JSON.stringify(byLang)}`);
    if (arr[0]) console.log(`  sample: ${JSON.stringify({ language: arr[0].language, format: arr[0].format, url: String(arr[0].url).slice(0, 100) })}`);
  } catch (e) {
    console.log(`[subs ${label}] ERR ${e.message}`);
  }
}

// Inception — movie
await probeCase('MOVIE: Inception (2010) tmdb:27205', {
  type: 'movie', tmdbId: 27205, title: 'Inception', year: '2010', imdbId: 'tt1375666',
});
// Frieren S1E1 — anime TV (sub/dub check)
await probeCase('ANIME TV: Frieren S1E1 tmdb:209867', {
  type: 'tv', tmdbId: 209867, title: 'Frieren: Beyond Journey\'s End', year: '2023',
  imdbId: 'tt22024441', seasonId: 1, episodeId: 1,
});
// Task 2025 S1E1 — regular TV
await probeCase('TV: Task S1E1 tmdb:275295 (approx)', {
  type: 'tv', tmdbId: 30758, title: 'Task', year: '2025', imdbId: '', seasonId: 1, episodeId: 1,
});

await probeSubs('tt1375666', 'Inception');
await probeSubs('tt22024441', 'Frieren S1E1', 1, 1);
console.log('\nDONE');
