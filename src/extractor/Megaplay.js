// src/extractor/Megaplay.js
// Megaplay + VidTube embed pages — anime HLS via the getSourcesNew API.
//
// Used by:
//   - Anikoto source (anikoto.cz) — megaplay.buzz/stream/s-5/{id}/{sub|dub}
//   - StreamXTV source (streamxtv.tech) — megaplay.buzz/stream/ani/{alId}/{ep}/{sub|dub}
//   - 2Dhive source (2dhive.com) — megaplay.buzz/stream/mal/{malId}/{ep}/{sub|dub}
//   - AllWish source (all-wish.me) — megaplay.buzz/stream/s-1/{token}
//   - AniDoor source (anidoor.me) — megaplay.buzz/stream/ani/{alId}/{ep}/{sub|dub}
//
// Flow (verified live 2026-09):
//   1. Fetch the embed page (needs Referer: <upstream-site>)
//   2. Extract data-id from #megaplay-player div
//   3. GET https://megaplay.buzz/stream/getSourcesNew?id={data-id}
//      with X-Requested-With: XMLHttpRequest
//      → response NOW returns { tracks, t, intro, outro, server, enc } where
//        `enc` decrypts (AES-256-CBC, key/IV from the site's own player JS) to
//        { file: "<master.m3u8>" } — handled by megaplay_decrypt.cjs
//   4. The m3u8 CDN (fetch.nexabloom.top / *.vyrnex.top) hard-403s DATACENTER
//      IPs (Cloudflare / openresty IP-reputation gate) — /proxy would fetch
//      from THIS server and always 403. Ship the m3u8 DIRECT with Referer
//      proxyHeaders so the PLAYER's residential IP fetches it, and attach
//      the multi-language subtitle tracks the API returns.
//      (Verified server-side: all header combos 403 — direct is the only path.)

import { Format } from '../types.js';
import { Extractor } from './Extractor.js';
import { decryptMegaplayEnc } from '../nuvio/megaplay_decrypt.cjs';

// Hosts that use the megaplay.buzz player backend
const MEGAPLAY_HOSTS = [
  'megaplay.buzz',
  'megaplay-1.buzz',
  'vidtube.site',
];

// Hostname suffix match (for subdomains)
const MEGAPLAY_SUFFIXES = [
  '.megaplay.buzz',
  '.vidtube.site',
];

function isMegaplay(url) {
  if (MEGAPLAY_HOSTS.includes(url.hostname)) return true;
  return MEGAPLAY_SUFFIXES.some(suffix => url.hostname.endsWith(suffix));
}

