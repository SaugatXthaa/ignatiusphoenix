// src/source/StreamXTV.js
// streamxtv.sbs — direct playable streams (up to 4K) + streamxtv.tech anime aggregator
//
// ─── PRIMARY: streamxtv.sbs direct streams (api.framextv.tech) ───
// The streamxtv.sbs backend at api.framextv.tech exposes 20 provider
// backends (barbarian, goblin, super_barbarian, VidCore CDN family, …).
// Querying them ALL with the provider=<p> param (src/nuvio/streamxtv.cjs)
// returns DIRECT PLAYABLE HLS (m3u8) streams — up to 4K (2160p) — with:
//   - per-source request headers (Referer varies per CDN, e.g.
//     moon.peakstorm.top → https://player.videasy.to/) → routed through
//     /proxy by NuvioExtractor (meta.nuvioReferer)
//   - title-level subtitles in ~25 languages (subs5.strem.io VTT) →
//     meta.subtitles → attached to the final Stremio stream output
//   - quality labels normalized + sorted 4K-first; the source wrapper
//     appends WEB-DL/HEVC/HDR/x264 markers so StreamResolver.enrichMeta
//     produces enriched metadata (height, codec, sourceType, HDR)
//
// This is the same API the FrameX source uses, but FrameX only queries the
// default provider (no 4K) — this source sweeps all 20 and also keeps the
// streamxtv.tech-specific paths below.
//
// ─── SECONDARY: streamxtv.tech embeds + anime (kept as before) ───
// StreamXTV is a React SPA backed by a clean JSON API at
//   https://streamx-backend-myr0.onrender.com/api
// It bundles ~22 third-party embed providers. The site's own embed player
// (embed.streamxtv.tech) is currently dead (HTTP 402), so we route to
// third-party providers that have working extractors in this addon:
//
//   - vidsrc-embed.ru/embed/movie/{id}        → VidSrc extractor
//   - www.vidking.net/embed/movie/{id}        → VidKing extractor
//   - player.vidzee.wtf/embed/movie/{id}      → Vidzee extractor
//   - player.videasy.net/movie/{id}           → (via meta.vidking fallback)
//
// These embed results are now a FALLBACK only — they are emitted when the
// direct API returns nothing, preserving the source's pre-existing behavior
// as a safety net (the same providers are also available as standalone
// sources: VidKing, Vidzee, Videasy, VidSrcSbs).
//
// For anime, Stremio passes kitsu:/mal: IDs which we resolve to TMDB, then
// to a name, then search streamxtv's AniList-backed /anime/search endpoint
// to get the AniList ID. We then build megaplay.buzz URLs with sub/dub:
//   https://megaplay.buzz/stream/ani/{anilistId}/{ep}/{sub|dub}
//
// The Megaplay extractor routes these through /proxy with the appropriate
// Referer so Stremio can attempt playback.
//
// NOTE: The Render free-tier backend sleeps when idle. First request after
// inactivity can take 15-30s. We use a 30s timeout to handle cold starts.

import * as cheerio from 'cheerio';
import path from 'path';
import { fileURLToPath } from 'url';
import { CountryCode } from '../types.js';
import { getTmdbId, getTmdbNameAndYear, TmdbId } from '../utils/index.js';
import { Source } from './Source.js';
import { buildStreamResults, parseHeight, callNuvioProvider, normalizeAudioTracks, buildAudioLabel } from './nuvioHelpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROVIDER_PATH = path.join(__dirname, '..', 'nuvio', 'streamxtv.cjs');

