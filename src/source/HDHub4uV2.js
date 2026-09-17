// src/source/HDHub4uV2.js
// new5.hdhub4u.cl — movies/TV with direct download links (up to 4K)
//
// Uses the all-in-one scraper (src/nuvio/hdhub4u_v2.cjs) which (Task 39):
//   1. Searches the site's sitemaps NEWEST-first, parallel + deadline-bounded
//   2. Parses post pages: every download link inherits its nearest heading
//      label — "720p 10Bit HEVC [760MB]" / "4K [2160p SDR WEB-DL – 9.5GB]"
//   3. greenmotors.cc/?id= funnels are decoded server-side (same funnel
//      Task 38 cracked for 4khdhub.one) → hubcloud/hubcdn/hblinks targets,
//      resolved at play time by HubExtractor/HBLinks
//   4. hdstream4u.com "Watch Online" links → Dean-Edwards unpack → HLS
//
// METADATA (Task 39): the scraper returns REAL quality/size/codec/sourceType/
// audio parsed from the site's own headings and post title. Unknown fields are
// omitted — the old wrapper fabricated "WEB-DL x264 Hindi-English" for every
// stream (codec guessed from height, audio hardcoded), which enrichedMeta then
// adopted as truth. Nothing is invented here anymore.

import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import bytes from 'bytes';
import { CountryCode, Format } from '../types.js';
import { getTmdbId, getTmdbNameAndYear, TmdbId } from '../utils/index.js';
import { Source } from './Source.js';
import { buildStreamResults, parseSize, withRetryOnEmpty } from './nuvioHelpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROVIDER_PATH = path.join(__dirname, '..', 'nuvio', 'hdhub4u_v2.cjs');
const require_ = createRequire(import.meta.url);

let _scraperMod = null;
function getScraperModule() {
  if (_scraperMod) return _scraperMod;
  try { _scraperMod = require_(PROVIDER_PATH); }
  catch (e) { console.error(`[hdhub4u-v2] failed to load scraper: ${e?.message || e}`); }
  return _scraperMod;
}

function parseHeight(q) {
  if (!q) return undefined;
  const s = String(q).toLowerCase();
  if (s.includes('2160') || s.includes('4k')) return 2160;
  if (s.includes('1080')) return 1080;
  if (s.includes('720')) return 720;
  if (s.includes('480')) return 480;
  const m = s.match(/(\d{3,4})/);
  return m ? parseInt(m[1]) : undefined;
}

export class HDHub4uV2 extends Source {
  constructor(fetcher) {
    super();
    this.id = 'hdhub4uv2';
    this.label = 'HDHub4u';
    this.contentTypes = ['movie', 'series'];
    this.countryCodes = [CountryCode.multi, CountryCode.hi, CountryCode.en];
    this.baseUrl = 'https://new5.hdhub4u.cl';
    this.fetcher = fetcher;
    this.ttl = 10 * 60 * 1000;
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
      // Task 39: bounded retry-on-empty — sitemap/greenmotors transient
      // windows zeroed whole runs and the 60s negative cache hid the recovery
      // Task 49: NO internal race (Task 48 fix6 pattern) — the old 33s race
      // fired null under contention and DISCARDED the eventual scraper
      // result, so the 15min cache never filled and every refresh re-ran
      // full-cold ("stuck on loading, nothing plays"). The resolver's 35s
      // SOURCE_TIMEOUT + client budget bound delivery; the uncapped promise
      // completes in background and caches for the next open.
      streams = await withRetryOnEmpty(() => mod.getStreams(String(tmdbId.id), mediaType, tmdbId.season || null, tmdbId.episode || null), { maxTotalMs: 22000, tag: 'hdhub4uv2' });
    } catch (e) {
      console.error(`[hdhub4u-v2] error: ${e?.message || e}`);
      return [];
    }

    if (!Array.isArray(streams) || streams.length === 0) return [];

    // Real values only — unknown fields stay out of the title so enrichMeta
    // can't adopt fabricated specs as truth (Task 39).
    const enrichedStreams = streams.map(s => {
      const height = parseHeight(s.quality);
      const isHls = s.mime === 'application/vnd.apple.mpegurl' || (s.url || '').includes('.m3u8');
      const isGDrive = (s.url || '').includes('googleusercontent.com');

      const specParts = [];
      if (height) specParts.push(height + 'p');
      if (s.sourceType) specParts.push(s.sourceType);
      if (s.codec) specParts.push(s.codec);
      if (s.bitDepth) specParts.push(s.bitDepth);
      if (s.audio) specParts.push(s.audio);
      const spec = specParts.length > 0 ? `[HDHub4u ${specParts.join(' ')}]` : '[HDHub4u]';

      const fileSize = parseSize(s.size);

      return {
        url: s.url,
        quality: height ? height + 'p' : (s.quality || undefined),
        title: spec,
        name: 'HDHub4u - ' + (s.quality || (height ? height + 'p' : 'Download')),
        size: fileSize ? bytes(fileSize) : undefined,
        headers: isGDrive ? { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' } : undefined,
        // Task 41: hdstream4u "Watch Online" HLS (acek-cdn/dramiyos-cdn hls2
        // masters) 403s when a client fetches the signed master.m3u8 directly
        // (IP-gated — verified live: direct 403, /proxy 200 with AND without
        // Referer). Setting Referer makes NuvioExtractor route the whole HLS
        // tree through /proxy?referer=…, which also rewrites variant/segment
        // URLs so the entire tree authenticates through the addon.
        ...(isHls && !isGDrive ? { headers: { Referer: 'https://hdstream4u.com/' } } : {}),
        // internal passthrough for the meta post-pass
        _fileSize: fileSize,
        _sourceType: s.sourceType || undefined,
        _codec: s.codec || undefined,
        _bitDepth: s.bitDepth || undefined,
        _isHls: isHls,
      };
    });

    const results = buildStreamResults({
      streams: enrichedStreams,
      title,
      sourceId: this.id,
      sourceLabel: this.label,
      countryCodes: this.countryCodes,
      ctx,
    });

    // Attach the scraper's REAL fields to meta so the card's spec line,
    // size line and audio flags show site-parsed values (VegaMovies pattern).
    for (const r of results) {
      const matched = enrichedStreams.find(s => s.url === r.url.href);
      if (!matched) continue;
      if (matched._sourceType) r.meta.sourceType = matched._sourceType;
      if (matched._codec) r.meta.codec = matched._codec;
      if (matched._bitDepth) r.meta.bitDepth = matched._bitDepth;
      if (matched._fileSize) r.meta.bytes = matched._fileSize;
    }

    return results;
  }
}
