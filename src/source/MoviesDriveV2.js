// src/source/MoviesDriveV2.js
// new3.moviesdrive.christmas — movies/TV/anime with direct GDrive streams (up to 4K)
//
// Uses the all-in-one scraper (src/nuvio/moviesdrive_v2.cjs) which:
//   1. Searches MoviesDrive via /search.php (Typesense backend)
//   2. Fetches movie page → extracts hubcloud.cx links + base64-encoded quality
//   3. Visits hubcloud.cx → gets FROM_AC_TOKEN → calls search API
//   4. Picks best file → fetches /drive/{fileId} page → finds gamerxyt URL
//   5. Visits gamerxyt.com → finds pixel.hubcloud.cx URL
//   6. Follows pixel.hubcloud.cx → pixel.<name>.workers.dev → gamerxyt.com/dl.php
//      → extracts link= param → final video-downloads.googleusercontent.com URL
//
// URL HANDLING:
//   - googleusercontent.com URLs don't support HTTP Range — DirectStream
//     extractor routes them through /range-proxy for Range translation
//     (so Stremio can seek to any timestamp)
//
// ENRICHED METADATA (from filename):
//   - height: 480/720/1080/2160 (from quality)
//   - codec: HEVC (x265) for 4K, x264 for lower — from filename
//   - sourceType: BluRay / WEB-DL — from filename
//   - HDR: HDR10 / DolbyVision — from filename
//   - audioLabel: Dual-Audio / Multi-Audio / Hindi / English / Japanese (anime)
//   - fileSize: parsed from filename ([3.4GB] etc.)
//
// ANIME SUPPORT:
//   - Detects anime via TMDB genres (Animation=16) or original_language=ja
//   - Anime files typically have "Dual Audio" or "Multi Audio" in filename
//     (Japanese + English/Hindi dub)
//   - Audio label set to "Japanese (Sub)" or "English (Dub)" for anime
//
// SUBTITLES:
//   - Source-provided: file typically has "ESub" marker (English subtitles
//     embedded in MKV) — these are detected but not extracted (MKV internal)
//   - OpenSubtitles fallback: StreamResolver fetches multi-language subs
//     by IMDB ID for streams without source subtitles

import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import bytes from 'bytes';
import { CountryCode } from '../types.js';
import { getTmdbId, getTmdbNameAndYear, TmdbId } from '../utils/index.js';
import { Source } from './Source.js';
import { buildStreamResults } from './nuvioHelpers.js';
import { TMDB_PRIMARY } from '../utils/site-secrets.cjs'; // central site-secret registry (env-overridable)

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROVIDER_PATH = path.join(__dirname, '..', 'nuvio', 'moviesdrive_v2.cjs');
const require_ = createRequire(import.meta.url);

let _scraperMod = null;
function getScraperModule() {
  if (_scraperMod) return _scraperMod;
  try { _scraperMod = require_(PROVIDER_PATH); }
  catch (e) { console.error(`[moviesdrive-v2] failed to load scraper: ${e?.message || e}`); }
  return _scraperMod;
}

function parseHeight(q) {
  if (!q) return undefined;
  const s = String(q).toLowerCase();
  if (s.includes('2160') || s.includes('4k')) return 2160;
  if (s.includes('1080')) return 1080;
  if (s.includes('720')) return 720;
  if (s.includes('480')) return 480;
  const m = s.match(/(\d{3,4})/);
  return m ? parseInt(m[1]) : undefined;
}

// Detect anime via TMDB genres + original language
async function isAnimeContent(fetcher, ctx, tmdbId) {
  try {
    const type = tmdbId.season ? 'tv' : 'movie';
    const url = new URL(`https://api.themoviedb.org/3/${type}/${tmdbId.id}`);
    url.searchParams.set('api_key', TMDB_PRIMARY);
    const data = await fetcher.json(ctx, url);
    if (!data) return false;
    const genres = data.genres || [];
    if (genres.some(g => g.id === 16)) return true; // Animation genre
    if (data.original_language === 'ja') return true; // Japanese origin
    return false;
  } catch {
    return false;
  }
}

export class MoviesDriveV2 extends Source {
  constructor(fetcher) {
    super();
    this.id = 'moviesdrivev2';
    this.label = 'MoviesDrive';
    this.contentTypes = ['movie', 'series'];
    this.countryCodes = [CountryCode.multi, CountryCode.hi, CountryCode.en];
    this.baseUrl = 'https://new3.moviesdrive.christmas';
    this.fetcher = fetcher;
    this.ttl = 10 * 60 * 1000;
  }

