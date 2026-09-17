// src/source/VixSrc.js
// Ported from research/webstreamr-mbg/src/source/VixSrc.ts
//
// Task 51 REVIVAL — the source shipped ZERO cards since the port because
// handleInternal gated on supportsMediaFlowProxy(ctx), which is hardcoded
// false in this codebase (media-flow-proxy.js), so `return []` fired on EVERY
// request. Even without that gate the page URL it emitted matched NO
// extractor (vixsrc.to is not a MediaFlow host here) — a second dead layer.
//
// Working flow (2026-09, ecosystem-standard vixsrc playlist contract):
//   1. Movie:  https://vixsrc.to/api/playlist/{tmdbId}?token=
//      Series: https://vixsrc.to/api/playlist/{tmdbId}/{season}/{episode}?token=
//      The token param stays empty for free titles (the site's player JS
//      builds exactly this URL; premium titles 404 — per-title, like any
//      availability gap).
//   2. vixsrc.to Cloudflare-BLOCKS datacenter IPs (page AND playlist API —
//      verified 403 "Attention Required" from this network, Task 41/48 gate
//      class). Server-side /proxy routing is therefore impossible for
//      everyone; validation is advisory-only. The card ships DIRECT with
//      requestHeaders (Referer/Origin: vixsrc.to) via meta.nuvioDirectWithHeaders
//      (the Task 48 peraspera precedent) so the PLAYER's residential IP makes
//      the exact browser request. Stremio applies behaviorHints.proxyHeaders
//      to the HLS fetch — the same mechanism every Referer-gated HLS here uses.

import { CountryCode, Format } from '../types.js';
import { getTmdbId, getTmdbNameAndYear, TmdbId } from '../utils/index.js';
import { Source } from './Source.js';

const ORIGIN = 'https://vixsrc.to';

export class VixSrc extends Source {
  constructor(fetcher) {
    super();
    this.id = 'vixsrc';
    this.label = 'VixSrc';
    this.contentTypes = ['movie', 'series'];
    this.countryCodes = [CountryCode.multi];
    this.baseUrl = ORIGIN;
    this.priority = 1;
    this.fetcher = fetcher;
  }

  async handleInternal(ctx, _type, id) {
    const tmdbId = await getTmdbId(this.fetcher, ctx, id);
    const [name, year] = await getTmdbNameAndYear(this.fetcher, ctx, tmdbId);

    let title = name;
    let playlistPath;
    if (tmdbId.season) {
      title += ` ${TmdbId.formatSeasonAndEpisode(tmdbId)}`;
      playlistPath = `/api/playlist/${tmdbId.id}/${tmdbId.season}/${tmdbId.episode || 1}?token=`;
    } else {
      title += ` (${year})`;
      playlistPath = `/api/playlist/${tmdbId.id}?token=`;
    }

    return [{
      url: new URL(playlistPath, ORIGIN),
      format: Format.hls,
      meta: {
        countryCodes: [CountryCode.multi],
        title,
        sourceId: this.id,
        sourceLabel: this.label,
        // Player-IP direct routing (Task 48 fix5 peraspera class): the
        // extractor ships the playlist URL unchanged with proxyHeaders.
        nuvioReferer: ORIGIN + '/',
        nuvioOrigin: ORIGIN,
        nuvioDirectWithHeaders: true,
      },
    }];
  }
}
