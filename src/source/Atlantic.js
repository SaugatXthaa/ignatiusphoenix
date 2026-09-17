// src/source/Atlantic.js — atlantic.st (Task 48 reverse engineering)
//
// https://atlantic.st/ is a TMDB-driven React SPA with two stream servers and
// a 3-provider subtitle stack (full RE trail in src/nuvio/atlantic.cjs):
//   Artemis   — stellar.maybeoneday.ch/resolve (Orbit fMP4 up to 2160p movies/
//               TV, Nova muxed up to 1080p anime/TV) — no signing
//   Aphrodite — cdn.maybeoneday.ch/content/... (curated single-4K-variant
//               masters) — aphrodite.a.v1 HMAC/AES-GCM gate (port in scraper)
// Subtitles: granite (sub.vdrk.site, VTT, header-free, up to ~100 languages)
// + natsuki (natsuki.maybeoneday.ch, SRT, Origin-gated → /proxy-wrapped).
// Both attach as meta.subtitles → Stremio stream.subtitles (site-native subs
// take priority; the addon's OpenSubtitles fallback only fills sources that
// ship none).
//
// Audio metadata: Orbit multi-audio masters carry unnamed audio groups
// ("Audio 1"/"Audio 2", no LANGUAGE attribute upstream) — the card title says
// "N audio tracks" without inventing languages. For the source-level flag we
// use TMDB original_language (Cineby/VidEasy pattern): ja → Japanese (anime),
// ko → Korean, en → English. Nova muxed streams carry the original audio.
//
// Anime: served through the same TV path (Frieren/One Piece verified via Nova,
// muxed Japanese audio + site subs). No separate dub endpoints exist in the
// bundle — when a title's HLS has multiple audio groups the card exposes them
// via the player's audio menu; nothing is fabricated.

import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { CountryCode } from '../types.js';
import { getImdbId, getTmdbId, getTmdbNameAndYear, TmdbId } from '../utils/index.js';
import { Source } from './Source.js';
import { buildStreamResults } from './nuvioHelpers.js';
import { TMDB_PRIMARY } from '../utils/site-secrets.cjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROVIDER_PATH = path.join(__dirname, '..', 'nuvio', 'atlantic.cjs');
const require_ = createRequire(import.meta.url);

let _scraperMod = null;
function getScraperModule() {
  if (_scraperMod) return _scraperMod;
  try {
    _scraperMod = require_(PROVIDER_PATH);
  } catch (e) {
    console.error(`[atlantic] failed to load scraper: ${e?.message || e}`);
    return null;
  }
  return _scraperMod;
}

// TMDB original_language → honest audio flag (same table as Cineby)
const LANG_TO_CC = {
  ja: CountryCode.ja,
  ko: CountryCode.ko,
  en: CountryCode.en,
  zh: CountryCode.zh,
  hi: CountryCode.hi,
  fr: CountryCode.fr,
  es: CountryCode.es,
  de: CountryCode.de,
  pt: CountryCode.pt,
  it: CountryCode.it,
};

export class Atlantic extends Source {
  constructor(fetcher) {
    super();
    this.id = 'atlantic';
    this.label = 'Atlantic';
    this.contentTypes = ['movie', 'series'];
    this.countryCodes = [CountryCode.multi, CountryCode.en];
    this.baseUrl = 'https://atlantic.st';
    this.fetcher = fetcher;
    // Payload URLs are opaque signed blobs upstream; the site refetches every
    // play. 10min (cineby parity) keeps cached cards playable without serving
    // stale payloads indefinitely.
    this.ttl = 10 * 60 * 1000;
  }

