// src/source/Cineby.js
// cineby.at — movies and TV series with multi-quality HLS streams (up to 4K)
//
// Uses the Nuvio provider (src/nuvio/cineby.cjs) which calls the speedracelight
// API with a custom XOR-based encryption. The provider returns direct m3u8 URLs
// from moon.ironwallnet.net / paperorbit.top CDNs that require
// Referer: https://www.cineby.at/
//
// Flow:
//   1. Resolve TMDB ID + name/year
//   2. Call provider.getStreams(tmdbId, 'movie'|'tv', season, episode)
//   3. Convert streams to Source result format via buildStreamResults()
//      (HLS+Referer → /proxy, MP4+Referer → requestHeaders, direct → direct)
//
// Enriched metadata (quality, codec, sourceType, audioCodec, HDR, bitDepth,
// bytes, releaseGroup, countryCodes) is parsed from meta.title by enrichMeta()
// in StreamResolver.js — buildStreamResults includes the stream URL filename
// in the title so enrichMeta can extract all available info.

import path from 'path';
import { fileURLToPath } from 'url';
import { CountryCode } from '../types.js';
import { getTmdbId, getTmdbNameAndYear, TmdbId } from '../utils/index.js';
import { Source } from './Source.js';
import { buildStreamResults, callNuvioProvider } from './nuvioHelpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROVIDER_PATH = path.join(__dirname, '..', 'nuvio', 'cineby.cjs');

export class Cineby extends Source {
  constructor(fetcher) {
    super();
    this.id = 'cineby';
    this.label = 'Cineby';
    this.contentTypes = ['movie', 'series'];
    this.countryCodes = [CountryCode.multi, CountryCode.en];
    this.baseUrl = 'https://www.cineby.at';
    this.fetcher = fetcher;
    this.ttl = 10 * 60 * 1000; // 10min — stream URLs have short-lived tokens
  }

  async handleInternal(ctx, _type, id) {
    const tmdbId = await getTmdbId(this.fetcher, ctx, id);
    const [name, year] = await getTmdbNameAndYear(this.fetcher, ctx, tmdbId);
    const title = name + (tmdbId.season ? ` ${TmdbId.formatSeasonAndEpisode(tmdbId)}` : ` (${year})`);

    const mediaType = tmdbId.season ? 'tv' : 'movie';
    const streams = await callNuvioProvider(PROVIDER_PATH, {
      tmdbId: tmdbId.id,
      mediaType,
      season: tmdbId.season || null,
      episode: tmdbId.episode || null,
    });

    // The shared VidKing backend (moon.peakstorm.top) hotlink-gates by Referer
    // INVERTED: it 403s requests carrying the cineby.at Referer/Origin that the
    // obfuscated provider stamps on every stream, but serves the SAME files
    // with Referer: vidking.net (which is what the WatchSeries/VidKing
    // extractor path sends — verified 200 real HLS vs 403 HTML on 2026-09-12).
    // Rewrite headers for that host before buildStreamResults so the /proxy
    // forwards a Referer the CDN actually accepts.
    for (const s of streams || []) {
      try {
        if (!s?.url || typeof s.url !== 'string') continue;
        const host = new URL(s.url).hostname;
        if (host === 'moon.peakstorm.top' || host.endsWith('.peakstorm.top')) {
          s.headers = {
            ...(s.headers || {}),
            Referer: 'https://www.vidking.net/',
            Origin: 'https://www.vidking.net',
          };
        }
      } catch { /* malformed url — leave untouched */ }
    }

    return buildStreamResults({
      streams,
      title,
      sourceId: this.id,
      sourceLabel: this.label,
      countryCodes: this.countryCodes,
      ctx,
    });
  }
}
