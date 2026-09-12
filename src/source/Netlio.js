// src/source/Netlio.js
// netlio.vercel.app — movies, TV series, anime, K-drama with direct HLS streams
//
// Flow:
//   1. Movies: fetch HLS URL from GitHub API
//      https://raw.githubusercontent.com/Watchout2025/api/refs/heads/main/hls/movie/{tmdbId}
//      → returns direct HLS master URL (with Hindi + English audio tracks)
//
//   2. TV/Series: fetch episode HLS URL from GitHub JSON API
//      https://raw.githubusercontent.com/Watchout2025/api/refs/heads/main/hls/tv/{tmdbId}/S{season}.json
//      → returns JSON { "1": "https://...master.txt", "2": "https://...", ... }
//      → pick episode {episode} from the JSON
//
// All HLS URLs require Referer: https://netlio.vercel.app/ to play.
// The HLS master playlist contains multiple audio tracks (Hindi, English)
// and quality variants (480p, 720p, 1080p).

import { CountryCode, Format } from '../types.js';
import { getTmdbId, getTmdbNameAndYear, TmdbId } from '../utils/index.js';
import { Source } from './Source.js';

const API_BASE = 'https://raw.githubusercontent.com/Watchout2025/api/refs/heads/main/hls';
const REFERER = 'https://netlio.vercel.app/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Liveness probe — Netlio ships its single HLS URL through /proxy (the CDN
// is CF-protected and Referer-gated), so a server-side probe sees exactly
// what the player will see. Netlio is a one-stream source: when upstream
// answers 4xx/5xx or an HTML gate, a dead card is worse than no card.
async function hlsAlive(urlStr) {
  try {
    const res = await fetch(urlStr, {
      headers: { 'User-Agent': UA, Referer: REFERER, Range: 'bytes=0-1023' },
      redirect: 'follow',
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      console.log(`[netlio] upstream not playable (${res.status}) — dropping card`);
      return false;
    }
    const ct = res.headers.get('content-type') || '';
    if (/text\/html/i.test(ct)) {
      console.log('[netlio] upstream serves HTML gate — dropping card');
      return false;
    }
    return true;
  } catch (e) {
    console.log(`[netlio] upstream probe failed (${e?.message || e}) — dropping card`);
    return false;
  }
}

export class Netlio extends Source {
  constructor(fetcher) {
    super();
    this.id = 'netlio';
    this.label = 'Netlio';
    this.contentTypes = ['movie', 'series'];
    this.countryCodes = [CountryCode.multi, CountryCode.hi, CountryCode.en];
    this.baseUrl = 'https://netlio.vercel.app';
    this.fetcher = fetcher;
  }

  async handleInternal(ctx, _type, id) {
    const tmdbId = await getTmdbId(this.fetcher, ctx, id);
    const [name, year] = await getTmdbNameAndYear(this.fetcher, ctx, tmdbId);

    const title = name + (tmdbId.season ? ` ${TmdbId.formatSeasonAndEpisode(tmdbId)}` : ` (${year})`);

    const results = [];

    if (tmdbId.season) {
      // TV series — fetch episode HLS URL from JSON API
      const seasonUrl = new URL(`${API_BASE}/tv/${tmdbId.id}/S${tmdbId.season}.json`);
      try {
        const json = await this.fetcher.json(ctx, seasonUrl, { timeout: 10000 });
        if (json && typeof json === 'object') {
          const reqEp = tmdbId.episode || 1;

          // The Netlio API uses absolute episode numbers (e.g., S12 starts at
          // ep 244, not 1). We need to map Stremio's per-season episode number
          // to Netlio's absolute episode number.
          // Strategy: get all non-empty episodes sorted, then pick the Nth one
          // where N = Stremio's episode number.
          const allEps = Object.entries(json)
            .filter(([k, v]) => v && typeof v === 'string' && v.startsWith('http'))
            .sort((a, b) => parseInt(a[0]) - parseInt(b[0]));

          if (allEps.length >= reqEp) {
            // Use the Nth episode (1-indexed)
            const [, hlsUrl] = allEps[reqEp - 1];

            // Only use direct HLS URLs — skip multimovies.rpmhub.site URLs
            // which require browser-side JS decryption
            if (!hlsUrl.includes('rpmhub.site') && (await hlsAlive(hlsUrl))) {
              let parsed;
              try { parsed = new URL(hlsUrl); } catch { /* invalid */ }
              if (parsed) {
                results.push({
                  url: parsed,
                  format: Format.hls,
                  meta: {
                    countryCodes: [CountryCode.multi, CountryCode.hi, CountryCode.en],
                    title: `${title} (Hindi + English)`,
                    sourceId: this.id,
                    sourceLabel: this.label,
                  },
                  requestHeaders: { Referer: REFERER },
                });
              }
            }
          }
        }
      } catch { /* season not available */ }
    } else {
      // Movie — fetch direct HLS URL
      const movieUrl = new URL(`${API_BASE}/movie/${tmdbId.id}`);
      try {
        const hlsUrl = await this.fetcher.text(ctx, movieUrl, { timeout: 10000 });
        if (hlsUrl && !hlsUrl.includes('404') && (await hlsAlive(hlsUrl.trim()))) {
          let parsed;
          try { parsed = new URL(hlsUrl.trim()); } catch { /* invalid */ }
          if (parsed) {
            results.push({
              url: parsed,
              format: Format.hls,
              meta: {
                countryCodes: [CountryCode.multi, CountryCode.hi, CountryCode.en],
                title: `${title} (Hindi + English)`,
                sourceId: this.id,
                sourceLabel: this.label,
              },
              requestHeaders: { Referer: REFERER },
            });
          }
        }
      } catch { /* movie not available */ }
    }

    return results;
  }
}
