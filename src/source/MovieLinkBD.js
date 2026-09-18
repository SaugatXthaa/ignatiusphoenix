// src/source/MovieLinkBD.js
// movielinkbd.one / movielinkbd.pw / ssged4.movielinkbd.li — MovieLinkBD
// Official. Movies / series / kdrama / cdrama / jdrama / animes / cartoons,
// MULTI-REGIONAL (english, korean, chinese, japanese, french, italian,
// portuguese, bangla, hindi, ...), up to 4K/2160p. Task 58 reverse
// engineering (v2 — the .one/.pw architecture; movielinkbd.NET is a
// different older site without 4K, deliberately not used).
//
// Flow (see src/nuvio/movielinkbd.cjs for the full site map):
//   1. /search?q= HTML → /movie|series|anime|drama/mKs_* result links
//   2. Content page → embedded mlbdInlinePlayerData JSON → episodes →
//      sources with the REAL filename, direct cdn.dramalinkbd.tv/p/ URLs
//      (video/x-matroska, accept-ranges → native 206 seeking, CORS *),
//      audio_languages (sub+dub multi-audio) and external_subtitles
//      (site-served WEBVTT tracks)
//   3. DIRECT playback — no proxy hop; tokens are time-limited but a
//      refresh regenerates (standard DDL-token class).
//
// Facts encoded by the scraper:
//   - Site ceiling is 2160p ("Best Quality" = 2160p HEVC — measured on
//     Kattalan 2026 5.52GB); the JSON quality field LIES for 4K so the
//     scraper parses quality from the filename.
//   - Wrong-content guards (Task 53 class): movies = title-word min-hit
//     gate + year ±1; series = filename SxxExx must match the request.
//   - Subtitles: site WEBVTT tracks pass through meta.subtitles; the
//     addon-wide unified granite+natsuki stack still fills in every card
//     like for every other source.
//
// Enriched metadata:
//   - height from the filename quality (480/720/1080/2160)
//   - sourceType / codecs / audio languages parsed by enrichMeta from the
//     real filename (MovieLinkBD.com - X.2160p.WEB-DL.HEVC.h265.ESub.mkv)
//   - serverName 'MLBD CDN' (the site's own provider label)

import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
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

export class MovieLinkBD extends Source {
  constructor(fetcher) {
    super();
    this.id = 'movielinkbd';
    this.label = 'MovieLinkBD';
    this.contentTypes = ['movie', 'series'];
    this.countryCodes = [CountryCode.multi, CountryCode.hi, CountryCode.en];
    this.baseUrl = 'https://movielinkbd.one';
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

      // Only ship the site's own CDN class (cdn.dramalinkbd.tv — direct
      // files with native Range support; verified 206 mid-file).
      if (!/(^|\.)dramalinkbd\.tv$/i.test(url.hostname)) {
        console.error(`[movielinkbd] unexpected non-CDN host skipped: ${url.hostname}`);
        continue;
      }

      const height = parseHeight(s.quality) || parseHeight(s.filename);
      const qualityLabel = s.quality || (height ? `${height}p` : 'Auto');
      const audioLabel = s.audioTracks ? ` • ${s.audioTracks}` : '';
      const subsLabel = Array.isArray(s.subtitles) && s.subtitles.length
        ? ` • Subs: ${s.subtitles.map(t => t.lang).join(', ')}` : '';
      // Rich title → enrichMeta parses WebDL/HEVC/Hindi/English audio from
      // the real filename; audio tracks + site subs appended explicitly.
      const displayTitle = `${title} (MovieLinkBD ${qualityLabel}${audioLabel}${subsLabel}) — ${s.filename || ''}`;

      const filenameForCodes = s.filename || '';
      const countryCodes = [...new Set([...this.countryCodes, ...findCountryCodes(`${s.audioTracks || ''} ${filenameForCodes}`)])];

      results.push({
        url,
        format: Format.mp4,
        meta: {
          countryCodes,
          title: displayTitle,
          sourceId: this.id,
          sourceLabel: this.label,
          ...(height && { height }),
          // serverName (not subSource): shared extractors that claim this
          // URL class would stamp their own extractorLabel — serverName
          // outranks it in buildName so the card keeps the site's label.
          serverName: 'MLBD CDN',
          ...(filenameForCodes && { filename: filenameForCodes }),
          // Site-served WEBVTT tracks (Stremio {id, url, lang}) — merged
          // with the universal granite+natsuki set by StreamResolver.
          ...(Array.isArray(s.subtitles) && s.subtitles.length && { subtitles: s.subtitles }),
        },
      });
    }

    return results;
  }
}
