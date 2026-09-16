// src/source/VegaMoviesNew.js
// vegamovies2 — new2.vegamovies.futbol: movies/TV/anime with DIRECT
// googleusercontent downloads (up to 4K), via the nexdrive → fastdl chain.
//
// NOTE: a legacy `vegamovies` source (VidKing placeholder approach) already
// exists; this is the Task 24 direct-chain implementation added alongside it.
//
// Chain (see src/nuvio/vegamovies.cjs for the full map):
//   1. ts-search.php (Typesense proxy) search → post
//   2. post page → nexdrive.fit links with quality labels
//   3. nexdrive page → fastdl.zip embed id (per-episode on season packs)
//   4. fastdl embed → video-downloads.googleusercontent.com DIRECT file
//
// URL HANDLING:
//   - googleusercontent.com URLs don't support HTTP Range — DirectStream
//     routes them through /range-proxy for seek support (same as MoviesDrive).
//
// ENRICHED METADATA (from the post's quality labels):
//   - height: 480/720/1080/2160
//   - codec: HEVC/x264 — from label
//   - sourceType: WebDL/BluRay/HDRip — from label
//   - fileSize: parsed from label ([1.3GB/E] = per-episode size)
//   - audio: Hindi + English dual-audio (site's standard), Japanese for anime
//
// SUBTITLES:
//   - Posts marked "English With Subtitles" / "ESub" carry embedded English
//     subs inside the MKV; the plugin's OpenSubtitles fallback attaches
//     multi-language subs by IMDB ID.
//
// MIRROR LIMITATION (documented, Task 24):
//   - nexdrive pages embed several mirrors; ONLY fastdl.zip is resolvable
//     headlessly. vcloud.fit and filebee/filepress sit behind Cloudflare
//     managed challenges (cf-mitigated: challenge) and gdtot.dad is parked,
//     so files whose pages are vcloud-only (mostly older uploads) honestly
//     return zero instead of a wrong or dead link. The actively-updated
//     catalog (2026 uploads) is fastdl-backed and resolves fully.

import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import bytes from 'bytes';
import { CountryCode } from '../types.js';
import { getTmdbId, getTmdbNameAndYear, TmdbId } from '../utils/index.js';
import { Source } from './Source.js';
import { buildStreamResults } from './nuvioHelpers.js';
import { TMDB_PRIMARY } from '../utils/site-secrets.cjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROVIDER_PATH = path.join(__dirname, '..', 'nuvio', 'vegamovies.cjs');
const require_ = createRequire(import.meta.url);

let _scraperMod = null;
function getScraperModule() {
  if (_scraperMod) return _scraperMod;
  try { _scraperMod = require_(PROVIDER_PATH); }
  catch (e) { console.error(`[vegamovies2] failed to load scraper: ${e?.message || e}`); }
  return _scraperMod;
}

function parseHeight(q) {
  if (!q) return undefined;
  const s = String(q).toLowerCase();
  if (s.includes('2160') || s.includes('4k')) return 2160;
  if (s.includes('1080')) return 1080;
  if (s.includes('720')) return 720;
  if (s.includes('480')) return 480;
  const m = s.match(/(\d{3,4})p/);
  return m ? parseInt(m[1]) : undefined;
}

// Task 39: real audio list from the post label — the site prints
// "Dual Audio (Hindi DD5.1 + ESubs)" / "{Hindi-English}" / "Hindi ORG DD5.1".
// Returns a canonical "Hindi + English"-style label or null (anime default
// then applies). Only the site's own text is used — no invention.
function parseAudioFromLabel(label) {
  const t = String(label || '');
  const langs = [];
  const add = (name) => { if (name && !langs.includes(name)) langs.push(name); };
  if (/\bhindi\b|\bhin\b|\borg\b/i.test(t)) add('Hindi');
  if (/\benglish\b|\beng\b/i.test(t)) add('English');
  if (/\btamil\b/i.test(t)) add('Tamil');
  if (/\btelugu\b/i.test(t)) add('Telugu');
  if (/\bmalayalam\b/i.test(t)) add('Malayalam');
  if (/\bjapanese\b/i.test(t)) add('Japanese');
  if (/\bkorean\b/i.test(t)) add('Korean');
  if (langs.length === 0) return null;
  return langs.join(' + ');
}

