// Task 22: deep verification of ALL 68 sources via /debug/source (bypasses cache)
// Matrix: each source gets type-appropriate titles; empty results get one
// cross-check retry with a different title before being reported EMPTY.
import { readFileSync, writeFileSync } from 'node:fs';

const BASE = process.env.AUDIT_BASE || 'http://127.0.0.1:4591';

// Source classification (id -> category) from names + known catalog traits
const ANIME_IDS = new Set(['animeflix','anineko','anikoto','anikage','anibd','2dhive','anidoor',
  'pantyflix','animegg','peckle','hianime','animekai','anikototv','animeworldindia','itachi',
  'anichan','animesuge','allwish','stellarrip','stellar']);
const HINDI_IDS = new Set(['bollyflix','hindmoviez','hindmovie','desiflix','vegamovies','primeshows',
  'movieshuntv2','hdhub4uv2','uhdmovies','fourkhdhubone','kmmovies','moviesdrivev2','acermovies','cinejoyaio']);
const PERSIAN_IDS = new Set(['persianstremio']);
const SERIES_ONLY = new Set(['cinehdplus','watchseries']);

const TITLES = {
  movieGlobal: [
    { id: 'tmdb:299534', label: 'Endgame' },
    { id: 'tmdb:911430', label: 'F1' },
  ],
  movieAnime: [{ id: 'tmdb:372058', label: 'YourName' }],
  seriesGlobal: [
    { id: 'tt0903747:1:1', label: 'BB-S1E1' },
    { id: 'tmdb:95396:2:1', label: 'Severance-S2E1' },
  ],
  seriesAnime: [
    { id: 'tmdb:1429:1:1', label: 'AoT-S1E1' },
    { id: 'tmdb:209867:2:1', label: 'Frieren-S2E1' },
  ],
};

function matrixFor(id) {
  const out = [];
  if (ANIME_IDS.has(id)) {
    out.push(['series', TITLES.seriesAnime[0]], ['series', TITLES.seriesAnime[1]],
             ['movie', TITLES.movieAnime[0]]);
  } else if (HINDI_IDS.has(id)) {
    out.push(['movie', TITLES.movieGlobal[1]], ['movie', TITLES.movieGlobal[0]],
             ['series', TITLES.seriesGlobal[0]]);
  } else if (PERSIAN_IDS.has(id)) {
    out.push(['movie', TITLES.movieGlobal[0]], ['series', TITLES.seriesGlobal[0]],
             ['movie', TITLES.movieGlobal[1]]);
  } else {
    out.push(['movie', TITLES.movieGlobal[0]], ['series', TITLES.seriesGlobal[0]],
             ['series', TITLES.seriesGlobal[1]]);
  }
  if (SERIES_ONLY.has(id)) out.unshift(['series', TITLES.seriesGlobal[0]]);
  return out;
}

async function probe(sourceId, type, rawId, timeoutMs = 75000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/debug/source/${sourceId}?type=${type}&id=${rawId}`, { signal: ctl.signal });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const d = await res.json();
    if (d.timedOut) return { timeout: true, ms: d.durationMs };
    if (d.error) return { error: d.error, ms: d.durationMs };
    return { count: d.count, ms: d.durationMs };
  } catch (e) {
    return { error: e?.name === 'AbortError' ? 'client-timeout' : String(e?.message || e).slice(0, 80) };
  } finally { clearTimeout(timer); }
}

const sources = JSON.parse(readFileSync('/tmp/task22_sources.json', 'utf8'));
const results = {};
const CONC = 6;
const queue = [...sources];
let done = 0;

async function worker(wid) {
  while (queue.length) {
    const id = queue.shift();
    if (!id) break;
    const matrix = matrixFor(id);
    const trials = [];
    let best = null;
    for (const [type, t] of matrix) {
      const r = await probe(id, type, t.id);
      trials.push({ type, title: t.label, ...r });
      if (typeof r.count === 'number' && r.count > 0) { best = r; break; }
      // short breather between failing probes
      await new Promise(res => setTimeout(res, 300));
    }
    results[id] = { best, trials };
    done++;
    const status = best ? `PASS(${best.count})` :
      trials.some(t => t.timeout) ? 'TIMEOUT' :
      trials.some(t => t.error) ? `ERR:${trials.find(t => t.error).error.slice(0, 40)}` : 'EMPTY';
    console.log(`[${String(done).padStart(2)}/68] ${id}: ${status} (${trials.map(x => `${x.title}=${x.count ?? x.error ?? 'TO'}`).join(' ')})`);
  }
}
await Promise.all(Array.from({ length: CONC }, (_, i) => worker(i)));
writeFileSync('/tmp/task22_audit.json', JSON.stringify(results, null, 2));
const pass = Object.entries(results).filter(([, r]) => r.best).length;
console.log(`\n==== first-pass: ${pass}/${sources.length} sources returned streams ====`);
