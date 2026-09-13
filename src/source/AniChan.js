// src/source/AniChan.js
// anichan.net — anime with sub/dub HLS streams (up to 1080p)
//
// AniChan uses AniList IDs and a clean JSON API:
//   1. Search: GET /search?q={query} → HTML with /anime/{anilistId}/{slug} links
//   2. Episodes: GET /api/watch/episodes?anilistId={id}
//      → { episodes: N, sources: [{name, host, sub: bool, dub: bool}], dubAvailable: bool }
//   3. Servers: GET /api/watch/servers?anilistId={id}&episode={ep}&type={sub|dub}
//      → { servers: [{name, label, host, type: "hls", stream: "/api/watch/m3u8?sh=...", subtitles: [...]}] }
//   4. Stream: GET /api/watch/m3u8?sh={path}&sig={sig}&exp={exp}
//      → HLS master m3u8 with relative variant URLs (also /api/watch/m3u8?sh=...)
//
// The m3u8 has RELATIVE URLs (/api/watch/m3u8?sh=...) that must be resolved
// against anichan.net. Stremio's player can't resolve these, so we route
// through /proxy. The proxy buffers the m3u8, detects #EXTM3U, rewrites
// relative URLs to absolute /proxy URLs, and serves with correct Content-Type.
//
// Both SUB (Japanese audio) and DUB (English audio) are supported.
// The API returns the same stream for sub/dub when dub is not available —
// we deduplicate by URL so only one stream appears.

import { CountryCode, Format } from '../types.js';
import { getTmdbId, getTmdbNameAndYear, TmdbId } from '../utils/index.js';
import { Source } from './Source.js';

// 2026-09 domain change: anichan.net 301s to anichan.to and the watch APIs are
// now session-gated — POST /api/watch/session (Turnstile token may be empty)
// returns an `anichan_ws` cookie scoped to /api/watch, required by the
// episodes/servers endpoints. The stream URLs themselves carry sig+exp auth
// and play WITHOUT the cookie.
const BASE = 'https://anichan.to';
const ANILIST_GQL = 'https://graphql.anilist.co';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const normalize = (s) => (s || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

// ─── Session bootstrap (anichan.to /api/watch cookie gate) ───
// The servers/episodes endpoints return 401 {"detail":"session"} without the
// anichan_ws cookie obtained from POST /api/watch/session. The cookie value
// embeds its own expiry (epoch seconds as the first dot-separated segment of
// the value), so we cache it and refresh a few minutes early.
let _acCookie = null;
let _acCookieExp = 0;

async function getAniChanCookie() {
  const now = Date.now() / 1000;
  if (_acCookie && now < _acCookieExp - 300) return _acCookie;
  try {
    const { gotScraping } = await import('got-scraping');
    const res = await gotScraping.post(`${BASE}/api/watch/session`, {
      headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: '' }),
      timeout: { request: 15000 },
      throwHttpErrors: false,
      http2: false,
    });
    if (res.statusCode !== 200) return null;
    // Parse the session cookie from set-cookie headers
    let setCookies = res.headers['set-cookie'] || [];
    if (typeof setCookies === 'string') setCookies = [setCookies];
    for (const sc of setCookies) {
      const m = String(sc).match(/anichan_ws=([^;]+)/);
      if (m) {
        _acCookie = m[1];
        // Cookie value starts with its expiry epoch — parse with a 5min buffer
        const exp = parseFloat(m[1]);
        _acCookieExp = Number.isFinite(exp) && exp > now ? exp : now + 7000;
        return _acCookie;
      }
    }
  } catch { /* fall through */ }
  return null;
}

async function apiGet(path, anilistId = null) {
  const { gotScraping } = await import('got-scraping');

  const doFetch = async (cookie) => {
    const res = await gotScraping.get(`${BASE}${path}`, {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json',
        // 2026-09: the servers endpoint now rejects requests without a
        // watch-page Referer + XHR marker (intermittent 401 {"detail":"session"})
        ...(anilistId && { Referer: `${BASE}/watch/${anilistId}`, 'X-Requested-With': 'XMLHttpRequest' }),
        ...(cookie && path.startsWith('/api/watch') && { Cookie: `anichan_ws=${cookie}` }),
      },
      timeout: { request: 15000 },
      throwHttpErrors: false,
      followRedirect: true,
      http2: false, // Avoid GOAWAY errors from AniChan's HTTP/2 server
    });
    return res;
  };

  // 2026-09 (Task 21): the server rejects a session cookie long before its
  // embedded expiry (observed: cached cookie 401s {"detail":"session"} on every
  // call for hours while the value still parses as unexpired). On the first
  // session rejection, drop the cached cookie, mint a fresh one and retry once.
  let res = await doFetch(await getAniChanCookie());
  if (res.statusCode === 401 && String(res.body).includes('"session"')) {
    _acCookie = null;
    _acCookieExp = 0;
    res = await doFetch(await getAniChanCookie());
  }
  if (res.statusCode !== 200) return null;
  try { return JSON.parse(res.body); } catch { return null; }
}