const API_BASE = 'https://streamx-backend-myr0.onrender.com/api';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Providers with working extractors in this addon (embed fallback only)
const MOVIE_TV_PROVIDERS = [
  { label: 'VidSrc',   movie: 'https://vidsrc-embed.ru/embed/movie/{id}?autoplay=0',  tv: 'https://vidsrc-embed.ru/embed/tv/{id}-{s}-{e}?autoplay=0&autonext=0' },
  { label: 'VidKing',  movie: 'https://www.vidking.net/embed/movie/{id}?autoPlay=false', tv: 'https://www.vidking.net/embed/tv/{id}/{s}/{e}?autoPlay=false&nextEpisode=false' },
  { label: 'Vidzee',   movie: 'https://player.vidzee.wtf/embed/movie/{id}',           tv: 'https://player.vidzee.wtf/embed/tv/{id}?season={s}&episode={e}' },
  { label: 'Videasy',  movie: 'https://player.videasy.net/movie/{id}',                tv: 'https://player.videasy.net/tv/{id}/{s}/{e}' },
];

// Anime providers — Megaplay is the most reliable, with sub/dub support
const ANIME_PROVIDERS = [
  { label: 'Megaplay', url: 'https://megaplay.buzz/stream/ani/{anilistId}/{ep}/{subDub}' },
  { label: 'VidNest',  url: 'https://vidnest.fun/anime/{anilistId}/{ep}/{subDub}' },
];