// Infer the upstream anime site Referer from the URL path
function inferUpstreamReferer(url) {
  // megaplay.buzz/stream/ani/{alId}/{ep}/{subDub} → anidoor.me / streamxtv.tech
  // We use anidoor.me by default (it's the most generic upstream)
  if (url.pathname.includes('/stream/ani/')) return 'https://anidoor.me/';
  // megaplay.buzz/stream/mal/{malId}/{ep}/{subDub} → 2dhive.com
  if (url.pathname.includes('/stream/mal/')) return 'https://2dhive.com/';
  // megaplay.buzz/stream/s-1/{token} → all-wish.me
  if (url.pathname.includes('/stream/s-1/')) return 'https://all-wish.me/';
  // megaplay.buzz/stream/s-2/... or s-5/... → anikoto.cz (default)
  return 'https://anikoto.cz/';
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function gotGet(url, headers = {}) {
  const { gotScraping } = await import('got-scraping');
  const res = await gotScraping.get(url, {
    headers: { 'User-Agent': UA, ...headers },
    timeout: { request: 15000 },
    throwHttpErrors: false,
    followRedirect: true,
  });
  return res;
}

async function gotJson(url, headers = {}) {
  const res = await gotGet(url, headers);
  if (res.statusCode !== 200) return null;
  try { return JSON.parse(res.body); } catch { return null; }
}

export class Megaplay extends Extractor {
  constructor(fetcher, logger) {
    super(fetcher, logger);
    this.id = 'megaplay';
    this.label = 'Megaplay';
    this.ttl = 1800000; // 30min — m3u8 tokens may expire
  }

  supports(_ctx, url) {
    return isMegaplay(url);
  }

  async extractInternal(ctx, url, meta) {
    const upstreamReferer = inferUpstreamReferer(url);

    // Step 1: Fetch the embed page to extract data-id
    let dataId = null;
    try {
      const res = await gotGet(url.href, { Referer: upstreamReferer });
      // If the page returns 404 or "Not Found", return no streams
      // (some vidtube.site links are expired/dead)
      if (res.statusCode !== 200 || res.body.includes('Page not found') || res.body.includes('Not Found')) {
        return [];
      }
      if (res.statusCode === 200) {
        const match = res.body.match(/data-id="(\d+)"/);
        if (match) dataId = match[1];
      }
    } catch { /* fetch failed — fall through to direct URL extraction */ }

    // Step 2: If we have data-id, call getSourcesNew to get the actual m3u8
    if (dataId) {
      const apiUrl = `https://megaplay.buzz/stream/getSourcesNew?id=${dataId}`;
      const data = await gotJson(apiUrl, {
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': url.href,
        'Accept': 'application/json,text/plain,*/*',
      });

      // 2026-09 API change: the response now carries an encrypted `enc` blob
      // instead of a plaintext sources.file. Decrypt it in place so the
      // existing data?.sources?.file logic below keeps working unchanged.
      if (data && !data.sources && data.enc) {
        const dec = decryptMegaplayEnc(data.enc);
        if (dec && dec.file) data.sources = { file: dec.file };
      }

      if (data?.sources?.file) {
        let m3u8Url;
        try { m3u8Url = new URL(data.sources.file); } catch { m3u8Url = null; }

        if (m3u8Url) {
          // The m3u8 CDN (fetch.nexabloom.top / *.vyrnex.top) hard-403s
          // DATACENTER IPs — /proxy fetches from THIS server and would always
          // 403. Ship the m3u8 DIRECT with proxyHeaders so the PLAYER's
          // residential IP fetches it. (Verified live 2026-09: all server-side
          // header combos 403 — direct is the only viable path.)

          // Collect multi-language subtitle tracks from the API response.
          // Format per track: { file: "https://...vtt", label: "English", kind: "captions" }
          const subtitles = (Array.isArray(data.tracks) ? data.tracks : [])
            .filter(t => t && t.file && (t.kind === 'captions' || t.kind === 'subtitles'))
            .map(t => ({
              id: String(t.label || 'en').slice(0, 8),
              url: t.file,
              lang: t.label || 'en',
            }));

          // Try to fetch the m3u8 playlist to extract resolution/height.
          // The playlist contains #EXT-X-STREAM-INF:...,RESOLUTION=WxH,...
          // (server-side fetch usually 403s — height detection is best-effort)
          let height = meta?.height;
          if (!height) {
            try {
              const playlistRes = await gotGet(m3u8Url.href, {
                'Referer': 'https://megaplay.buzz/',
              });
              if (playlistRes.statusCode === 200) {
                const resMatch = playlistRes.body.match(/RESOLUTION=\d+x(\d+)/i);
                if (resMatch) height = parseInt(resMatch[1]);
              }
            } catch { /* resolution detection failed — not critical */ }
          }

          return [{
            url: m3u8Url,
            format: Format.hls,
            label: this.label,
            ...(subtitles.length > 0 && { requestHeaders: { Referer: 'https://megaplay.buzz/' } }),
            meta: { ...meta, ...(height && { height }), ...(subtitles.length > 0 && { subtitles }) },
          }];
        }
      }
    }

    // Step 3: Fallback — look for direct m3u8/mp4 URLs in the page HTML
    // (some megaplay mirrors embed stream URLs in inline scripts)
    try {
      const res = await gotGet(url.href, { Referer: upstreamReferer });
      if (res.statusCode === 200) {
        const m3u8Match = res.body.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/i);
        const mp4Match = res.body.match(/https?:\/\/[^"'\s<>]+\.mp4[^"'\s<>]*/i);
        const directUrl = m3u8Match?.[0] || mp4Match?.[0];

        if (directUrl) {
          let parsed;
          try { parsed = new URL(directUrl); } catch { parsed = null; }
          if (parsed) {
            const format = parsed.href.includes('.m3u8') ? Format.hls : Format.mp4;

            return [{
              url: parsed,
              format,
              label: this.label,
              requestHeaders: { Referer: 'https://megaplay.buzz/' },
              meta: { ...meta },
            }];
          }
        }
      }
    } catch { /* extraction failed */ }

    // No last-resort page shipping: routing the embed PAGE through /proxy
    // ships an HTML document as a video URL — a guaranteed "[mpv] unrecognized
    // file format" playback error. Zero playable URLs beats a dead card.
    return [];
  }
}
