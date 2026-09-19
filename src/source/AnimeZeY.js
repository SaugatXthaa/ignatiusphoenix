// src/source/AnimeZeY.js
// animezey — anime-only with sub+dub HLS streams
//
// Uses the Nuvio provider (src/nuvio/animezey.cjs) which returns direct URLs
// from animezey workers.dev. No Referer required.
//
// Anime-only provider — does not work for movies or TV series.

import path from 'path';
import { fileURLToPath } from 'url';
import { CountryCode } from '../types.js';
import { getTmdbId, getTmdbNameAndYear, TmdbId } from '../utils/index.js';
import { Source } from './Source.js';
import { buildStreamResults, callNuvioProvider } from './nuvioHelpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROVIDER_PATH = path.join(__dirname, '..', 'nuvio', 'animezey.cjs');

export class AnimeZeY extends Source {
  constructor(fetcher) {
    super();
    this.id = 'animezey';
    this.label = 'AnimeZeY';
    this.contentTypes = ['series']; // anime-only
    this.countryCodes = [CountryCode.multi, CountryCode.ja, CountryCode.en];
    this.baseUrl = 'https://animezey.com';
    this.fetcher = fetcher;
    this.ttl = 10 * 60 * 1000; // 10min
  }

  async handleInternal(ctx, _type, id) {
    const tmdbId = await getTmdbId(this.fetcher, ctx, id);
    const [name, year] = await getTmdbNameAndYear(this.fetcher, ctx, tmdbId);
    const title = name + (tmdbId.season ? ` ${TmdbId.formatSeasonAndEpisode(tmdbId)}` : ` (${year})`);

    // animezey is anime-only — requires season/episode
    if (!tmdbId.season) return [];

    const streams = await callNuvioProvider(PROVIDER_PATH, {
      tmdbId: tmdbId.id,
      mediaType: 'tv',
      season: tmdbId.season,
      episode: tmdbId.episode || 1,
      timeoutMs: 25000,
    });

    const results = buildStreamResults({
      streams,
      title,
      sourceId: this.id,
      sourceLabel: this.label,
      countryCodes: this.countryCodes,
      ctx,
    });

    // Task 62: animezey's worker (animezey16082023.workers.dev) changed its
    // blob crypto — freshly minted download.aspx URLs answer 500
    // "OperationError: Decryption failed" (upstream-side; the obfuscated
    // provider cannot be re-keyed). Liveness gate: probe each card with its
    // own headers (6s cap, headers-only — body cancelled) and ship only
    // responsive URLs, so the source degrades to an HONEST ZERO instead of
    // listing dead cards ("can't play" class). Self-heals when the worker
    // rotates its crypto back.
    if (results.length > 0) {
      const alive = await Promise.all(results.map(async (r) => {
        try {
          const headers = {};
          if (r.meta?.nuvioUserAgent) headers['User-Agent'] = r.meta.nuvioUserAgent;
          if (r.meta?.nuvioReferer) headers['Referer'] = r.meta.nuvioReferer;
          if (r.meta?.nuvioOrigin) headers['Origin'] = r.meta.nuvioOrigin;
          const res = await fetch(r.url, { headers, redirect: 'follow', signal: AbortSignal.timeout(6000) });
          const ok = res.status < 400 || res.status === 416;
          try { res.body?.cancel?.(); } catch {}
          if (!ok) console.log(`[animezey] probe drop (${res.status}): ${String(r.url).slice(0, 90)}`);
          return ok;
        } catch (e) {
          console.log(`[animezey] probe error drop: ${e?.message || e}`);
          return false;
        }
      }));
      return results.filter((_, i) => alive[i]);
    }
    return results;
  }
}
