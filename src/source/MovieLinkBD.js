// src/source/MovieLinkBD.js
// movielinkbd.net — movies / series / kdrama / cdrama / jdrama / animes /
// cartoons via WordPress REST API discovery + KiteCloud file host, resolved
// to DIRECT googleusercontent MKV files. Task 58 reverse engineering.
//
// Flow (see src/nuvio/movielinkbd.cjs for the full site map):
//   1. WP REST API search (?search=) → candidate posts (JSON, no CF)
//   2. Post page HTML → movie dl-boxes / series season+episode pills
//   3. KiteCloud: landing (liveness + real filename + audio/sub metadata)
//      → drive POST → 302 ?file= → direct video-downloads.googleusercontent
//
// Facts encoded by the scraper:
//   - Site ceiling is 1080p upstream (no fabricated 4K; the "2160p" strings
//     on pages are site chrome) — cards ship at the file's real quality.
//   - Dual/multi audio (Hindi+English; anime: Hindi+English+Japanese) is
//     EMBEDDED in the MKV — sub & dub in one file per quality.
//   - Subtitles are embedded (ESub) — no separate .srt endpoints exist on
//     the site; the addon-wide unified granite+natsuki stack still adds
//     side-loaded tracks to every card like for every other source.
//
// Enriched metadata:
//   - height from the quality label (480/720/1080)
//   - sourceType / audio languages parsed by enrichMeta from the REAL
//     filename (Movielinkbd.net.X.WEB.DL.Hindi.English.1080p.ESub.mkv)
//   - bytes from the size badge
//   - countryCodes [multi, hi, en] — dual-audio content

import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import bytes from 'bytes';
import { CountryCode, Format } from '../types.js';
import { getTmdbId, getTmdbNameAndYear, TmdbId, findCountryCodes } from '../utils/index.js';
import { Source } from './Source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const PROVIDER_PATH = path.join(__dirname, '..', 'nuvio', 'movielinkbd.cjs');

let _scraperMod = null;
function getScraperModule() {
  if (_scraperMod) return _scraperMod;
  try { _scraperMod = require_(PROVIDER_PATH); }
  catch (e) { console.error(`[movielinkbd] failed to load scraper: ${e?.message || e}`); }
  return _scraperMod;
}

function parseHeight(q) {
  if (!q) return undefined;
  const s = String(q).toLowerCase();
  if (s.includes('2160') || s.includes('4k') || s.includes('uhd')) return 2160;
  const m = s.match(/(\d{3,4})/);
  return m ? parseInt(m[1]) : undefined;
}

function parseSize(size) {
  if (!size || typeof size !== 'string') return undefined;
  try { return bytes.parse(size) || undefined; } catch { return undefined; }
}

export class MovieLinkBD extends Source {
  constructor(fetcher) {
    super();
    this.id = 'movielinkbd';
    this.label = 'MovieLinkBD';
    this.contentTypes = ['movie', 'series'];
    this.countryCodes = [CountryCode.multi, CountryCode.hi, CountryCode.en];
    this.baseUrl = 'https://movielinkbd.net';
    this.fetcher = fetcher;
    this.ttl = 30 * 60 * 1000; // 30min
  }

  async handleInternal(ctx, _type, id) {
    const tmdbId = await getTmdbId(this.fetcher, ctx, id);
    const [name, year] = await getTmdbNameAndYear(this.fetcher, ctx, tmdbId);
    const title = name + (tmdbId.season ? ` ${TmdbId.formatSeasonAndEpisode(tmdbId)}` : ` (${year})`);

    const mod = getScraperModule();
    if (!mod || typeof mod.getStreams !== 'function') return [];

    const mediaType = tmdbId.season ? 'tv' : 'movie';
    let streams;
    try {
      // Task 57 transport threading: ALL upstream GETs through the addon
      // Fetcher (family:4, node-level timeout, got-scraping CF fallback).
      // No internal race (Task 49 pattern — same as FourKHDHubOne).
      streams = await mod.getStreams(tmdbId.id, mediaType, tmdbId.season, tmdbId.episode, { fetcher: this.fetcher, ctx });
    } catch (e) {
      console.error(`[movielinkbd] getStreams error: ${e?.message || e}`);
      return [];
    }

    if (!Array.isArray(streams) || streams.length === 0) return [];

    const results = [];
    const seenUrls = new Set();

    for (const s of streams) {
      if (!s || !s.url || typeof s.url !== 'string') continue;
      if (!s.url.startsWith('http')) continue;
      if (seenUrls.has(s.url)) continue;
      seenUrls.add(s.url);

      let url;
      try { url = new URL(s.url); } catch { continue; }

      // Only ship the resolved direct file class (video-downloads.
      // googleusercontent.com — deliberately NOT gated by streamGate,
      // Task 54: probing would burn one-time signed URLs).
      if (!/googleusercontent\.com$/i.test(url.hostname)) {
        console.error(`[movielinkbd] unexpected non-direct host skipped: ${url.hostname}`);
        continue;
      }

      const height = parseHeight(s.quality) || parseHeight(s.filename);
      const fileSize = parseSize(s.size);

      const qualityLabel = s.quality || (height ? `${height}p` : 'Auto');
      const sizeLabel = s.size ? ` [${s.size}]` : '';
      const audioLabel = s.audioTracks ? ` • ${s.audioTracks}` : '';
      const subsLabel = s.subsInfo && !/no|none/i.test(s.subsInfo) ? ` • Subs: ${s.subsInfo}` : '';
      // Rich title → enrichMeta parses WebDL/BluRay, Hindi/English audio,
      // ESub subs from the real filename; drive-page metadata appended.
      const displayTitle = `${title} (MovieLinkBD ${qualityLabel}${sizeLabel}${audioLabel}${subsLabel}) — ${s.filename || ''}`;

      const filenameForCodes = s.filename || '';
      const countryCodes = [...new Set([...this.countryCodes, ...findCountryCodes(`${s.name || ''} ${filenameForCodes}`)])];

      results.push({
        url,
        format: Format.mp4,
        meta: {
          countryCodes,
          title: displayTitle,
          sourceId: this.id,
          sourceLabel: this.label,
          ...(height && { height }),
          ...(fileSize && { bytes: fileSize }),
          // serverName (not subSource): the shared AcerMovies extractor
          // claims video-downloads.googleusercontent.com URLs for /range-proxy
          // and stamps extractorLabel='AcerMovies' — serverName outranks it
          // in buildName so the card keeps the true KiteCloud host label.
          serverName: 'KiteCloud',
          ...(filenameForCodes && { filename: filenameForCodes }),
        },
      });
    }

    return results;
  }
}
