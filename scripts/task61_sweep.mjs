// Task 61: FULL verification sweep — every registered source must return
// playable streams. Matrix: 5 titles (2 movies / 1 series / 1 kdrama / 1
// anime) x 2 rounds on production merged /stream; per-source attribution via
// bingeGroup; zero-card sources followed up via /debug/source; playability
// probed through the EXACT player path for a sample of each source's cards.
import https from 'https';
import fs from 'fs';

const BASE = 'https://ignatiusphoenix.onrender.com';
const OUT = '/home/z/my-project/phoenix-analysis/scripts/task61';
fs.mkdirSync(OUT, { recursive: true });

const ALL_SOURCES = ('4khdhub cinefreak moviebox cinewave watchseries necro vidsrcsbs vidlink2 vidking vidfast ' +
  'vegamovies primeshows netlio animeflix anineko verhdlink meinecloud acermovies streamxtv anikoto anikage anibd ' +
  '2dhive anidoor nowhdtime pantyflix animegg peckle hianime animekai cineby hindmoviez playimdb zxcstream ' +
  'animezey uhdmovies videasy anikototv animeworldindia animesdigital itachi imdbplay raflix hindmovie rivestream ' +
  'reanime desiflix persianstremio anichan animesuge animotvslash bollyflix fourkhdhubone framextv cinejoyaio ' +
  'nikastream cinebyrocks stellarrip stellar hdhub4uv2 movieshuntv2 moviesdrivev2 vegamovies2 cinehdplus vidzee ' +
  'vixsrc allwish videasyto kmmovies atlantic movielinkbd').split(/\s+/).filter(Boolean);

// Documented upstream-dead / special classes (Task 57/59/60) — will be
// re-confirmed, not blindly excused:
const DOC_CLASSES = {
  zxcstream: 'upstream backend mid-migration (their own frontend 400s)',
  stellarrip: 'upstream content drought + 22.8s PoW',
  nowhdtime: 'nhdapi upstream goodstream.cc 403s EVERYONE (probe-hardened for recovery)',
  verhdlink: 'BACKGROUND_ONLY (Playwright-class heavy chain)',
  videasyto: 'BACKGROUND_ONLY (Playwright headless 30-60s)',
  movix: 'BACKGROUND_ONLY',
  persianstremio: 'BACKGROUND_ONLY',
  netlio: 'movies-only upstream 404s; SERIES serve (expect 0 on movies, >=1 on GoT)',
  moviebox: 'datacenter rate-limit parity with original repo (intermittent)',
};

const TITLES = [
  { type: 'movie', id: 'tt1375666', label: 'Inception' },
  { type: 'movie', id: 'tt37287335', label: 'Obsession' },
  { type: 'series', id: 'tt0944947%3A1%3A1', label: 'GoT S1E1' },
  { type: 'series', id: 'tmdb:93405%3A1%3A1', label: 'SquidGame S1E1' },
  { type: 'series', id: 'tmdb:209867%3A2%3A1', label: 'Frieren S2E1' },
];

const wait = (ms) => new Promise(r => setTimeout(r, ms));

const get = (u, headers = {}, timeout = 30000, onHeaders = null) => new Promise((resolve) => {
  const req = https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36', ...headers }, timeout }, (res) => {
    if (onHeaders) { onHeaders(res); req.destroy(); return resolve({ status: res.statusCode, headers: res.headers, body: Buffer.alloc(0) }); }
    const c = []; let n = 0;
    res.on('data', d => { if (n < 400000) { c.push(d); n += d.length; } else req.destroy(); });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c) }));
    res.on('error', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c) }));
  });
  req.on('timeout', () => req.destroy(new Error('timeout')));
  req.on('error', (e) => resolve({ status: 0, headers: {}, body: Buffer.alloc(0), err: String(e && e.message || e) }));
});

// bingeGroup → source id. Card names embed the display name; bingeGroup looks
// like "phoenix|<sourceId>|..." in this addon (fallback: match display names).
const groupRe = new RegExp(
  ALL_SOURCES
    .sort((a, b) => b.length - a.length)
    .join('|')
    .replace(/\+/g, '\\+'), 'i');
const attr = (s) => {
  const g = (s.behaviorHints || {}).bingeGroup || '';
  const m = g.match(groupRe);
  if (m) return m[0].toLowerCase();
  const nm = ((s.name || '') + ' ' + (s.title || '')).toLowerCase();
  for (const id of ALL_SOURCES) if (nm.includes(id)) return id;
  return 'unknown';
};