  async handleInternal(ctx, _type, id) {
    const tmdbId = await getTmdbId(this.fetcher, ctx, id);
    const [name, year] = await getTmdbNameAndYear(this.fetcher, ctx, tmdbId);
    const title = name + (tmdbId.season ? ` ${TmdbId.formatSeasonAndEpisode(tmdbId)}` : ` (${year})`);

    let imdbId = '';
    try {
      imdbId = (await getImdbId(this.fetcher, ctx, tmdbId)).id || '';
    } catch { /* best effort — natsuki matches by tmdbId without it */ }

    // original_language → honest audio label — fetched in PARALLEL with the
    // scraper (it only feeds buildStreamResults' countryCodes, so the serial
    // path pays zero for it; production evidence: 4 serial TMDB-phase calls
    // under Render resolve storms ate 15-18s before the scraper even started,
    // then the 20s race expired with 0 cards).
    const mediaType0 = tmdbId.season ? 'tv' : 'movie';
    const origLangP = (async () => {
      try {
        const url = `https://api.themoviedb.org/3/${mediaType0}/${tmdbId.id}?api_key=${process.env.TMDB_API_KEY || TMDB_PRIMARY}`;
        const { gotScraping } = await import('got-scraping');
        const r = await gotScraping.get(url, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
          timeout: { request: 8000 }, throwHttpErrors: false, http2: false,
        });
        return r.statusCode === 200 ? (JSON.parse(r.body).original_language || '') : '';
      } catch { return ''; }
    })().catch(() => '');

    const mediaType = mediaType0;
    console.log(`[Atlantic] Request: tmdb=${tmdbId.id} type=${mediaType}${tmdbId.season ? ` S${tmdbId.season}E${tmdbId.episode || 1}` : ''} imdb=${imdbId || '-'} (origLang pending)`);
    const mod = getScraperModule();
    if (!mod || typeof mod.getStreams !== 'function') return [];

    // Both servers + subs run in parallel inside the scraper (~2-5s measured
    // uncontended, 10-20s under Render resolve storms with fetchRetry). One
    // empty retry absorbs transient upstream windows; race cap 25s keeps the
    // whole source under the resolver's 35s cutoff including the TMDB phase.
    const EMPTY_RETRY_MAX = 1;
    const EMPTY_RETRY_DELAY_MS = 2000;

    const preloaded = {
      title: name,
      year: year ? String(year) : '',
      imdbId,
      hostUrl: ctx?.hostUrl ? ctx.hostUrl.href : '',
    };

    let streams;
    try {
      streams = await Promise.race([
        (async () => {
          let out = await mod.getStreams(tmdbId.id, mediaType, tmdbId.season || null, tmdbId.episode || null, preloaded);
          for (let attempt = 0; Array.isArray(out) && out.length === 0 && attempt < EMPTY_RETRY_MAX; attempt++) {
            await new Promise(r => setTimeout(r, EMPTY_RETRY_DELAY_MS));
            out = await mod.getStreams(tmdbId.id, mediaType, tmdbId.season || null, tmdbId.episode || null, preloaded);
          }
          return out;
        })(),
        new Promise(r => setTimeout(() => r(null), 25000)),
      ]);
    } catch (e) {
      console.error(`[atlantic] getStreams error: ${e?.message || e}`);
      return [];
    }
    if (!Array.isArray(streams)) return [];
    const originalLang = await Promise.race([origLangP, new Promise(r => setTimeout(() => r(''), 9000))]);
    console.log(`[Atlantic] provider returned ${streams.length} streams (origLang=${originalLang || '-'})`);
    const langCC = LANG_TO_CC[originalLang];
    const countryCodes = langCC ? [CountryCode.multi, langCC] : [CountryCode.multi];

    const results = buildStreamResults({
      streams,
      title,
      sourceId: this.id,
      sourceLabel: this.label,
      countryCodes,
      ctx,
    });

    // ipGated mapping (Task 48): peraspera workers.dev 429-blocks our
    // datacenter IP — /proxy cannot fetch it, but the PLAYER's residential IP
    // with Origin/Referer passes (exactly what the real site's browser sends).
    // NuvioDirectWithHeaders ships those cards DIRECT with requestHeaders
    // (Stremio proxyHeaders) instead of routing through /proxy.
    const rawByHref = new Map(streams.map(s => [s.url, s]));
    for (const r of results) {
      const raw = r?.url ? rawByHref.get(r.url.href) : null;
      if (raw?.ipGated && r.meta) {
        r.meta.nuvioDirectWithHeaders = true;
      }
    }
    return results;
  }
}
