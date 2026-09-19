// src/utils/tmdb.js

import { NotFoundError, TooManyRequestsError } from '../error/index.js';
import { TMDB_PRIMARY } from './site-secrets.cjs';

const TMDB_API_KEY = TMDB_PRIMARY; // central registry — env TMDB_API_KEY override preserved (site-secrets.cjs)
const TMDB_ACCESS_TOKEN = process.env.TMDB_ACCESS_TOKEN || '';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

const imdbTmdbMap = new Map();
const tmdbImdbMap = new Map();

// ---------------------------------------------------------------------------
// Task 63 — SYSTEMIC FIX: the "most sources return no streams" class.
//
// Every source calls getTmdbId/getTmdbNameAndYear independently. For a fresh
// Stremio request (ALWAYS a tt id) that meant ~71 concurrent TMDB /find calls
// for the SAME tt plus ~71 concurrent /{type}/{id} name lookups — TMDB
// rate-limits the burst (429 → TooManyRequestsError → source returns []),
// the first resolve lands 0-10 cards, each source then caches that empty
// result for its 5-10min TTL, and every refresh inside the TTL replays the
// zero ("only few 10 sources are returning streams" / "most sources show
// nothing"). Production proof: /stream/series/tt9174598:1:1 → 0 cards
// (all 71 sources count=0, durationMs=1 — cache replay) while the same title
// via tmdb:93405:1:1 (NO /find needed) landed 10 cards in the same minute.
//
// Three changes, all inside this module so every source benefits at once:
//   1. IN-FLIGHT DEDUP — one shared promise per unique lookup key. 71 sources
//      awaiting the same tt now produce ONE upstream call.
//   2. SUCCESS CACHE for name/year lookups (TMDB details are static; 1h TTL,
//      size-capped) — repeat resolves stop re-hitting TMDB entirely.
//   3. 429-AWARE RETRY in tmdbFetch (honor Retry-After capped at 1.2s, two
//      attempts) so a single stray 429 no longer kills a source's resolve.
// A REAL NotFound (response received, no mapping) is cached for 10 minutes —
// wrong/fake ids stop re-bursting; transient network/429 throws are NOT
// cached, so recovery is immediate on the next request.
// ---------------------------------------------------------------------------

const inflightFind = new Map();   // tt id → Promise<numeric id>
const inflightExtIds = new Map(); // tmdb id → Promise<imdb id>
const inflightName = new Map();   // `${type}:${id}:${lang}` → Promise<[name, year]>
const nameYearCache = new Map();  // same key → { value, ts }
const notFoundCache = new Map();  // lookup key → ts
const CACHE_TTL = 60 * 60 * 1000;          // 1h success cache
const NOT_FOUND_TTL = 10 * 60 * 1000;      // 10min negative mapping cache
const MAX_MAP = 600;

function mapSetCapped(map, key, value) {
  if (map.size >= MAX_MAP) {
    const firstKey = map.keys().next().value;
    map.delete(firstKey);
  }
  map.set(key, value);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const tmdbFetch = async (fetcher, ctx, path, searchParams = {}) => {
  const url = new URL(`${TMDB_BASE_URL}${path}`);

  // Use Bearer token if available, otherwise api_key
  const headers = {};
  if (TMDB_ACCESS_TOKEN) {
    headers['Authorization'] = `Bearer ${TMDB_ACCESS_TOKEN}`;
  } else if (TMDB_API_KEY) {
    url.searchParams.set('api_key', TMDB_API_KEY);
  } else {
    throw new NotFoundError('TMDB API key not configured');
  }

  for (const [k, v] of Object.entries(searchParams)) {
    if (v) url.searchParams.set(k, v);
  }

  // 429-aware retry: TMDB rate windows are short; two attempts with a small
  // backoff ride out the burst class without blocking sources for long.
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(600);
    try {
      return await fetcher.json(ctx, url, { headers });
    } catch (e) {
      lastErr = e;
      const isRate = e instanceof TooManyRequestsError || e?.constructor?.name === 'TooManyRequestsError';
      if (!isRate) throw e;
      const ra = Number(e?.retryAfterMs || e?.retryAfter || 0);
      if (ra > 0 && ra < 1200) await sleep(ra);
    }
  }
  throw lastErr;
};

