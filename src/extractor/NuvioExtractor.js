// src/extractor/NuvioExtractor.js
// Extractor for Nuvio provider streams (Cineby, DesiFlix, Goated, etc.)
//
// Each Nuvio source returns ORIGINAL stream URLs (not /proxy URLs) with meta
// containing:
//   - meta.sourceId       — the Nuvio source ID (cineby, desiflix, goated, etc.)
//   - meta.nuvioProvider  — true (marks this as a Nuvio stream)
//   - meta.nuvioReferer   — Referer to send (if any)
//   - meta.nuvioForceHls   — true if URL is ambiguous (use forceHls=1)
//
// This extractor matches by meta.nuvioProvider === true, and:
//   - HLS + Referer → /proxy with referer (proxy rewrites m3u8 URLs)
//   - Ambiguous URL + Referer → /proxy with forceHls=1 (proxy does HEAD check)
//   - MP4/MKV + Referer → direct URL with requestHeaders (proxyHeaders)
//   - No Referer → direct URL (DirectStream/ExternalUrl handles)
//
// This follows the same pattern as HiAnime/AnimeKai extractors which match
// by meta.sourceId and route through /proxy with the correct Referer.

import { Format } from '../types.js';
import { Extractor } from './Extractor.js';
import { HUB_HOST_PATTERN } from '../utils/index.js';

// Nuvio source IDs handled by this extractor
const NUVIO_SOURCE_IDS = new Set([
  'cineby', 'hindmoviez', 'movieblast',
  'movies4u', 'playimdb',
  // Batch 2: videasy, anikototv, animesalt,
  // animeworldindia, animesdigital
  'videasy', 'anikototv',
  'animesalt', 'animeworldindia', 'animesdigital',
  // AniChan — anime sub+dub HLS via AniList ID + anichan.net API
  'anichan',
  // ZinkMovies — movies/series via gemma416okl.com API, HLS on rasta428jem.com
  'zinkmovies',
  // 1Embed — movies/TV HLS via 1embed.cc API, requires Referer: 1embed.cc
  'oneembed',
  // Re-added sources (from uploaded Nuvio scrapers):
  // zxcstream — embed URLs from player.zxcstream.xyz (route through /proxy)
  // animezey — anime HLS from workers.dev (direct)
  // uhdmovies — movies from googleusercontent (Referer: driveseed.org)
  // moviesdrive — direct googleusercontent URLs (resolved via hub_extractor)
  // NOTE: hdhub4u is NOT here — its hubcdn/hubcloud URLs are handled by
  // HubExtractor/HubCloud downstream, not NuvioExtractor.
  // NOTE: 'cinejoy' (the old v1 source) was deleted — only 'cinejoyaio' remains.
  'zxcstream', 'animezey', 'uhdmovies', 'moviesdrive', 'framextv', 'flystream', 'cinejoyaio',
  // nikastream — anime sub+dub HLS via Anivexa API (kryntal.top needs Referer)
  'nikastream',
  // streamxtv — streamxtv.sbs direct HLS via api.framextv.tech (20 providers,
  // up to 4K). Per-CDN Referer (player.videasy.to / yesmovies.ag / …) MUST be
  // routed through /proxy or the CDNs return 403.
  'streamxtv',
  // cinebyrocks — movies/TV/anime via VidRock API (multi-CDN direct m3u8/mp4)
  'cinebyrocks',
  // stellar — movies/TV/anime via PoW + AES-GCM (HLS gated behind
  //   Origin/Referer: stellar.gdn since 2026-09-11 upstream change — routed
  //   through /proxy with origin= + referer=; see src/source/Stellar.js)
  'stellar',
  // raflixnuvio — Raflix's server-resolved CinePro streams (sourceId is a
  // dedicated pseudo-ID so ONLY those streams route through here — /proxy
  // with whole-tree Referer rewriting; Raflix's raw embed results keep
  // flowing through the normal extractor registry as sourceId 'raflix')
  'raflixnuvio',
  // desiflix — movies/TV/anime via manifest.desitvhub.eu.org Stremio addon
  //   Streams are direct URLs (flixsix.com MP4, manifest proxy HLS/MP4) with
  //   no Referer needed — NuvioExtractor passes them through as direct URLs.
  'desiflix',
  // V2 Nuvio-helper sources — use buildStreamResults from nuvioHelpers.js
  // which sets meta.nuvioProvider = true. These don't currently set
  // nuvioReferer (URLs are direct-playable), so NuvioExtractor routes them
  // as direct URLs (the "else" fallback). Adding them here ensures that if
  // they ever start returning Referer headers, the extractor will handle
  // them correctly instead of silently dropping the Referer.
  //   - hindmovie: GDShine workers.dev (direct MKV, no Referer)
  //   - hdhub4uv2: GDrive googleusercontent + acek-cdn/dramiyos-cdn HLS
  //   - movieshuntv2: hubcloud R2 + pixeldrain + GDrive (no Referer)
  //   - moviesdrivev2: GDrive googleusercontent (no Referer, /range-proxy)
  'hindmovie', 'hdhub4uv2', 'movieshuntv2', 'moviesdrivev2',
  // persianstremio — Persian dual-audio direct MP4/MKV (needs Referer:
  // persianstremio.vercel.app for cinamadownload.top / aslmd.sbs URLs)
  'persianstremio',
  // Orphan Nuvio sources (registered in batch) — all use buildStreamResults
  //   - dahmermovies: p.111477.xyz bulk API (direct, no Referer)
  //   - dahmermovies4k: 4K variant of dahmermovies
  //   - videasyto: speedracelight API (direct playable, no Referer)
  //   - kmmovies: kmmovies.pics → R2 + Pixeldrain (direct playable MKV, no Referer)
  'dahmermovies', 'dahmermovies4k', 'videasyto', 'kmmovies',
]);