// Detect anime via TMDB genres + original language
async function isAnimeContent(fetcher, ctx, tmdbId) {
  try {
    const type = tmdbId.season ? 'tv' : 'movie';
    const url = new URL(`https://api.themoviedb.org/3/${type}/${tmdbId.id}`);
    url.searchParams.set('api_key', TMDB_PRIMARY);
    const data = await fetcher.json(ctx, url);
    if (!data) return false;
    if ((data.genres || []).some(g => g.id === 16)) return true; // Animation
    if (data.original_language === 'ja') return true;            // Japanese origin
    return false;
  } catch {
    return false;
  }
}

export class VegaMoviesNew extends Source {
  constructor(fetcher) {
    super();
    this.id = 'vegamovies2';
    this.label = 'VegaMovies Direct';
    this.contentTypes = ['movie', 'series'];
    this.countryCodes = [CountryCode.multi, CountryCode.hi, CountryCode.en];
    this.baseUrl = 'https://new2.vegamovies.futbol';
    this.fetcher = fetcher;
    this.ttl = 10 * 60 * 1000;
  }

  async handleInternal(ctx, _type, id) {
    const tmdbId = await getTmdbId(this.fetcher, ctx, id);
    const [name, year] = await getTmdbNameAndYear(this.fetcher, ctx, tmdbId);
    const title = name + (tmdbId.season ? ` ${TmdbId.formatSeasonAndEpisode(tmdbId)}` : ` (${year})`);

    const isAnime = await isAnimeContent(this.fetcher, ctx, tmdbId);

    const mod = getScraperModule();
    if (!mod || typeof mod.getStreams !== 'function') return [];

    const mediaType = tmdbId.season ? 'tv' : 'movie';
    let streams;
    try {
      streams = await Promise.race([
        mod.getStreams(String(tmdbId.id), mediaType, tmdbId.season || null, tmdbId.episode || null),
        new Promise(r => setTimeout(() => r(null), 30000)),
      ]);
    } catch (e) {
      console.error(`[vegamovies2] error: ${e?.message || e}`);
      return [];
    }

    if (!Array.isArray(streams) || streams.length === 0) return [];

    const enrichedStreams = streams.map(s => {
      const height = parseHeight(s.quality) || 1080;
      const codec = s.codec || (height >= 2160 ? 'HEVC' : 'x264');
      const sourceType = s.sourceType || 'WebDL';
      // per-episode size like "1.3GB/E" or pack size "[7.7GB]"
      const sizeMatch = String(s.size || '').match(/([\d.]+)\s*(GB|MB)/i);
      const fileSize = sizeMatch
        ? (sizeMatch[2].toUpperCase() === 'GB'
          ? parseFloat(sizeMatch[1]) * 1024 * 1024 * 1024
          : parseFloat(sizeMatch[1]) * 1024 * 1024)
        : null;
      const audioLabel = (isAnime ? parseAudioFromLabel(s.label) || 'Japanese' : parseAudioFromLabel(s.label) || 'Hindi + English');

      const countryCodes = isAnime
        ? [CountryCode.multi, CountryCode.ja, CountryCode.en]
        : [CountryCode.multi, CountryCode.hi, CountryCode.en];

      const hdrTag = /hdr/i.test(String(s.label)) ? ' HDR' : '';
      const audioTag = isAnime ? ' [SUB+DUB]' : '';
      const displayTitle = `[VegaMovies ${height}p ${sourceType} ${codec}${hdrTag} ${audioLabel}]${audioTag}`;

      return {
        url: s.url,
        quality: height + 'p',
        title: displayTitle,
        name: 'VegaMovies - ' + (s.quality || height + 'p'),
        size: fileSize ? bytes(fileSize) : undefined,
        // Don't set headers — googleusercontent URLs go through /range-proxy
        _countryCodes: countryCodes,
        _fileSize: fileSize,
        _sourceType: sourceType,
        _codec: codec,
        _isAnime: isAnime,
        _audioLabel: audioLabel,
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

    for (const r of results) {
      const matched = enrichedStreams.find(s => s.url === r.url.href);
      if (matched) {
        if (matched._countryCodes) r.meta.countryCodes = matched._countryCodes;
        if (matched._sourceType) r.meta.sourceType = matched._sourceType;
        if (matched._codec) r.meta.codec = matched._codec;
        if (matched._fileSize) r.meta.bytes = matched._fileSize;
        if (matched._isAnime) {
          r.meta.audioLabel = matched._audioLabel || 'Japanese + English';
          r.meta.isMultiAudio = true;
        } else {
          r.meta.audioLabel = matched._audioLabel || 'Hindi + English';
          r.meta.isMultiAudio = true;
        }
      }
    }

    console.log(`[vegamovies2] ${results.length} playable stream(s)${isAnime ? ' [anime]' : ''}`);
    return results;
  }
}
