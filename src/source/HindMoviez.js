// src/source/HindMoviez.js
// hindmoviez — movies and TV series (Hindi/English) with 4K and 1080p streams
//
// Uses the Nuvio provider (src/nuvio/hindmoviez.cjs) which scrapes hshare.ink
// and hcloud.ink, returning direct MKV URLs from *.workers.dev CDNs.
// No Referer required (workers.dev URLs are direct-playable).
//
// Flow:
//   1. Resolve TMDB ID + name/year
//   2. Call provider.getStreams(tmdbId, 'movie'|'tv', season, episode)
//   3. Convert streams to Source result format via buildStreamResults()
//
// Note: hindmoviez is slower (15-40s) due to multiple hshare.ink API calls.
// The provider timeout is set to 40s to accommodate this.

import path from 'path';
import { fileURLToPath } from 'url';
import { CountryCode } from '../types.js';
import { getTmdbId, getTmdbNameAndYear, TmdbId } from '../utils/index.js';
import { Source } from './Source.js';
import { buildStreamResults, callNuvioProvider, filterDeadStreams } from './nuvioHelpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROVIDER_PATH = path.join(__dirname, '..', 'nuvio', 'hindmoviez.cjs');

export class HindMoviez extends Source {
  constructor(fetcher) {
    super();
    this.id = 'hindmoviez';
    this.label = 'HindMoviez';
    this.contentTypes = ['movie', 'series'];
    this.countryCodes = [CountryCode.multi, CountryCode.hi, CountryCode.en];
    this.baseUrl = 'https://hindmoviez.ink';
    this.fetcher = fetcher;
    this.ttl = 10 * 60 * 1000; // 10min
  }

  async handleInternal(ctx, _type, id) {
    const tmdbId = await getTmdbId(this.fetcher, ctx, id);
    const [name, year] = await getTmdbNameAndYear(this.fetcher, ctx, tmdbId);
    const title = name + (tmdbId.season ? ` ${TmdbId.formatSeasonAndEpisode(tmdbId)}` : ` (${year})`);

    const mediaType = tmdbId.season ? 'tv' : 'movie';
    // Task 22 live-measured: scraper wall ≈20s (3 MvLink waves × hshare+hcloud
    // fetches) + liveness probes ≈1-3s. The old 25s provider cap raced the
    // scraper's own completion and zeroed the source. 30s keeps the whole
    // chain inside the resolver's 35s per-source cutoff.
    const streams = await callNuvioProvider(PROVIDER_PATH, {
      tmdbId: tmdbId.id,
      mediaType,
      season: tmdbId.season || null,
      episode: tmdbId.episode || null,
      timeoutMs: 30000,
    });

    // Liveness gate — these streams play through the server /proxy, so a
    // server-side probe accurately predicts playability. Dead/gated URLs
    // (403 hotlink, 401 JS-cookie challenge, CF challenge HTML) are dropped
    // instead of being shipped as guaranteed playback errors.
    const liveStreams = await filterDeadStreams(streams);

    return buildStreamResults({
      streams: liveStreams,
      title,
      sourceId: this.id,
      sourceLabel: this.label,
      countryCodes: this.countryCodes,
      ctx,
    });
  }
}