// Detect if URL is clearly HLS (m3u8 file or /playlist path)
function isHlsUrl(url) {
  const p = url.pathname.toLowerCase();
  return p.endsWith('.m3u8') || p.includes('.m3u8') || p.includes('/m3u8/') || p.includes('/playlist');
}

// Detect if URL is clearly a video file (MP4/MKV)
function isVideoFileUrl(url) {
  const p = url.pathname.toLowerCase();
  return p.endsWith('.mp4') || p.endsWith('.mkv') || p.endsWith('.webm') || p.endsWith('.avi') || p.endsWith('.mov');
}

export class NuvioExtractor extends Extractor {
  constructor(fetcher, logger) {
    super(fetcher, logger);
    this.id = 'nuvio';
    this.label = 'Nuvio';
    this.ttl = 1800000; // 30min — Nuvio stream URLs often have short-lived tokens
  }

  supports(_ctx, _url, meta) {
    // Match any Nuvio source by meta.sourceId
    return NUVIO_SOURCE_IDS.has(meta?.sourceId);
  }

  async extractInternal(ctx, url, meta) {
    const referer = meta?.nuvioReferer || '';
    const forceHls = meta?.nuvioForceHls === true;
    const userAgent = meta?.nuvioUserAgent || '';
    // Origin header (Stellar: its CDN workers 403 without Origin: stellar.gdn).
    // Appended as origin= on /proxy URLs; the proxy sends it upstream AND
    // propagates it onto every rewritten m3u8 URL (whole-tree auth).
    const origin = meta?.nuvioOrigin || '';
    const hls = isHlsUrl(url);
    const videoFile = isVideoFileUrl(url);

    // Hub-family hosts (hubcloud/hubdrive/hubcdn/gdflix) are DOWNLOAD PAGES —
    // direct-shipping them is a guaranteed "[mpv] unrecognized file format"
    // (KMMovies' 15 hubcloud.foo/drive pages shipped raw this way). This
    // extractor sits BEFORE HubExtractor in the registry order, so returning
    // [] here lets the registry's fallback chain hand the URL to
    // HubExtractor, which resolves the page into real direct-file URLs.
    if (HUB_HOST_PATTERN.test(url.hostname)) {
      return [];
    }

    // Google Drive hosts don't support HTTP Range — route through /range-proxy
    // for Range translation so Stremio can seek. This applies to UHDMovies
    // (googleusercontent) and MoviesDrive (lh3.googleusercontent).
    // /range-proxy does NOT support Referer — Google URLs don't need Referer.
    if (url.hostname.includes('googleusercontent.com')) {
      const proxyUrl = new URL('/range-proxy', ctx.hostUrl);
      proxyUrl.searchParams.set('url', url.href);
      return [{
        url: proxyUrl,
        format: Format.mp4,
        meta: { ...meta },
      }];
    }

    // Routing strategy (same as HiAnime/AnimeKai pattern):
    //   - HLS + Referer → /proxy (proxy rewrites m3u8 URLs + sends Referer)
    //   - Ambiguous URL + Referer → /proxy with forceHls=1
    //   - MP4/MKV + Referer → direct URL with requestHeaders (proxyHeaders)
    //   - forceHls (no Referer) → /proxy with forceHls=1 (AniChan: m3u8 with
    //     relative variant URLs that need rewriting, but no Referer needed)
    //   - No Referer, no forceHls → direct URL
    if (referer && hls) {
      const proxyUrl = new URL('/proxy', ctx.hostUrl);
      proxyUrl.searchParams.set('url', url.href);
      proxyUrl.searchParams.set('referer', referer);
      if (origin) proxyUrl.searchParams.set('origin', origin);
      return [{
        url: proxyUrl,
        format: Format.hls,
        meta: { ...meta },
      }];
    } else if (referer && !videoFile) {
      // Ambiguous URL with Referer — use forceHls so proxy detects HLS
      const proxyUrl = new URL('/proxy', ctx.hostUrl);
      proxyUrl.searchParams.set('url', url.href);
      proxyUrl.searchParams.set('referer', referer);
      if (origin) proxyUrl.searchParams.set('origin', origin);
      proxyUrl.searchParams.set('forceHls', '1');
      return [{
        url: proxyUrl,
        format: Format.hls,
        meta: { ...meta },
      }];
    } else if (forceHls) {
      // forceHls without Referer — route through /proxy with forceHls=1
      // (AniChan m3u8 has relative variant URLs that need rewriting)
      const proxyUrl = new URL('/proxy', ctx.hostUrl);
      proxyUrl.searchParams.set('url', url.href);
      if (origin) proxyUrl.searchParams.set('origin', origin);
      proxyUrl.searchParams.set('forceHls', '1');
      return [{
        url: proxyUrl,
        format: Format.hls,
        meta: { ...meta },
      }];
    } else if (referer) {
      // MP4/MKV with Referer → direct URL with requestHeaders
      const requestHeaders = { Referer: referer };
      if (userAgent) requestHeaders['User-Agent'] = userAgent;
      if (origin) requestHeaders['Origin'] = origin;
      return [{
        url,
        format: Format.mp4,
        meta: { ...meta },
        requestHeaders,
      }];
    } else {
      // No Referer → direct URL
      return [{
        url,
        format: hls ? Format.hls : Format.mp4,
        meta: { ...meta },
      }];
    }
  }
}
