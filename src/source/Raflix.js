// src/source/Raflix.js
// raflixx.vercel.app — movies/TV/anime via multiple embed providers
//
// Raflix is a Vite/TanStack Start SPA that provides embed URLs from
// multiple streaming providers via its API:
//
//   Movies/TV: GET /api/media/sources?type={movie|tv}&tmdbId={id}&season={s}&episode={e}
//   Anime:     GET /api/anime/sources?tmdbId={id}&title={title}&season={s}&episode={e}&dub={0|1}&year={y}
//
// The APIs return JSON with a "sources" array containing:
//   { id, label, kind: "embed", url, language?: "sub"|"dub" }
//
// Movies/TV get 8 sources: Anicine, XPass, MoviesAPI, FileSun, VidStorm,
//   VidRift, APIPlayer, EmbedMaster
// Anime gets 17 sources (both sub and dub): TryEmbed, AniLink, MegaVid, Vidy,
//   VidNest, MegaPlay, VidLink, Yenime, SupaPlay, NHD, NontonGo, Anicine,
//   VidRift, AniEmbed, Filmu, FrameXTV
//
// Many of these embed URLs are handled by existing extractors:
//   - Megaplay → Megaplay extractor
//   - VidNest → handled by EmbedResolver
//   - VidLink → VidLink extractor
//   - FrameXTV → NuvioExtractor (framextv source)
//   - Others → EmbedResolver/ExternalUrl fallback
//
// ENRICHED METADATA:
//   - height: 1080 (default, resolved by extractor)
//   - sourceType: WebDL (default)
//   - audioLabel: SUB/DUB for anime, English for movies
//   - serverName: from API source label

import { CountryCode, Format } from '../types.js';
import { getTmdbId, getTmdbNameAndYear, TmdbId } from '../utils/index.js';
import { Source } from './Source.js';
import { TMDB_PRIMARY } from '../utils/site-secrets.cjs'; // central site-secret registry (env-overridable)

const BASE_URL = 'https://raflixx.vercel.app';
const TMDB_API_KEY = TMDB_PRIMARY;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let _gotScraping = null;
async function getGot() {
  if (_gotScraping) return _gotScraping;
  try { const mod = await import('got-scraping'); _gotScraping = mod.gotScraping; }
  catch (e) { console.error('[raflix] Failed to load got-scraping:', e.message); }
  return _gotScraping;
}

