// src/extractor/Netlio.js
// Netlio extractor — passthrough for direct HLS URLs from netlio.vercel.app.
//
// The Netlio source already resolves to direct HLS master playlist URLs
// (e.g., on hightechsecurity.shop, onlineartacademy.site, etc.) via the
// GitHub API. These URLs require a Referer header to play.
// No extraction step needed — just pass through with the Referer.

import { Format } from '../types.js';
import { Extractor } from './Extractor.js';

// Netlio uses dozens of rotating CDN domains. Instead of listing each one,
// we match by URL path pattern: all Netlio HLS URLs contain "cf-master"
// or "/v4/" in the path, and "/hls3/" for movie streams.
const hasNetlioPathMarker = (url) => {
  const path = url.pathname.toLowerCase();
  return path.includes('cf-master') ||
         path.includes('/v4/') ||
         path.includes('/hls3/');
};

const isNetlioCdnUrl = (url) => {
  // *.workers.dev is Cloudflare's SHARED worker domain — dozens of unrelated
  // embed APIs live there (e.g. Raflix's api.anicine-embed.workers.dev serves
  // an HTML player page). A bare hostname match hijacked those URLs from other
  // sources and shipped unplayable HTML to players → "[mpv] unrecognized file
  // format" playback errors. Netlio's own URLs always carry a path marker
  // (cf-master / /v4/ / /hls3/ — verified against its GitHub URL source), so
  // workers.dev hosts must ALSO match the path pattern to be claimed here.
  if (url.hostname.endsWith('.workers.dev')) return hasNetlioPathMarker(url);
  return hasNetlioPathMarker(url);
};

const REFERER = 'https://netlio.vercel.app/';

export class Netlio extends Extractor {
  constructor(fetcher, logger) {
    super(fetcher, logger);
    this.id = 'netlio';
    this.label = 'Netlio';
    this.ttl = 3600000; // 1h
  }

  supports(_ctx, url) {
    return isNetlioCdnUrl(url);
  }

  async extractInternal(ctx, url, meta) {
    // Cloudflare-protected CDN (aurorionacademy.site, professionalidentity.cyou,
    // etc.) returns 403 to server-side requests. Route through /proxy which
    // uses got-scraping with HeaderGenerator for CF bypass.
    // The proxy also rewrites relative URLs in the m3u8 playlist.
    //
    // Task 57 (2026-09-19): the rotating CDN hosts now also IP-GATE specific
    // datacenter egresses. Live evidence (Squid Game S1E1,
    // 1hyahuwewhyvwmq.mortgagerefinance.cfd): the /proxy path (Render egress)
    // gets 404 from BOTH got-scraping AND plain fetch, while the same URL
    // returns 200 #EXTM3U from a different datacenter IP — the /proxy path
    // can never work from Render. Fix (Task 54 fix4 salsa pattern): quick
    // server-side reachability probe (3.5s cap); if the CDN answers → /proxy
    // wrap (existing behavior, CF-bypass + rewrite benefits); if it blocks
    // Render → ship DIRECT + requestHeaders (netlio referer) so the PLAYER's
    // IP fetches it — exactly what the real site's browser does.
    let renderBlocked = false;
    try {
      await this.fetcher.fetchWithTimeout(ctx, new URL(url.href), {
        timeout: 3500,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', Referer: REFERER },
        maxRedirects: 0,
      });
      renderBlocked = false; // 2xx from Render → /proxy path works
    } catch (e) {
      const status = e?.statusCode || e?.status || 0;
      // Real HTTP answers from the CDN (403/404) = Render-blocked. Network
      // flakes (status 0) stay on the /proxy path — never flip on inconclusive.
      renderBlocked = status === 403 || status === 404 || status === 410;
      if (renderBlocked) this.logger?.info?.(`Netlio extractor: CDN ${url.hostname} blocks Render egress (HTTP ${status}) — shipping DIRECT + proxyHeaders`);
    }

    if (renderBlocked) {
      return [{
        url: new URL(url.href),
        format: Format.hls,
        label: this.label,
        meta: { ...meta, nuvioDirectWithHeaders: true },
        requestHeaders: { Referer: REFERER, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' },
      }];
    }

    const proxyUrl = new URL('/proxy', ctx.hostUrl);
    proxyUrl.searchParams.set('url', url.href);
    proxyUrl.searchParams.set('referer', REFERER);

    return [{
      url: proxyUrl,
      format: Format.hls,
      label: this.label,
      meta: { ...meta },
    }];
  }
}
