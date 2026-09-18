// src/source/ZXCStream.js
// zxcstream — movies/series via player.zxcstream.xyz (Task 55 protocol rewrite)
//
// Uses the Nuvio provider (src/nuvio/zxcstream.cjs) which now implements the
// site's CURRENT token protocol (obfuscated FIELD_MAP + /backend/a1b2c3 token
// POST → /backend_/embed/sentinel) and extracts REAL media URLs from the
// embed player server-side.
//
// Task 55: the old player-PAGE fallback card (an HTML URL shipped as a
// "stream") is GONE — it produced the user's "ZXCStream mpv error" (mpv
// cannot play HTML). The provider returns [] when nothing playable can be
// extracted (honest zero), so every ZXCStream card is directly playable.
//
// Flow:
//   1. Resolve TMDB ID + name/year
//   2. Call provider.getStreams(tmdbId, 'movie'|'tv', season, episode)
//   3. Convert streams to Source result format via buildStreamResults()

import path from 'path';
import { fileURLToPath } from 'url';
import { CountryCode } from '../types.js';
import { getTmdbId, getTmdbNameAndYear, TmdbId } from '../utils/index.js';
import { Source } from './Source.js';
import { buildStreamResults, callNuvioProvider } from './nuvioHelpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROVIDER_PATH = path.join(__dirname, '..', 'nuvio', 'zxcstream.cjs');

export class ZXCStream extends Source {
  constructor(fetcher) {
    super();
    this.id = 'zxcstream';
    this.label = 'ZXCStream';
    this.contentTypes = ['movie', 'series'];
    this.countryCodes = [CountryCode.multi];
    this.baseUrl = 'https://player.zxcstream.xyz';
    this.fetcher = fetcher;
    this.ttl = 5 * 60 * 1000; // 5min — tokens are time-limited
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
      timeoutMs: 25000,
    });

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