  async handleInternal(ctx, _type, id) {
    const tmdbId = await getTmdbId(this.fetcher, ctx, id);
    const [name, year] = await getTmdbNameAndYear(this.fetcher, ctx, tmdbId);
    const title = name + (tmdbId.season ? ` ${TmdbId.formatSeasonAndEpisode(tmdbId)}` : ` (${year})`);

    // Detect anime for proper audio labeling
    const isAnime = await isAnimeContent(this.fetcher, ctx, tmdbId);

    const mod = getScraperModule();
    if (!mod || typeof mod.getStreams !== 'function') return [];

    const mediaType = tmdbId.season ? 'tv' : 'movie';
    // Task 34: deadline-aware partial top-up. Re-sweeps are cheap now that
    // the scraper caches discovery and continues its quality pool (Task 34
    // in moviesdrive_v2.cjs), so sweeps that delivered 0-1 cards get another
    // chance within the remaining wrapper budget. The old unconditional
    // retry loop re-ran the FULL discovery chain per attempt, burned its
    // 30s race cap on re-discovery, and shipped 0 cards on Render's 0.1-CPU
    // instances (production /debug/stream: count=0-1 at durationMs≈23s while
    // the same title resolved 4 streams in 3-6s from sandbox).
    const RACE_MS = 30000;        // keep under the resolver's 35s cutoff
    const TOPUP_MAX = 2;          // bounded extra sweeps
    const TOPUP_BELOW = 4;        // full quality ladder (2160/1080/720/480) —
                                  // a partial sweep gets topped up; the extra
                                  // sweep is nearly free (discovery cache hit
                                  // + pool continuation) and adds 0 when the
                                  // upstream post genuinely has fewer tiers
    const TOPUP_MIN_MS = 8000;    // skip sweeps that cannot finish in time
    const TOPUP_DELAY_MS = 1500;  // let the in-flight pool progress first
    const t0 = Date.now();
    const remainingMs = () => RACE_MS - (Date.now() - t0);

    const runSweep = () => Promise.race([
      mod.getStreams(String(tmdbId.id), mediaType, tmdbId.season || null, tmdbId.episode || null),
      new Promise(r => setTimeout(() => r(null), Math.max(3000, remainingMs()))),
    ]);

    let streams;
    try {
      streams = await runSweep();
      for (let attempt = 0; attempt < TOPUP_MAX; attempt++) {
        if (!Array.isArray(streams)) break;          // race cap consumed
        if (streams.length >= TOPUP_BELOW) break;    // healthy sweep
        if (remainingMs() < TOPUP_MIN_MS) break;     // no budget for another
        await new Promise(r => setTimeout(r, TOPUP_DELAY_MS));
        const more = await runSweep();
        if (!Array.isArray(more)) break;             // race cap consumed
        const seenUrls = new Set((streams || []).map(s => s && s.url));
        const fresh = more.filter(s => s && s.url && !seenUrls.has(s.url));
        if (fresh.length > 0) {
          streams = streams.concat(fresh)
            .sort((a, b) => (parseHeight(b.quality) || 0) - (parseHeight(a.quality) || 0));
          console.log(`[moviesdrive-v2] top-up sweep +${fresh.length} card(s) → ${streams.length} total`);
        } else {
          break; // pool fully resolved with nothing new — no point re-sweeping
        }
      }
    } catch (e) {
      console.error(`[moviesdrive-v2] error: ${e?.message || e}`);
      return [];
    }

    if (!Array.isArray(streams) || streams.length === 0) return [];

    const enrichedStreams = streams.map(s => {
      const height = parseHeight(s.quality) || 1080;
      // Use codec from scraper (detected from filename) or fallback
      const codec = s._codec || (height >= 2160 ? 'HEVC' : 'x264');
      const sourceType = s._sourceType || 'WebDL';
      const hdr = s._hdr || '';
      const fileSize = s._fileSize;
      // Task 33: audio label — prefer the scraper's per-file language
      // detection (parsed from the actual release text: "English" for
      // English-only files, "Dual-Audio" for Hindi+English, …) over the old
      // hardcoded "Hindi + English" that mislabeled English-only files.
      const audioLabel = s._language || (isAnime ? 'Japanese + English' : 'Hindi + English');

      // Country codes based on audio + anime
      const countryCodes = isAnime
        ? [CountryCode.multi, CountryCode.ja, CountryCode.en]
        : audioLabel === 'English' ? [CountryCode.multi, CountryCode.en]
        : audioLabel === 'Hindi' ? [CountryCode.multi, CountryCode.hi]
        : [CountryCode.multi, CountryCode.hi, CountryCode.en];

      // Build display title with enriched metadata
      const hdrTag = hdr ? ` ${hdr}` : '';
      const audioTag = isAnime ? ' [SUB+DUB]' : '';
      const displayTitle = `[MoviesDrive ${height}p ${sourceType} ${codec}${hdrTag} ${audioLabel}]${audioTag}`;

      return {
        url: s.url,
        quality: height + 'p',
        title: displayTitle,
        name: 'MoviesDrive - ' + (s.quality || height + 'p'),
        size: fileSize ? bytes(fileSize) : undefined,
        // Don't set headers — googleusercontent URLs go through /range-proxy
        // which sets its own User-Agent. Setting headers here would make
        // NuvioExtractor claim them and route through /proxy instead.
        _countryCodes: countryCodes,
        _fileSize: fileSize,
        _sourceType: sourceType,
        _codec: codec,
        _hdr: hdr,
        _isAnime: isAnime,
      };
    });

    const results = buildStreamResults({
      streams: enrichedStreams,
      title,
      sourceId: this.id,
      sourceLabel: this.label,
      countryCodes: this.countryCodes,
      ctx,
    });

    // Apply per-stream enriched metadata
    for (const r of results) {
      const matchedStream = enrichedStreams.find(s => s.url === r.url.href);
      if (matchedStream) {
        if (matchedStream._countryCodes) r.meta.countryCodes = matchedStream._countryCodes;
        if (matchedStream._sourceType) r.meta.sourceType = matchedStream._sourceType;
        if (matchedStream._codec) r.meta.codec = matchedStream._codec;
        if (matchedStream._hdr) r.meta.hdr = matchedStream._hdr;
        if (matchedStream._fileSize) r.meta.bytes = matchedStream._fileSize;
        if (matchedStream._isAnime) {
          r.meta.audioLabel = 'Japanese + English';
          r.meta.isMultiAudio = true;
        }
      }
    }

    console.log(`[moviesdrive-v2] ${results.length} playable stream(s)${isAnime ? ' [anime]' : ''}`);
    return results;
  }
}
