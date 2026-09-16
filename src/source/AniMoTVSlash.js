// src/source/AniMoTVSlash.js
// animotvslash.org — anime source: hardsub + softsub servers, movie sub/dub.
//
// Flow (mapped live 2026-09-14):
//   1. TMDB → title/year → wp-json search on animotvslash.org
//   2. Best-matching /anime/<slug>/ detail page (season-aware)
//   3. Detail page → episode page URL (/ <slug>-episode-N/)
//   4. Episode page select.mirror → base64 embeds → per-host resolvers:
//        ANIMO-M/H/D (site player-config DIVs) → rumble/videas direct URLs
//        Vidara  → POST /api/stream → 1080p master + VTT subs
//        VidHide → packed-JS unpack → 1080p master
//        megaplay (movies) → getSourcesNew enc decrypt (6+ sub tracks)
//   5. WebTorrent/P2P embeds (p2pplay "Animo") are EXCLUDED by the
//      no-torrent rule; other unresolvable embeds (Moon/Hydrax/tryembed/
//      vidnest/animotvslash.ru) are skipped with logged reasons.
//
// Direct-play notes (verified live):
//   - rumble.com HLS: fetches fine with plain browser headers (1080p master)
//   - videas hlsv1 (ANIMO-H): 403 without `Origin: https://animotvslash.org`
//     — the Origin header is stamped on the stream and propagated by /proxy
//   - videas cdn4 MP4 tiers (ANIMO-D): direct 206 with plain headers
//   - vidara (97bf1.com) + vidhide (digitalcamerasales.site): verified 200/206
//     from the test box with the stamped Referer
//   - megaplay CDN (fetch.nexabloom.top) 403s ALL datacenter IPs — buildStreamResults'
//     NO_REFERER_HOSTS routes it DIRECT so the player's residential IP fetches.

import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { CountryCode, Format } from '../types.js';
import { getTmdbId, getTmdbNameAndYear, TmdbId } from '../utils/index.js';
import { Source } from './Source.js';
import { callNuvioProvider, buildStreamResults } from './nuvioHelpers.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const PROVIDER_PATH = path.join(__dirname, '..', 'nuvio', 'animotvslash.cjs');

export class AniMoTVSlash extends Source {
  constructor(fetcher) {
    super();
    this.id = 'animotvslash';
    this.label = 'AniMoTVSlash';
    this.contentTypes = ['movie', 'series'];
    this.countryCodes = [CountryCode.multi, CountryCode.ja, CountryCode.en];
    this.baseUrl = 'https://animotvslash.org';
    this.fetcher = fetcher;
    this.ttl = 5 * 60 * 1000; // 5min — HLS masters are short-lived
  }

  async handleInternal(ctx, _type, id) {
    const tmdbId = await getTmdbId(this.fetcher, ctx, id);
    const [name, year] = await getTmdbNameAndYear(this.fetcher, ctx, tmdbId);
    const title = name + (tmdbId.season ? ` ${TmdbId.formatSeasonAndEpisode(tmdbId)}` : ` (${year})`);

    const mediaType = tmdbId.season ? 'tv' : 'movie';

    // Scraper wall budget: TMDB + wp-json search + detail page + episode page
    // + parallel server resolutions (each ≤12s). Measured ~8-14s end-to-end;
    // 30s keeps headroom inside the resolver's 35s per-source cutoff.
    const streams = await callNuvioProvider(PROVIDER_PATH, {
      tmdbId: tmdbId.id,
      mediaType,
      season: tmdbId.season || null,
      episode: tmdbId.episode || null,
      timeoutMs: 30000,
    });

    if (!Array.isArray(streams) || !streams.length) return [];

    // buildStreamResults derives per-stream country codes from s.audioTracks
    // (scraper stamps 'Japanese' for sub/softsub, 'English' for dub) and the
    // per-stream headers (Referer/Origin) into nuvioReferer/nuvioOrigin.
    // nexabloom.top (megaplay CDN) is in NO_REFERER_HOSTS → ships DIRECT so
    // the player's residential IP fetches it.
    return buildStreamResults({
      streams,
      title,
      sourceId: this.id,
      sourceLabel: this.label,
      countryCodes: [CountryCode.multi, CountryCode.ja, CountryCode.en],
      ctx,
    });
  }
}