async function gotJson(url, timeoutMs = 12000) {
  const got = await getGot();
  if (!got) return null;
  // Task 51: h2 GOAWAY class — got-scraping defaults to HTTP/2, and raflix's
  // upstream closes h2 sessions aggressively ("New streams cannot be created
  // after receiving a GOAWAY" zeroed the whole source). One fast retry on the
  // GOAWAY class (index.js forceHls precedent) + h1 as the second attempt.
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await got(url, {
        headers: { 'User-Agent': UA, 'Accept': 'application/json' },
        timeout: { request: timeoutMs },
        throwHttpErrors: false,
        followRedirect: true,
        http2: attempt === 0,
      });
      if (res.statusCode !== 200) return null;
      try { return JSON.parse(res.body); } catch { return null; }
    } catch (e) {
      lastErr = e;
      const msg = e?.message || String(e);
      if (!/GOAWAY|HTTP\/2|stream/i.test(msg)) throw e;
      await new Promise(r => setTimeout(r, 400));
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

// Detect anime via TMDB genres + original language
async function isAnimeContent(fetcher, ctx, tmdbId) {
  try {
    const type = tmdbId.season ? 'tv' : 'movie';
    const url = new URL(`https://api.themoviedb.org/3/${type}/${tmdbId.id}`);
    url.searchParams.set('api_key', TMDB_API_KEY);
    const data = await fetcher.json(ctx, url);
    if (!data) return false;
    if ((data.genres || []).some(g => g.id === 16)) return true;
    if (data.original_language === 'ja') return true;
    return false;
  } catch { return false; }
}

// Fetch media sources (movies/TV)
async function fetchMediaSources(type, tmdbId, season, episode) {
  let url = `${BASE_URL}/api/media/sources?type=${type}&tmdbId=${tmdbId}`;
  if (type === 'tv' && season && episode) {
    url += `&season=${season}&episode=${episode}`;
  }
  const data = await gotJson(url);
  return data?.ok ? (data.sources || []) : [];
}

// ─── CinePro (Anicine Embed worker) server-side resolution ─────────────
// The "Anicine Embed" server URL (api.anicine-embed.workers.dev/movie/{id})
// is an HTML SPA shell — UNPLAYABLE in mpv ("[mpv] unrecognized file format"
// was shipped to users this way). But the worker behind it exposes a fully
// server-resolvable API (reverse-engineered from its JS bundle):
//   1. GET /v1/token                              → { token }
//   2. GET /v1/movies/{tmdbId}                    → { sources: [...] }
//      GET /v1/tv/{tmdbId}/seasons/{s}/episodes/{e}
//      (Authorization: Bearer <token>)
//   3. Each source URL is the worker's own /v1/proxy?data=<b64url-json>
//      wrapper; decoding `data` yields the REAL upstream m3u8 URL plus the
//      exact User-Agent/Referer it requires.
// The upstream playlists use RELATIVE variant URLs, so streams are routed
// through the addon's /proxy (referer=) which rewrites the whole HLS tree.
let _cineproToken = { token: null, ts: 0 };
const CINEPRO_TOKEN_TTL = 50 * 60 * 1000; // server-side expiresAt ≈ 1h

const CINEPRO_WORKER = 'https://api.anicine-embed.workers.dev';

async function cineproFetch(url, headers, timeoutMs = 12000) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getCineproToken(force = false) {
  if (!force && _cineproToken.token && Date.now() - _cineproToken.ts < CINEPRO_TOKEN_TTL) {
    return _cineproToken.token;
  }
  const d = await cineproFetch(`${CINEPRO_WORKER}/v1/token`, { 'User-Agent': UA });
  if (!d?.token) throw new Error('no token in response');
  _cineproToken = { token: d.token, ts: Date.now() };
  return _cineproToken.token;
}

// Resolve CinePro sources → [{ url, referer, userAgent, label }]
async function resolveCinePro(mediaType, tmdbId, season, episode) {
  const out = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const token = await getCineproToken(attempt > 0);
      const auth = { 'User-Agent': UA, Authorization: `Bearer ${token}` };
      const apiPath = mediaType === 'tv'
        ? `${CINEPRO_WORKER}/v1/tv/${tmdbId}/seasons/${season || 1}/episodes/${episode || 1}`
        : `${CINEPRO_WORKER}/v1/movies/${tmdbId}`;
      const data = await cineproFetch(apiPath, auth);
      const sources = Array.isArray(data?.sources) ? data.sources : [];

      for (const [i, s] of sources.entries()) {
        const rawUrl = typeof s?.url === 'string' ? s.url : '';
        if (!rawUrl) continue;
        // Preferred: decode the worker's signed /v1/proxy?data= blob to get the
        // REAL upstream URL + headers — lets our /proxy rewrite the HLS tree
        // (upstream playlists use relative variant URLs) instead of depending
        // on the worker's own proxy for every segment.
        const m = rawUrl.match(/[?&]data=([^&]+)/);
        if (m) {
          try {
            const blob = JSON.parse(decodeURIComponent(m[1]));
            if (blob?.url && typeof blob.url === 'string' && blob.url.startsWith('http')) {
              out.push({
                url: blob.url,
                referer: blob.headers?.Referer || '',
                userAgent: blob.headers?.['User-Agent'] || '',
                label: `CinePro ${i + 1}`,
              });
              continue;
            }
          } catch { /* blob decode failed — fall through */ }
        }
        // Fallback: ship the worker's proxy URL as-is ONLY if it looks like HLS
        if (/\.m3u8|\/m3u8|\/playlist/i.test(rawUrl)) {
          out.push({ url: rawUrl, referer: '', userAgent: '', label: `CinePro ${i + 1}` });
        }
      }
      return out;
    } catch (e) {
      if (attempt === 1) {
        console.log(`[raflix] CinePro resolution failed: ${e.message?.slice(0, 80)}`);
        return out;
      }
      // 401/expired-token path — retry once with a fresh token
    }
  }
  return out;
}

// Fetch anime sources (sub + dub)
async function fetchAnimeSources(tmdbId, title, season, episode, year) {
  const results = { sub: [], dub: [] };

  for (const dub of [0, 1]) {
    const params = new URLSearchParams({
      tmdbId: String(tmdbId),
      title,
      season: String(season || 1),
      episode: String(episode || 1),
      dub: String(dub),
    });
    if (year) params.set('year', String(year));

    const data = await gotJson(`${BASE_URL}/api/anime/sources?${params.toString()}`);
    if (data?.ok && Array.isArray(data.sources)) {
      const lang = dub === 1 ? 'dub' : 'sub';
      results[lang] = data.sources;
    }
  }

  return results;
}

