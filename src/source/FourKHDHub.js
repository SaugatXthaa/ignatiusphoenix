// src/source/FourKHDHub.js
// 4khdhub (formerly 4khdhub.link — domain now redirects to 4khdhub.one)
//
// Task 38 (2026-09): 4khdhub.link now 301s to 4khdhub.one, whose pages were
// redesigned (content-file blocks + greenmotors.cc ad-funnel links instead of
// direct hubcloud hrefs). The old .movie-card/.download-item selectors matched
// nothing → 0 streams forever. This source now resolves through the SAME
// shared scraper as FourKHDHubOne (src/nuvio/4khdhub_one.cjs) — including the
// server-side greenmotors token decode → hubcloud.ist URLs — while keeping its
// own source id, label, country codes and card naming, so both 4khdhub
// registrations keep delivering independently (dedupe is URL+sourceId).
//
// Flow:
//   1. TMDB id → title (+season/episode for series)
//   2. Shared scraper: search 4khdhub.one → match → decode greenmotors links
//   3. Raw hubcloud.ist URLs ship — ESM HubExtractor → HubCloud extractor
//      resolves them downstream (workers.dev / pixeldrain direct CDN)

import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import bytes from 'bytes';
import { CountryCode, Format } from '../types.js';
import { getTmdbId, getTmdbNameAndYear, TmdbId } from '../utils/index.js';
import { Source } from './Source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const PROVIDER_PATH = path.join(__dirname, '..', 'nuvio', '4khdhub_one.cjs');

let _scraperMod = null;
function getScraperModule() {
  if (_scraperMod) return _scraperMod;
  try { _scraperMod = require_(PROVIDER_PATH); }
  catch (e) { console.error(`[4khdhub] failed to load scraper: ${e?.message || e}`); }
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

function detectSourceType(text) {
  const lower = (text || '').toLowerCase();
  if (lower.includes('remux')) return 'BluRay Remux';
  if (lower.includes('bluray') || lower.includes('bdrip')) return 'BluRay';
  if (lower.includes('web-dl') || lower.includes('webdl') || lower.includes('webrip')) return 'WebDL';
  return undefined;
}

export class FourKHDHub extends Source {
  constructor(fetcher) {
    super();
    this.id = '4khdhub';
    this.label = '4KHDHub';
    this.contentTypes = ['movie', 'series'];
    this.countryCodes = [CountryCode.multi, CountryCode.hi, CountryCode.ta, CountryCode.te];
    // 4khdhub.link now redirects here; the scraper hardcodes the live domain.
    this.baseUrl = 'https://4khdhub.one';
    this.fetcher = fetcher;
    this.ttl = 30 * 60 * 1000;
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
      // Task 49: NO internal race here. A race that fires null DISCARDS the
      // eventual scraper result, so the 15min per-source cache never filled
      // and every re-open re-ran the full multi-hop chain cold — the
      // user-visible "no 4khdhub until 4-5 refreshes". The resolver's 35s
      // SOURCE_TIMEOUT bounds delivery (Task 36 partial contract); the
      // un-capped handle promise completes in background and caches —
      // Task 48 fix6 pattern (atlantic), production-proven.
      // Task 57: pass fetcher+ctx — the scraper's bare undici fetch stalled
      // in DNS under merged 15-source contention (35s timeouts on every
      // merged resolve; isolated 0.8s). Fetcher transport fixes it.
      streams = await mod.getStreams(tmdbId.id, mediaType, tmdbId.season, tmdbId.episode, { fetcher: this.fetcher, ctx });
    } catch (e) {
      console.error(`[4khdhub] getStreams error: ${e?.message || e}`);
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

      const height = parseHeight(s.quality);
      const fileSize = parseSize(s.size);
      const sourceType = detectSourceType(s.quality + ' ' + (s.title || ''));

      const qualityLabel = s.quality || (height ? `${height}p` : 'Download');
      const sizeLabel = s.size ? ` [${s.size}]` : '';
      const displayTitle = `${title} (4KHDHub ${qualityLabel})${sizeLabel}`;

      results.push({
        url,
        format: Format.mp4,
        meta: {
          countryCodes: [...new Set([...this.countryCodes, CountryCode.en])],
          title: displayTitle,
          sourceId: this.id,
          sourceLabel: this.label,
          ...(height && { height }),
          ...(sourceType && { sourceType }),
          ...(fileSize && { bytes: fileSize }),
        },
      });
    }

    return results;
  }
}