export const getTmdbIdFromImdbId = async (fetcher, ctx, imdbId) => {
  if (imdbTmdbMap.has(imdbId.id)) {
    return { id: imdbTmdbMap.get(imdbId.id), season: imdbId.season, episode: imdbId.episode };
  }
  const nfKey = `find:${imdbId.id}`;
  const nfTs = notFoundCache.get(nfKey);
  if (nfTs && Date.now() - nfTs < NOT_FOUND_TTL) {
    throw new NotFoundError(`Could not get TMDB ID of IMDb ID "${imdbId.id}"`);
  }
  // In-flight dedup: all sources awaiting this tt share ONE /find call.
  let p = inflightFind.get(imdbId.id);
  if (!p) {
    p = (async () => {
      const response = await tmdbFetch(fetcher, ctx, `/find/${imdbId.id}`, { external_source: 'imdb_id' });
      const id = (imdbId.season ? response.tv_results?.[0] : response.movie_results?.[0])?.id;
      if (!id) {
        mapSetCapped(notFoundCache, nfKey, Date.now());
        throw new NotFoundError(`Could not get TMDB ID of IMDb ID "${imdbId.id}"`);
      }
      mapSetCapped(imdbTmdbMap, imdbId.id, id);
      return id;
    })();
    const tracked = p.finally(() => inflightFind.delete(imdbId.id));
    tracked.catch(() => {}); // cleanup chain must NEVER become an unhandled rejection (Node 24 kills the process)
    inflightFind.set(imdbId.id, tracked);
    p = tracked;
  }
  const id = await p;
  return { id, season: imdbId.season, episode: imdbId.episode };
};

export const getImdbIdFromTmdbId = async (fetcher, ctx, tmdbId) => {
  if (tmdbImdbMap.has(tmdbId.id)) {
    return { id: tmdbImdbMap.get(tmdbId.id), season: tmdbId.season, episode: tmdbId.episode };
  }
  let p = inflightExtIds.get(tmdbId.id);
  if (!p) {
    p = (async () => {
      const type = tmdbId.season ? 'tv' : 'movie';
      const response = await tmdbFetch(fetcher, ctx, `/${type}/${tmdbId.id}/external_ids`);
      mapSetCapped(tmdbImdbMap, tmdbId.id, response.imdb_id);
      return response.imdb_id;
    })();
    const tracked = p.finally(() => inflightExtIds.delete(tmdbId.id));
    tracked.catch(() => {}); // cleanup chain must NEVER become an unhandled rejection (Node 24 kills the process)
    inflightExtIds.set(tmdbId.id, tracked);
    p = tracked;
  }
  const imdb = await p;
  return { id: imdb, season: tmdbId.season, episode: tmdbId.episode };
};

export const getTmdbNameAndYear = async (fetcher, ctx, tmdbId, language) => {
  const type = tmdbId.season ? 'tv' : 'movie';
  const key = `${type}:${tmdbId.id}:${language || ''}`;
  const cached = nameYearCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.value;

  let p = inflightName.get(key);
  if (!p) {
    p = (async () => {
      const details = await tmdbFetch(fetcher, ctx, `/${type}/${tmdbId.id}`, { language });
      const value = tmdbId.season
        ? [details.name, new Date(details.first_air_date).getFullYear(), details.original_name]
        : [details.title, new Date(details.release_date).getFullYear(), details.original_title];
      mapSetCapped(nameYearCache, key, { value, ts: Date.now() });
      return value;
    })();
    const tracked = p.finally(() => inflightName.delete(key));
    tracked.catch(() => {}); // cleanup chain must NEVER become an unhandled rejection (Node 24 kills the process)
    inflightName.set(key, tracked);
    p = tracked;
  }
  return p;
};