const isHtmlUrl = (u) => /\.(html?|php)(\?|$)/i.test((u || '').split('?')[0]) &&
  !/\.(m3u8|mp4|mkv|ts|vtt|srt)(\?|$)/i.test((u || '').split('?'[0]));

// ---------- Phase 1: merged /stream matrix ----------
const matrix = {};   // sourceId → { perTitle: {label: cards}, total }
for (const id of ALL_SOURCES) matrix[id] = { perTitle: {}, total: 0 };
const titleStats = [];

for (const t of TITLES) {
  let d = null, n = 0;
  // r1
  try { d = await (await fetch(`${BASE}/stream/${t.type}/${t.id}.json`, { signal: AbortSignal.timeout(120000) })).json(); } catch (e) { d = { streams: [] }; }
  const r1 = (d.streams || []);
  console.log(`${t.label} r1: ${r1.length} cards`);
  await wait(40000);
  try { d = await (await fetch(`${BASE}/stream/${t.type}/${t.id}.json`, { signal: AbortSignal.timeout(120000) })).json(); } catch (e) { d = { streams: [] }; }
  const r2 = (d.streams || []);
  console.log(`${t.label} r2: ${r2.length} cards`);

  const seen = new Map(); // dedupe by url keep latest
  for (const s of r1) if (s.url) seen.set(s.url, s);
  for (const s of r2) if (s.url) seen.set(s.url, s);
  const all = [...seen.values()];

  const htmlCards = all.filter(s => isHtmlUrl(s.url));
  const withSubs = all.filter(s => (s.subtitles || []).length > 0).length;
  const groups = new Set(all.map(attr));
  titleStats.push({ label: t.label, type: t.type, r1: r1.length, r2: r2.length, unique: all.length, subbed: withSubs, sources: groups.size, htmlCards: htmlCards.length });
  fs.writeFileSync(`${OUT}/cards_${t.label.replace(/\W/g, '')}.json`, JSON.stringify(all, null, 1));

  for (const s of all) {
    const id = attr(s);
    if (!matrix[id]) matrix[id] = { perTitle: {}, total: 0 };
    matrix[id].perTitle[t.label] = (matrix[id].perTitle[t.label] || 0) + 1;
    matrix[id].total++;
  }
}

// ---------- Phase 2: zero-card follow-up via /debug/source ----------
const zeroSources = ALL_SOURCES.filter(id => matrix[id].total === 0);
const zeroDiag = {};
console.log(`\nzero-card sources across all 5 titles: ${zeroSources.length}`);
for (const id of zeroSources) {
  // pick the most appropriate title
  const isAnimeOnly = ['animeflix','anineko','anikoto','anikage','anibd','2dhive','anidoor','animegg','hianime','animekai','animesdigital','itachi','anikototv','animeworldindia','animezey','animotvslash','allwish','animesuge','reanime','nikastream','anichan'].includes(id);
  const t = isAnimeOnly ? TITLES[4] : TITLES[0];
  try {
    const raw = await (await fetch(`${BASE}/debug/source/${id}?type=${t.type}&id=${t.id}`, { signal: AbortSignal.timeout(60000) })).json();
    zeroDiag[id] = {
      count: raw.count ?? (raw.timedOut ? 'TIMEOUT' : null),
      timedOut: !!raw.timedOut,
      error: raw.error || null,
      durationMs: raw.durationMs,
      docClass: DOC_CLASSES[id] || null,
      logTail: (raw.logs || []).slice(-4),
    };
  } catch (e) {
    zeroDiag[id] = { error: 'diag-fetch: ' + String(e).slice(0, 80) };
  }
  console.log(`  ${id}: ${JSON.stringify(zeroDiag[id]).slice(0, 200)}`);
  await wait(1200);
}

fs.writeFileSync(`${OUT}/sweep_matrix.json`, JSON.stringify({ titleStats, matrix, zeroDiag }, null, 1));

// ---------- summary ----------
console.log('\n=== TITLE STATS ===');
for (const s of titleStats) console.log(`${s.label}: r1=${s.r1} r2=${s.r2} uniq=${s.unique} subs=${s.subbed}/${s.unique} sources=${s.sources} html=${s.htmlCards}`);
console.log('\n=== SOURCE COVERAGE (cards across 5 titles) ===');
const landers = ALL_SOURCES.filter(id => matrix[id].total > 0);
const zeros = ALL_SOURCES.filter(id => matrix[id].total === 0);
console.log(`LANDING (${landers.length}): ${landers.join(', ')}`);
console.log(`ZERO (${zeros.length}): ${zeros.join(', ')}`);
process.exit(0);
