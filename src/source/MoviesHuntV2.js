// src/source/MoviesHuntV2.js
// movieshunt.casa — movies/TV with direct download links (up to 4K)
//
// Uses the all-in-one scraper (src/nuvio/movieshunt_v2.cjs) which:
//   1. Searches via /lookup.php (JSON) with legacy ?s= fallback
//   2. Finds abhilinks.site/archives/{id} links with quality labels
//   3. Resolves abhilinks → hubcloud.cx/drive/{id} + gdflix.dev/file/{id}
//   4. Resolves hubcloud → gamerxyt.com → GDrive or pixeldrain
//   5. Resolves gdflix → *.indexserver.site (direct ZIP)
//
// METADATA (Task 39): the scraper returns REAL quality/size/codec/sourceType/
// audio parsed from the site's own post title and archive headers. Unknown
// fields are omitted — the old wrapper fabricated "WEB-DL x264 Hindi-English"
// for every stream (codec guessed from height, audio hardcoded), which
// enrichedMeta then adopted as truth. Nothing is invented here anymore.

import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import bytes from 'bytes';
import { CountryCode } from '../types.js';
import { getTmdbId, getTmdbNameAndYear, TmdbId } from '../utils/index.js';
import { Source } from './Source.js';
import { buildStreamResults, parseSize } from './nuvioHelpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROVIDER_PATH = path.join(__dirname, '..', 'nuvio', 'movieshunt_v2.cjs');
const require_ = createRequire(import.meta.url);

let _scraperMod = null;
function getScraperModule() {
  if (_scraperMod) return _scraperMod;
  try { _scraperMod = require_(PROVIDER_PATH); }
  catch (e) { console.error(`[movieshunt-v2] failed to load scraper: ${e?.message || e}`); }
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

export class MoviesHuntV2 extends Source {
  constructor(fetcher) {
    super();
    this.id = 'movieshuntv2';
    this.label = 'MoviesHunt';
    this.contentTypes = ['movie', 'series'];
    this.countryCodes = [CountryCode.multi, CountryCode.hi, CountryCode.en];
    this.baseUrl = 'https://movieshunt.casa';
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
      streams = await Promise.race([
        mod.getStreams(String(tmdbId.id), mediaType, tmdbId.season || null, tmdbId.episode || null),
        new Promise(r => setTimeout(() => r(null), 28000)),
      ]);
    } catch (e) {
      console.error(`[movieshunt-v2] error: ${e?.message || e}`);
      return [];
    }

    if (!Array.isArray(streams) || streams.length === 0) return [];

    // Real values only — unknown fields stay out of the title so enrichMeta
    // can't adopt fabricated specs as truth (Task 39).
    const enrichedStreams = streams.map(s => {
      const height = parseHeight(s.quality);
      const isHls = (s.url || '').includes('.m3u8');

      const specParts = [];
      if (height) specParts.push(height + 'p');
      if (s.sourceType) specParts.push(s.sourceType);
      if (s.codec) specParts.push(s.codec);
      if (s.bitDepth) specParts.push(s.bitDepth);
      if (s.audio) specParts.push(s.audio);
      const spec = specParts.length > 0 ? `[MoviesHunt ${specParts.join(' ')}]` : '[MoviesHunt]';

      const fileSize = parseSize(s.size);

      return {
        url: s.url,
        quality: height ? height + 'p' : (s.quality && s.quality !== '?' ? s.quality : undefined),
        title: spec,
        name: 'MoviesHunt - ' + ((s.quality && s.quality !== '?') ? s.quality : (height ? height + 'p' : 'Download')),
        size: fileSize ? bytes(fileSize) : undefined,
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