async function resolveAniList(name) {
  const query = `
    query($search: String) {
      Page(page: 1, perPage: 5) {
        media(type: ANIME, search: $search, sort: [SEARCH_MATCH, POPULARITY_DESC]) {
          id idMal title { romaji english } format
        }
      }
    }`;
  try {
    const { gotScraping } = await import('got-scraping');
    const res = await gotScraping.post(ANILIST_GQL, {
      headers: { 'User-Agent': UA, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ query, variables: { search: name } }),
      timeout: { request: 15000 }, throwHttpErrors: false,
      http2: false, // Avoid GOAWAY errors
    });
    if (res.statusCode !== 200) return null;
    const data = JSON.parse(res.body);
    return data?.data?.Page?.media || [];
  } catch { return null; }
}

// Fallback: resolve via Jikan API (MyAnimeList wrapper) when AniList is down.
// Returns an array of media objects with the same shape as AniList results.
async function resolveViaJikan(name, year) {
  const JIKAN_API = 'https://api.jikan.moe/v4';
  try {
    const searchUrl = `${JIKAN_API}/anime?q=${encodeURIComponent(name)}&limit=5&sfw=true`;
    const res = await fetch(searchUrl, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const results = data?.data;
    if (!Array.isArray(results) || results.length === 0) return null;
    // Convert Jikan results to AniList-like shape
    return results.map(r => ({
      id: null, // No AniList ID — will use MAL ID instead
      idMal: r.mal_id,
      title: { romaji: r.title_japanese || r.title, english: r.title_english || r.title },
      format: r.type === 'TV' ? 'TV' : r.type === 'MOVIE' ? 'MOVIE' : 'TV',
    }));
  } catch { return null; }
}

// Fallback: search anichan.net directly by title (returns AniList IDs from
// the site's own search index). This works even when AniList API is down.
async function resolveViaAniChanSearch(name) {
  try {
    const { gotScraping } = await import('got-scraping');
    const res = await gotScraping.get(`${BASE}/search?q=${encodeURIComponent(name)}`, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html' },
      timeout: { request: 10000 }, throwHttpErrors: false, http2: false,
    });
    if (res.statusCode !== 200) return null;
    // Parse /anime/{anilistId}/{slug} links from HTML
    const matches = [...res.body.matchAll(/\/anime\/(\d+)\/([a-z0-9-]+)/gi)];
    if (matches.length === 0) return null;
    // Convert to AniList-like shape
    return matches.map(m => ({
      id: parseInt(m[1]),
      idMal: null,
      title: { romaji: m[2].replace(/-/g, ' '), english: m[2].replace(/-/g, ' ') },
      format: 'TV',
    }));
  } catch { return null; }
}

export class AniChan extends Source {
  constructor(fetcher) {
    super();
    this.id = 'anichan';
    this.label = 'AniChan';
    this.contentTypes = ['movie', 'series'];
    this.countryCodes = [CountryCode.multi, CountryCode.ja, CountryCode.en];
    this.baseUrl = BASE;
    this.fetcher = fetcher;
    this.ttl = 5 * 60 * 1000; // 5min — stream URLs have time-limited tokens
  }