export class Raflix extends Source {
  constructor(fetcher) {
    super();
    this.id = 'raflix';
    this.label = 'Raflix';
    this.contentTypes = ['movie', 'series'];
    this.countryCodes = [CountryCode.multi, CountryCode.hi, CountryCode.en, CountryCode.ja];
    this.baseUrl = BASE_URL;
    this.fetcher = fetcher;
    this.ttl = 10 * 60 * 1000;
  }

  async handleInternal(ctx, _type, id) {
    const tmdbId = await getTmdbId(this.fetcher, ctx, id);
    const [name, year] = await getTmdbNameAndYear(this.fetcher, ctx, tmdbId);
    const title = name + (tmdbId.season ? ` ${TmdbId.formatSeasonAndEpisode(tmdbId)}` : ` (${year})`);

    const isAnime = await isAnimeContent(this.fetcher, ctx, tmdbId);
    const mediaType = tmdbId.season ? 'tv' : 'movie';
    const season = tmdbId.season || null;
    const episode = tmdbId.episode || null;

    const results = [];

    if (isAnime) {
      // Fetch anime sources (sub + dub)
      console.log(`[raflix] Fetching anime sources for ${name}...`);
      const animeSources = await fetchAnimeSources(tmdbId.id, name, season, episode, year);

      for (const [lang, sources] of Object.entries(animeSources)) {
        for (const src of sources) {
          if (!src.url || typeof src.url !== 'string') continue;
          if (!src.url.startsWith('http')) continue;

          let url;
          try { url = new URL(src.url); } catch { continue; }

          const isDub = lang === 'dub';
          const countryCodes = isDub
            ? [CountryCode.multi, CountryCode.en, CountryCode.ja]
            : [CountryCode.multi, CountryCode.ja, CountryCode.en];

          const audioLabel = isDub ? 'English (Dub)' : 'Japanese (Sub)';

          results.push({
            url,
            format: Format.hls,
            meta: {
              countryCodes,
              title: `${title} — [Raflix ${src.label}] ${audioLabel}`,
              sourceId: this.id,
              sourceLabel: this.label,
              height: 1080,
              sourceType: 'WebDL',
              codec: 'x264',
              serverName: `${src.label} ${lang.toUpperCase()}`,
              audioLabel: isDub ? 'English' : 'Japanese',
              isMultiAudio: true,
            },
          });
        }
      }
    } else {
      // Fetch movie/TV sources
      console.log(`[raflix] Fetching media sources for ${name}...`);
      const sources = await fetchMediaSources(mediaType, tmdbId.id, season, episode);

      for (const src of sources) {
        if (!src.url || typeof src.url !== 'string') continue;
        if (!src.url.startsWith('http')) continue;

        let url;
        try { url = new URL(src.url); } catch { continue; }

        results.push({
          url,
          format: Format.hls,
          meta: {
            countryCodes: [CountryCode.multi, CountryCode.en],
            title: `${title} — [Raflix ${src.label}]`,
            sourceId: this.id,
            sourceLabel: this.label,
            height: 1080,
            sourceType: 'WebDL',
            codec: 'x264',
            serverName: src.label,
            audioLabel: 'English',
          },
        });
      }

      // CinePro server-side resolution (the "Anicine Embed" server). The raw
      // anicine URL above is an HTML SPA shell that mpv cannot play — resolve
      // it to real HLS sources instead. These use the dedicated 'raflixnuvio'
      // sourceId (NOT 'raflix') so NuvioExtractor claims ONLY these streams
      // and routes them through /proxy with whole-tree Referer rewriting;
      // the raw embed results above keep flowing through the normal
      // extractor registry untouched.
      const cinepro = await resolveCinePro(mediaType, tmdbId.id, season, episode);
      for (const cp of cinepro) {
        let url;
        try { url = new URL(cp.url); } catch { continue; }

        const meta = {
          countryCodes: [CountryCode.multi, CountryCode.en],
          title: `${title} — [Raflix ${cp.label}]`,
          sourceId: 'raflixnuvio',
          sourceLabel: this.label,
          height: 1080,
          sourceType: 'WebDL',
          codec: 'h264',
          serverName: cp.label,
          audioLabel: 'English',
          nuvioProvider: true,
          ...(cp.referer && { nuvioReferer: cp.referer }),
          ...(cp.userAgent && { nuvioUserAgent: cp.userAgent }),
        };

        results.push({ url, format: Format.hls, meta });
      }
      if (cinepro.length > 0) {
        console.log(`[raflix] +${cinepro.length} CinePro stream(s) (server-resolved)`);
      }
    }

    console.log(`[raflix] ${results.length} stream(s)${isAnime ? ' [anime]' : ''}`);
    return results;
  }
}