// Normalize for fuzzy matching
const normalize = (s) => (s || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

async function fetchJson(url, referer) {
  const { gotScraping } = await import('got-scraping');
  const res = await gotScraping.get(url, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json,text/plain,*/*', ...(referer && { Referer: referer }) },
    timeout: { request: 30000 },
    throwHttpErrors: false,
  });
  if (res.statusCode !== 200) return null;
  try { return JSON.parse(res.body); } catch { return null; }
}

export class StreamXTV extends Source {
  constructor(fetcher) {
    super();
    this.id = 'streamxtv';
    this.label = 'StreamXTV';
    this.contentTypes = ['movie', 'series'];
    this.countryCodes = [CountryCode.multi, CountryCode.ja];
    this.baseUrl = 'https://streamxtv.tech';
    this.fetcher = fetcher;
    this.ttl = 10 * 60 * 1000; // 10min — direct stream URLs are tokened/short-lived
  }

  async handleInternal(ctx, _type, id) {
    const tmdbId = await getTmdbId(this.fetcher, ctx, id);
    const [name, year] = await getTmdbNameAndYear(this.fetcher, ctx, tmdbId);

    const title = name + (tmdbId.season ? ` ${TmdbId.formatSeasonAndEpisode(tmdbId)}` : ` (${year})`);

    const results = [];

    // ─── 1) DIRECT PLAYABLE STREAMS (primary) ───
    // streamxtv.sbs backend — sweeps all 20 provider backends and returns
    // direct HLS (up to 4K/2160p) with per-source Referer headers and
    // multi-language subtitles. The API handles movies AND TV (anime is TV
    // on TMDB, so series/anime all use type=tv with season/episode).
    //
    // Started WITHOUT await so the sweep runs in parallel with the anime
    // lookup below — total handleInternal time is max(sweep, anime) instead
    // of sum(sweep, anime), protecting the 35s StreamResolver source timeout.
    const apiType = tmdbId.season ? 'tv' : 'movie';
    const directPromise = callNuvioProvider(PROVIDER_PATH, {
      tmdbId: tmdbId.id,
      mediaType: apiType,
      season: tmdbId.season || null,
      episode: tmdbId.episode || null,
      // 20-provider sweep: ~10-16s typical, 22s internal deadline.
      // Must stay well under StreamResolver's 35s SOURCE_TIMEOUT.
      timeoutMs: 25000,
    }).catch(() => []);

    // Detect anime via TMDB genres: genre 16 (Animation) + keyword 210024 (anime)
    // OR by checking if streamxtv's anime search returns a strong match.
    // Also used for the Japanese audio marker on direct streams.
    // (Runs concurrently with the direct-API sweep started above.)
    const animeMatch = await this.findAniListId(name);

    // Await the sweep result (concurrently resolved with the anime lookup)
    const directStreams = await directPromise;

    if (directStreams.length > 0) {
      // Enrich streams with metadata markers for StreamResolver.enrichMeta
      // (same format as FrameX / 4KHDHub: quality is already parsed from
      // s.quality; markers add codec / sourceType / HDR / audio language)
      for (const s of directStreams) {
        const height = parseHeight(s.quality);
        const markers = ['WEB-DL'];
        if (height === 2160) { markers.push('HEVC'); markers.push('HDR'); }
        else { markers.push('x264'); }
        // Audio language — prefer the API's own audioTracks metadata
        // ("Dual Audio (Hindi + English)" / "Hindi" / …), which also drives
        // the language flags + DUAL/MULTI tags via buildStreamResults;
        // fall back to the anime/English default when absent.
        markers.push(buildAudioLabel(normalizeAudioTracks(s.audioTracks), s.hasMultipleAudio)
          || (animeMatch?.id ? 'Japanese' : 'English'));
        s.title = (s.title || '') + ' ' + markers.join(' ');
      }

      results.push(...buildStreamResults({
        streams: directStreams,
        title,
        sourceId: this.id,
        sourceLabel: this.label,
        // Anime → Japanese audio marker; everything else → English/multi.
        // (These feed StreamResolver's "Audio:" label + country flags.)
        countryCodes: animeMatch?.id
          ? [CountryCode.multi, CountryCode.ja, CountryCode.en]
          : [CountryCode.multi, CountryCode.en],
        ctx,
      }));
    }

    // ─── 2) ANIME path — Megaplay sub/dub embeds (unchanged) ───
    if (animeMatch && animeMatch.id) {
      // ANIME path — build Megaplay URLs with sub + dub
      // Skip when Jikan/Kitsu fallback gave us only a malId (no anilistId):
      // streamxtv's anime embed URL templates all require {anilistId}.
      const epNum = tmdbId.season ? (tmdbId.episode || 1) : 1;
      for (const subDub of ['sub', 'dub']) {
        for (const provider of ANIME_PROVIDERS) {
          const url = provider.url
            .replace('{anilistId}', animeMatch.id)
            .replace('{ep}', epNum)
            .replace('{subDub}', subDub);
          results.push({
            url: new URL(url),
            meta: {
              countryCodes: [CountryCode.multi, CountryCode.ja, ...(subDub === 'dub' ? [CountryCode.en] : [])],
              title: `${title} (${provider.label} ${subDub.toUpperCase()})`,
              sourceId: this.id,
              sourceLabel: this.label,
            },
          });
        }
      }
    }

    // ─── 3) MOVIES / TV embed fallback — only when the direct API returned
    // nothing (preserves the source's pre-existing behavior as a net) ───
    // Pass meta.vidking for movies only — speedracelight returns wrong content
    // for series/anime (see VidSrc.js / Movie4kTo.js comments).
    if (directStreams.length === 0) {
      const vidkingMeta = tmdbId.season ? null : {
        name, year, tmdbId: tmdbId.id,
      };

      for (const source of MOVIE_TV_PROVIDERS) {
        const url = tmdbId.season
          ? source.tv.replace('{id}', tmdbId.id).replace('{s}', tmdbId.season).replace('{e}', tmdbId.episode)
          : source.movie.replace('{id}', tmdbId.id);

        results.push({
          url: new URL(url),
          meta: {
            countryCodes: [CountryCode.multi],
            title: `${title} (${source.label})`,
            ...(vidkingMeta && { vidking: vidkingMeta }),
          },
        });
      }
    }

    return results;
  }

  // Search streamxtv's anime backend to find AniList ID for this title.
  // streamxtv's /anime/search endpoint is itself AniList-backed, so when
  // AniList is down, this returns no results. Fall back to Jikan/Kitsu.
  // Returns { id, malId, title } or null if no match.
  async findAniListId(name) {
    const queries = [
      name,
      name.normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
      name.replace(/[^a-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim(),
    ].filter((q, i, arr) => q && arr.indexOf(q) === i);

    const nameNorm = normalize(name);

    for (const query of queries) {
      const url = `${API_BASE}/anime/search?q=${encodeURIComponent(query)}`;
      const data = await fetchJson(url, 'https://streamxtv.tech/');
      if (!data?.results?.length) continue;

      // Find best match by normalized title comparison
      let best = null;
      let bestScore = 0;
      for (const r of data.results) {
        const rNorm = normalize(r.title);
        if (!rNorm) continue;
        // Exact match
        if (rNorm === nameNorm) { best = r; bestScore = 100; break; }
        // One contains the other
        if (rNorm.includes(nameNorm) || nameNorm.includes(rNorm)) {
          const score = Math.min(rNorm.length, nameNorm.length) / Math.max(rNorm.length, nameNorm.length);
          if (score > bestScore) { best = r; bestScore = score; }
        }
        // First-word match (good for "Naruto Shippuden" → "Naruto")
        const firstName = nameNorm.split(' ')[0];
        if (firstName.length > 3 && rNorm.startsWith(firstName)) {
          const score = firstName.length / rNorm.length * 0.7;
          if (score > bestScore) { best = r; bestScore = score; }
        }
      }

      // Only accept matches with a reasonable score
      if (best && bestScore >= 50) {
        return { id: best.id, malId: null, title: best.title };
      }
    }

    // Fallback: Jikan API (MyAnimeList wrapper) — returns MAL IDs only.
    // NOTE: streamxtv's anime embed URLs require anilistId, so a Jikan-only
    // result will be gracefully skipped by the caller. Kept for parity with
    // the Itachi fallback pattern + future mal-based URL templates.
    try {
      const jikanUrl = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(name)}&limit=5&sfw=true`;
      const jikanData = await fetchJson(jikanUrl);
      const results = jikanData?.data || [];
      let best = null;
      let bestScore = 0;
      for (const r of results) {
        const titles = [r.title_english, r.title_japanese, r.title].filter(Boolean);
        for (const t of titles) {
          const rNorm = normalize(t);
          if (!rNorm) continue;
          let score = 0;
          if (rNorm === nameNorm) { score = 100; }
          else if (rNorm.includes(nameNorm) || nameNorm.includes(rNorm)) {
            score = Math.min(rNorm.length, nameNorm.length) / Math.max(rNorm.length, nameNorm.length) * 90;
          }
          if (score > bestScore) { bestScore = score; best = r; }
        }
      }
      if (best && bestScore >= 50) {
        return {
          id: null, // No AniList ID — caller will skip the anime path
          malId: best.mal_id,
          title: best.title_english || best.title_japanese || best.title,
        };
      }
    } catch { /* fall through to Kitsu */ }

    // Fallback: Kitsu API — no AniList/MAL IDs, but lets us match the title
    try {
      const kitsuUrl = `https://kitsu.app/api/edge/anime?filter[text]=${encodeURIComponent(name)}&page[limit]=5`;
      const kitsuData = await fetchJson(kitsuUrl);
      const results = kitsuData?.data || [];
      let best = null;
      let bestScore = 0;
      for (const r of results) {
        const titles = [r.attributes?.titles?.en, r.attributes?.titles?.en_jp, r.attributes?.canonicalTitle].filter(Boolean);
        for (const t of titles) {
          const rNorm = normalize(t);
          if (!rNorm) continue;
          let score = 0;
          if (rNorm === nameNorm) { score = 100; }
          else if (rNorm.includes(nameNorm) || nameNorm.includes(rNorm)) {
            score = Math.min(rNorm.length, nameNorm.length) / Math.max(rNorm.length, nameNorm.length) * 90;
          }
          if (score > bestScore) { bestScore = score; best = r; }
        }
      }
      if (best && bestScore >= 50) {
        return {
          id: null,
          malId: null,
          title: best.attributes?.titles?.en || best.attributes?.canonicalTitle || name,
        };
      }
    } catch { /* give up */ }

    return null;
  }
}