  async handleInternal(ctx, _type, id) {
    const tmdbId = await getTmdbId(this.fetcher, ctx, id);
    const [name, year] = await getTmdbNameAndYear(this.fetcher, ctx, tmdbId);
    const title = name + (tmdbId.season ? ` ${TmdbId.formatSeasonAndEpisode(tmdbId)}` : ` (${year})`);

    // Step 1: Resolve AniList ID (with fallbacks when AniList is down)
    let mediaList = await resolveAniList(name);
    if (!mediaList?.length) {
      // AniList is down — search anichan.net directly (returns AniList IDs)
      mediaList = await resolveViaAniChanSearch(name);
    }
    if (!mediaList?.length) {
      // Last resort: Jikan API (returns MAL IDs, not AniList IDs)
      mediaList = await resolveViaJikan(name, year);
      if (!mediaList?.length) return [];
    }

    const nameNorm = normalize(name);
    const firstName = nameNorm.split(' ')[0];
    let bestMedia = null;
    let bestScore = 0;
    for (const m of mediaList) {
      const titles = [m.title?.english, m.title?.romaji].filter(Boolean);
      for (const t of titles) {
        const tNorm = normalize(t);
        if (!tNorm) continue;
        let score = 0;
        if (tNorm === nameNorm) score = 100;
        else if (tNorm.includes(nameNorm) || nameNorm.includes(tNorm)) {
          score = Math.min(tNorm.length, nameNorm.length) / Math.max(tNorm.length, nameNorm.length) * 90;
        }
        // First-word equality — resolves sequel/spelling variants the
        // containment rule misses: TMDB "Naruto Shippūden" vs AniList
        // "Naruto: Shippuuden" (shippuden != shippuuden, no containment).
        // Both normalize to the same first word "naruto" → strong match.
        else if (firstName && firstName.length >= 4 && tNorm.split(' ')[0] === firstName) {
          score = 65 + Math.min(15, firstName.length);
        }
        if (score > bestScore) { bestScore = score; bestMedia = m; }
      }
    }
    if (!bestMedia || bestScore < 60) {
      return [];
    }

    const anilistId = bestMedia.id;
    if (!anilistId) return [];

    // Step 2: Check episodes and dub availability
    const epData = await apiGet(`/api/watch/episodes?anilistId=${anilistId}`, anilistId);
    if (!epData) {
      return [];
    }

    const epNum = tmdbId.season ? (tmdbId.episode || 1) : 1;
    const dubAvailable = epData.dubAvailable === true;

    // Step 3: Fetch streams for sub and dub
    const results = [];
    const seenUrls = new Set();
    const types = dubAvailable ? ['sub', 'dub'] : ['sub'];

    for (const type of types) {
      try {
        // Servers endpoint is heavily gated (intermittent 401 {"detail":"session"}
        // even on fresh cookies) — up to two bounded retries with backoff
        let data = await apiGet(`/api/watch/servers?anilistId=${anilistId}&episode=${epNum}&type=${type}`, anilistId);
        if (!data?.servers?.length) {
          await new Promise(r => setTimeout(r, 800));
          data = await apiGet(`/api/watch/servers?anilistId=${anilistId}&episode=${epNum}&type=${type}`, anilistId);
        }
        if (!data?.servers?.length) {
          await new Promise(r => setTimeout(r, 1600));
          data = await apiGet(`/api/watch/servers?anilistId=${anilistId}&episode=${epNum}&type=${type}`, anilistId);
        }
        if (!data?.servers?.length) continue;

        for (const server of data.servers) {
          if (!server.stream) continue;

          // Build absolute stream URL
          const streamUrl = server.stream.startsWith('http')
            ? server.stream
            : `${BASE}${server.stream}`;
          if (seenUrls.has(streamUrl)) continue;
          seenUrls.add(streamUrl);

          let parsed;
          try { parsed = new URL(streamUrl); } catch { continue; }

          // Determine audio label and country codes
          const audioLabel = type === 'dub' ? 'DUB' : 'SUB';
          const countryCodes = type === 'dub'
            ? [CountryCode.multi, CountryCode.en]
            : [CountryCode.multi, CountryCode.ja];

          // The NuvioExtractor routes this URL through /proxy with forceHls=1.
          // The m3u8 at /api/watch/m3u8 has RELATIVE variant URLs that must
          // be rewritten — the proxy buffers, detects #EXTM3U, rewrites URLs.
          results.push({
            url: parsed,  // ORIGINAL URL — NuvioExtractor routes through /proxy
            format: Format.hls,
            meta: {
              countryCodes,
              title: `${title} (AniChan ${audioLabel})`,
              sourceId: this.id,
              sourceLabel: this.label,
              height: 1080,
              // NuvioExtractor flags — route through /proxy with forceHls
              nuvioProvider: true,
              nuvioForceHls: true,
            },
          });
        }
      } catch (e) {
      }
    }

    return results;
  }
}
