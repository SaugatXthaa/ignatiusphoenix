// src/index.js — PhoeniX addon entry point (WebStreamrMBG port)

import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import { Fetcher } from './utils/Fetcher.js';
import { createSources } from './source/index.js';
import { createExtractors, ExtractorRegistry } from './extractor/index.js';
import { StreamResolver } from './utils/StreamResolver.js';
import { ImdbId, TmdbId } from './utils/id.js';
import { createRequire } from 'module';
// Task 49: shared subtitle module — used by the /debug/subs diagnostic.
const { fetchUnifiedSubs } = createRequire(import.meta.url)('./utils/siteSubtitles.cjs');
import { reanimeSegmentKey } from './utils/site-secrets.cjs';
// Task 54: playback-priority gate — /proxy + /range-proxy raise it while
// serving so the resolver's post-budget background work can yield to playback.
import playbackGate from './utils/playbackGate.cjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT || 7000;
const HOST = process.env.HOST || '0.0.0.0';
const ADDON_NAME = process.env.ADDON_NAME || 'PhoeniX';
const VERSION = '1.3.0';

const logger = console;

const fetcher = new Fetcher(logger);
const sources = createSources(fetcher);
const extractors = createExtractors(fetcher, logger);
const extractorRegistry = new ExtractorRegistry(logger, extractors);
const streamResolver = new StreamResolver(logger, extractorRegistry, fetcher);

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files (logo)
app.use('/public', express.static(join(__dirname, '..', 'public')));

// ============== MANIFEST ==============
app.get('/manifest.json', (req, res) => {
  const hostUrl = `https://${req.headers.host}`;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json({
    id: 'community.phoenix.addon',
    version: VERSION,
    name: ADDON_NAME,
    description: 'Stream movies, series and anime in HD.',
    logo: `${hostUrl}/public/logo.png?v=${VERSION}`,
    resources: ['stream'],
    types: ['movie', 'series'],
    idPrefixes: ['tt', 'tmdb:'],
    catalogs: [],
    behaviorHints: { configurable: false, configurationRequired: false },
  });
});

// ============== STREAM ==============
app.get('/stream/:type/:id.json', async (req, res) => {
  const { type, id } = req.params;

  if (type !== 'movie' && type !== 'series') {
    return res.json({ streams: [] });
  }

  let parsedId;
  try {
    if (id.startsWith('tmdb:')) {
      parsedId = TmdbId.fromString(id.replace('tmdb:', ''));
    } else if (id.startsWith('tt')) {
      parsedId = ImdbId.fromString(id);
    } else {
      return res.status(400).json({ error: `Unsupported ID: ${id}` });
    }
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const ctx = {
    hostUrl: new URL(`https://${req.headers.host}`),
    id: req.headers['x-request-id'] || '',
    ip: req.ip,
    config: { multi: 'on', en: 'on' },
  };

  logger.log(`[${ADDON_NAME}] stream ${type} ${id}`);

  try {
    const startTime = Date.now();
    let streams;
    ({ streams } = await streamResolver.resolve(ctx, sources, type, parsedId));
    const duration = Date.now() - startTime;
    logger.log(`[${ADDON_NAME}] ${type} ${id} → ${streams.length} streams in ${duration}ms`);

    // Starved-response cache hint: when a response carries fewer streams than
    // the resolver had sources available, the request almost certainly hit the
    // global deadline before slow sources finished (cold start, free-tier CPU
    // spike, upstream latency). Caching that starved result for 5 minutes
    // (previous behavior) locked the user out of the full set — by the time a
    // retry arrived, the per-source caches were warm but the app kept showing
    // the cached starved response. A short TTL on starved responses only lets
    // the next fetch pick up the now-warm per-source cached results. Fully
    // populated responses keep the original 5-minute TTL (byte-identical).
    const starved = streams.length < sources.length;
    res.setHeader('Cache-Control', starved ? 'public, max-age=30' : 'public, max-age=300');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json({ streams });
  } catch (err) {
    logger.error(`[${ADDON_NAME}] Stream error: ${err.message}`);
    res.json({ streams: [] });
  }
});

// ============== EXTRACT (lazy extraction) ==============
app.get('/extract', async (req, res) => {
  const rawUrl = req.query.url;
  const rawIndex = req.query.index;

  if (!rawUrl || !rawIndex) {
    return res.status(400).json({ error: 'Missing url or index parameter' });
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return res.status(400).json({ error: 'Invalid url parameter' });
  }

  const index = parseInt(rawIndex);
  if (isNaN(index)) {
    return res.status(400).json({ error: 'Invalid index parameter' });
  }

  const ctx = {
    hostUrl: new URL(`https://${req.headers.host}`),
    id: req.headers['x-request-id'] || '',
    ip: req.ip,
    config: {},
  };

  logger.log(`[${ADDON_NAME}] extract index ${index} of ${url.href}`);

  try {
    const urlResults = await extractorRegistry.handle(ctx, url);
    const urlResult = urlResults[index];

    if (!urlResult || urlResult.error) {
      return res.status(503).send('Service Unavailable');
    }

    res.redirect(urlResult.url.href);
  } catch (err) {
    logger.error(`[${ADDON_NAME}] Extract error: ${err.message}`);
    res.status(504).send('Gateway Timeout');
  }
});

// ============== PROXY (stream content through addon) ==============
// Used by sources whose CDN hosts may be DNS-blocked on the user's device
// (e.g. fsharetv.cc). The addon fetches the content and streams it back,
// so DNS resolution happens on the server, not the user's device.
//
// For .m3u8 playlists, relative URLs inside the playlist are rewritten to
// /proxy URLs pointing back to this addon (with the same Referer). This
// ensures the player fetches variant playlists and segments through the
// proxy with the correct Referer header — without it, the player resolves
// relative URLs against the proxy URL itself (phoenix-hgs3.onrender.com)
// and gets 404s.
app.get('/proxy', async (req, res) => {
  // Task 54: mark playback traffic — background source starts wait for quiet.
  // res 'close' fires on BOTH normal finish and client abort → gate always released.
  playbackGate.begin();
  res.on('close', () => playbackGate.end());
  const rawUrl = req.query.url;
  const rawReferer = req.query.referer;
  // origin=: optional Origin header forwarded upstream (Stellar's workers CDNs
  // reject playlist/segment requests without Origin: https://stellar.gdn).
  // Like referer=, it is ALSO propagated onto every rewritten m3u8 URL below
  // so the whole variant/segment tree authenticates identically. Additive:
  // absent for every pre-existing proxy consumer → byte-identical behavior.
  const rawOrigin = req.query.origin;
  // forceHls=1: when set, the proxy buffers the response and checks if it's
  // HLS (regardless of URL pattern). Used by Nuvio source adapters for URLs
  // that return HLS content but don't have .m3u8 in the path (e.g. vidlove
  // returns application/vnd.apple.mpegurl from /api?d=... endpoint).
  let forceHls = req.query.forceHls === '1';
  // hls=1: explicit "this URL is part of a proxied HLS tree" marker that
  // rewriteM3u8Urls propagates onto rewritten child URLs (stellar-style
  // origin-gated trees whose variant paths like cdn.reallyfast.ch/v/<token>
  // match NO urlIsM3u8 pattern and would otherwise be served raw, leaving
  // absolute segment URLs that the player then fetches without Origin → 403).
  // Same buffered-rewrite treatment as forceHls, but ALSO suppresses the
  // default Range injection (playlists are truncated/400'd by some workers
  // when a spurious Range is sent).
  if (req.query.hls === '1') forceHls = true;

  if (!rawUrl) {
    return res.status(400).send('Missing url parameter');
  }

  let targetUrl;
  try {
    targetUrl = new URL(rawUrl);
  } catch {
    return res.status(400).send('Invalid url parameter');
  }

  logger.log(`[${ADDON_NAME}] proxy ${targetUrl.hostname}${targetUrl.pathname.slice(0, 50)}`);

  try {
    // ———— Opt-in decrypt mode (Stream Reverse Engineering guide §6) ————
    // When xor= is present the upstream body is auto-detected and decrypted:
    // WebP/PNG-disguised XOR segments, base64(+XOR) m3u8 playlists, or
    // whole-body XOR (implementation: utils/stream-decrypt.cjs). Opt-in ONLY:
    // without these params the original proxy path below runs unchanged.
    // Params: xor=<b64|hex key>  strip=<n header bytes>  b64m3u8=1  ct=<mime>
    if (req.query.xor) {
      const { decryptProxyResponse } = await import('./utils/stream-decrypt.cjs');
      return await decryptProxyResponse({
        req, res, targetUrl,
        rawXor: req.query.xor,
        referer: rawReferer,
        stripHint: req.query.strip,
        expectBase64: req.query.b64m3u8 === '1',
        ctOverride: req.query.ct,
        logger,
        addonName: ADDON_NAME,
        rewrite: (text) => rewriteM3u8Urls(text, targetUrl, rawReferer, req, {
          xor: req.query.xor,
          ...(req.query.strip ? { strip: req.query.strip } : {}),
          ...(req.query.ct ? { ct: req.query.ct } : {}),
          ...(rawOrigin ? { origin: rawOrigin } : {}),
        }),
      });
    }

    const proxyHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': '*/*',
    };
    if (rawReferer) proxyHeaders['Referer'] = rawReferer;
    if (rawOrigin) proxyHeaders['Origin'] = rawOrigin;
    // Pass through Range header for seeking. Some CDNs (workers.dev) require
    // a Range header to return 206 — if Stremio doesn't send one, add a
    // default Range to get the first byte (which triggers 206 + seekability).
    if (req.headers.range) {
      proxyHeaders['Range'] = req.headers.range;
    } else if (!forceHls) {
      // Default Range only for non-HLS-tree requests — workers CDNs serving
      // playlists/segments (stellar themepark) truncate or 400 Range'd
      // playlists. Existing consumers (no hls/forceHls param) unchanged.
      proxyHeaders['Range'] = 'bytes=0-';
    }

    // Use got-scraping for Cloudflare bypass — plain fetch() gets 403
    // from workers.dev and other CF-protected CDN hosts.
    const { gotScraping } = await import('got-scraping');
    const { HeaderGenerator } = await import('header-generator');

    // For Cloudflare-protected CDNs (Netlio: aurorionacademy.site,
    // professionalidentity.cyou, etc.), use HeaderGenerator to generate
    // browser-like headers that pass CF's JS challenge.
    // Task 57: the CDN host ROTATES (mortgagerefinance.cfd observed live —
    // Squid Game S1E1 challenge-page shipped to players = mpv error). Match
    // the Netlio extractor's own identification instead of playing
    // whack-a-mole with hostnames: known hosts OR the distinctive path
    // markers (cf-master, /v4/, /hls3/ — verbatim from
    // src/extractor/Netlio.js isNetlioCdnUrl). HeaderGenerator browser
    // headers are harmless for non-CF hosts on the same paths.
    const isNetlioCdn = /aurorionacademy|professionalidentity|netrocdn|savannahridgedesignlab|creativewritingtips|harborlanecreativeworks|pinecliffdesigncollective|mortgagerefinance/.test(targetUrl.hostname) ||
                        /cf-master|\/v4\/|\/hls3\//.test(targetUrl.pathname.toLowerCase());
    if (isNetlioCdn) {
      const hg = new HeaderGenerator({ browsers: ['chrome'], devices: ['desktop'], operatingSystems: ['windows'], locales: ['en-US', 'en'] });
      const browserHeaders = hg.getHeaders({ httpVersion: '2' });
      // Merge browser headers with our proxy headers (Referer, Range)
      Object.assign(proxyHeaders, browserHeaders);
      if (rawReferer) proxyHeaders['Referer'] = rawReferer;
      if (rawOrigin) proxyHeaders['Origin'] = rawOrigin;
      if (req.headers.range) proxyHeaders['Range'] = req.headers.range;
      else proxyHeaders['Range'] = 'bytes=0-';
    }

    // Check if this is an HLS playlist by URL extension OR by content.
    // Some CDNs (Netlio, AniNeko) disguise HLS playlists with .txt
    // extensions — detect those by checking the response body for #EXTM3U.
    // AniKage uses /m3u8/{token} paths (no .m3u8 extension).
    // AniKage also uses /stream/{token} for BOTH HLS variant playlists AND
    // MP4 streams (megg provider) — we need to check content-type to distinguish.
    // AniPriv8 uses /api/secure/pipeline/{token} for BOTH m3u8 playlists AND
    // MPEG-TS segments — detect by content (small = playlist, large = segment).
    // ZXCStream Berkas uses *.berkasNN.workers.dev/?data=... for BOTH master
    // m3u8 playlists AND variant playlists — detect by hostname pattern.
    const pathLower = targetUrl.pathname.toLowerCase();
    const hostLower = targetUrl.hostname.toLowerCase();
    const urlIsM3u8 = pathLower.endsWith('.m3u8') ||
                      pathLower.includes('.m3u8') ||
                      pathLower.includes('/m3u8/') ||
                      pathLower.includes('/m3u8?') ||  // AniChan /api/watch/m3u8?sh=...
                      pathLower.includes('/playlist');  // goated cdn.reallyfast.xyz/playlist/, DesiFlix vixsrc.to/playlist/
    const urlIsStream = pathLower.includes('/stream/');  // AniKage: could be HLS or MP4
    const urlIsAniPriv8 = pathLower.includes('/api/secure/pipeline/');
    // Berkas: *.berkas*.workers.dev — master m3u8 and variant playlists
    const urlIsBerkas = hostLower.includes('berkas') && hostLower.endsWith('.workers.dev');

    if (forceHls || urlIsM3u8 || urlIsStream || urlIsAniPriv8 || urlIsBerkas) {
      // Buffer content to check if it's HLS and rewrite URLs.
      // For /stream/ paths, use a HEAD request first to check content-type —
      // if it's video/mp4, stream directly (avoid buffering large MP4 files).
      if (urlIsStream) {
        try {
          const headRes = await gotScraping.head(targetUrl.href, {
            headers: proxyHeaders,
            timeout: { request: 8000 },
            throwHttpErrors: false,
            followRedirect: true,
          });
          const ct = (headRes.headers['content-type'] || '').toLowerCase();
          if (ct.includes('video/') || ct.includes('application/octet-stream')) {
            // It's a video file (MP4) — stream directly, skip HLS rewriting
            urlIsStream = false; // fall through to streaming mode
          }
        } catch { /* HEAD failed — try buffering (might be HLS) */ }
      }

      // For AniPriv8, use a HEAD request to check Content-Length —
      // m3u8 playlists are small (< 100KB), segments are large (> 1MB).
      // Only buffer if it's likely a playlist (avoid OOM on large segments).
      if (urlIsAniPriv8) {
        try {
          const headRes = await gotScraping.head(targetUrl.href, {
            headers: proxyHeaders,
            timeout: { request: 8000 },
            throwHttpErrors: false,
            followRedirect: true,
          });
          const cl = parseInt(headRes.headers['content-length'] || '0');
          // Segments are typically > 500KB — stream directly, skip buffering
          if (cl > 500000) {
            urlIsAniPriv8 = false; // fall through to streaming mode
          }
        } catch { /* HEAD failed — try buffering (might be playlist) */ }
      }

      // For forceHls (ambiguous URL): do a HEAD request first to check
      // Content-Type. If it's a video file (MP4/MKV), skip buffering to
      // avoid OOM on Render's 512MB tier.
      if (forceHls) {
        try {
          const headRes = await gotScraping.head(targetUrl.href, {
            headers: proxyHeaders,
            timeout: { request: 8000 },
            throwHttpErrors: false,
            followRedirect: true,
          });
          const ct = (headRes.headers['content-type'] || '').toLowerCase();
          if (ct.includes('video/') || ct.includes('application/octet-stream')) {
            // Video file — stream directly (skip buffering)
            forceHls = false; // fall through to streaming mode
          }
        } catch { /* HEAD failed — try buffering (might be HLS) */ }
      }

      if (forceHls || urlIsM3u8 || urlIsStream || urlIsAniPriv8 || urlIsBerkas) {
        // Buffer content to check if it's HLS and rewrite URLs.
        // Use HTTP/1.1 (http2: false) to avoid "GOAWAY" errors from some
        // servers (e.g. vidlove) that close HTTP/2 connections aggressively.
        // Add 1 retry to handle transient GOAWAY errors.
        let m3u8Res, lastErr;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            m3u8Res = await gotScraping.get(targetUrl.href, {
              headers: proxyHeaders,
              timeout: { request: 30000 },
              throwHttpErrors: false,
              followRedirect: true,
              http2: false,
            });
            break;
          } catch (e) {
            lastErr = e;
            const msg = e?.message || String(e);
            if (msg.includes('GOAWAY') || msg.includes('stream') || msg.includes('HTTP/2')) {
              await new Promise(r => setTimeout(r, 500));
              continue;
            }
            throw e;
          }
        }
        if (!m3u8Res) throw lastErr;

        // Task 54 fix3 — FINGERPRINT FALLBACK: some CDN hosts in the vidking
        // family reject got-scraping's browser TLS/header fingerprint with 404
        // while serving plain undici fetch. Verified LIVE on
        // i-cdn-*.salsa436jam.com (hdmovie/cineby family): same signed URL —
        // got-scraping 404, plain fetch 200 '#EXTM3U'. Before declaring
        // "Upstream error: 404" (which shipped dead-looking cards that were
        // actually ALIVE), retry once with plain global fetch and use it when
        // it succeeds. Only reachable on the previously-broken path — zero
        // behavior change for healthy upstreams.
        if (m3u8Res.statusCode >= 400) {
          const origStatus = m3u8Res.statusCode;
          try {
            const alt = await fetch(targetUrl.href, {
              headers: proxyHeaders,
              redirect: 'follow',
              signal: AbortSignal.timeout(15000),
            });
            if (alt.ok) {
              const text = await alt.text();
              m3u8Res = {
                statusCode: alt.status,
                headers: { get: (k) => alt.headers.get(k) },
                body: text,
              };
              logger.log(`[${ADDON_NAME}] proxy fingerprint-fallback OK for ${targetUrl.hostname} (got-scraping got ${origStatus})`);
            }
          } catch { /* keep the got-scraping failure */ }
        }
        if (m3u8Res.statusCode >= 400) {
          logger.error(`[${ADDON_NAME}] proxy upstream ${m3u8Res.statusCode} for ${targetUrl.hostname}`);
          return res.status(m3u8Res.statusCode).send(`Upstream error: ${m3u8Res.statusCode}`);
        }

        const body = m3u8Res.body;
        const isHls = body.trimStart().startsWith('#EXTM3U');

        if (isHls) {
          // It's an HLS playlist — rewrite relative URLs to absolute /proxy URLs
          // (origin= rides along so variant/segment fetches keep authenticating;
          // hls=1 marks children so variant playlists get the rewrite path too
          // even when their URL shape matches no m3u8 pattern)
          const rewritten = rewriteM3u8Urls(body, targetUrl, rawReferer, req,
            rawOrigin ? { origin: rawOrigin, hls: '1' } : undefined);
          res.status(200);
          res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
          res.setHeader('Content-Length', Buffer.byteLength(rewritten));
          res.send(rewritten);
          return;
        }

        // /stream/ path but not HLS — could be an MP4 or other video format.
        // If the content is small (< 1MB), it might be a redirect page or error.
        // If it's large, stream it directly.
        if (urlIsStream) {
          const contentLength = parseInt(m3u8Res.headers['content-length'] || '0');
          if (contentLength > 0 && contentLength < 1024 * 1024) {
            // Small response — serve as-is (might be a redirect or error page)
            res.status(200);
            const ct = m3u8Res.headers['content-type'] || 'application/octet-stream';
            res.setHeader('Content-Type', ct);
            res.setHeader('Content-Length', Buffer.byteLength(body));
            res.send(body);
            return;
          }
          // Large response — fall through to streaming mode
        }

        // forceHls but response wasn't HLS (HEAD said it might be, but body
        // doesn't start with #EXTM3U). Serve the buffered body directly.
        // HEAD already confirmed it's not a large video file (Content-Type
        // would have been video/* and forceHls would have been cleared).
        if (forceHls) {
          res.status(200);
          const ct = m3u8Res.headers['content-type'] || 'application/octet-stream';
          res.setHeader('Content-Type', ct);
          res.setHeader('Content-Length', Buffer.byteLength(body));
          res.send(body);
          return;
        }
      }
    }

    // Non-m3u8 content — stream directly to avoid OOM on Render's 512MB tier
    const stream = gotScraping.stream(targetUrl.href, {
      headers: proxyHeaders,
      timeout: { request: 30000 },
      throwHttpErrors: false,
      followRedirect: true,
      isStream: true,
      http2: false,  // Avoid GOAWAY errors from HTTP/2 servers
    });

    // Wait for the response headers
    const response = await new Promise((resolve, reject) => {
      stream.on('response', (resp) => resolve(resp));
      stream.on('error', (err) => reject(err));
      // Timeout if no response in 15s
      setTimeout(() => reject(new Error('proxy response timeout')), 15000);
    });

    if (response.statusCode >= 400) {
      logger.error(`[${ADDON_NAME}] proxy upstream ${response.statusCode} for ${targetUrl.hostname}`);
      stream.destroy();
      // For workers.dev 403 (expired token) or text/html responses (redirect pages),
      // return a clean error so Stremio can try the next stream automatically.
      // Don't return 502 (looks like server error) — return the actual status.
      const ct = (response.headers['content-type'] || '').toLowerCase();
      if (response.statusCode === 403 || ct.includes('text/html') || ct.includes('text/plain')) {
        return res.status(response.statusCode).send(`Upstream error: ${response.statusCode}`);
      }
      return res.status(response.statusCode).send(`Upstream error: ${response.statusCode}`);
    }

    // Forward status code and headers
    res.status(response.statusCode);
    const forwardHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-disposition'];
    for (const h of forwardHeaders) {
      const v = response.headers[h];
      if (v) res.setHeader(h, v);
    }

    // Some upstreams serve MPEG-TS segments with Content-Type:
    // application/vnd.ms-excel — override to video/mp2t.
    // This must happen BEFORE the stream starts piping.
    const preCt = (response.headers['content-type'] || '').toLowerCase();
    const preSegPath = targetUrl.pathname.toLowerCase();
    if (preCt.includes("vnd.ms-excel")) {
      // Override Content-Type for .xls segments — don't pipe, send manually
      stream.destroy();
      try {
        const bufRes = await gotScraping.get(targetUrl.href, {
          headers: proxyHeaders,
          timeout: { request: 30000 },
          throwHttpErrors: false,
          followRedirect: true,
          http2: false,
          responseType: 'buffer',
        });
        if (!res.headersSent) {
          res.status(200);
          res.removeHeader('Content-Type');
          res.setHeader('Content-Type', 'video/mp2t');
          res.setHeader('Content-Length', bufRes.body.length);
          res.end(bufRes.body);
        }
        return;
      } catch (e) {
        if (!res.headersSent) res.status(502).send('Proxy error');
        return;
      }
    }
    // PlayIMDb segments return Content-Type: text/html — override to video/mp2t
    if (preCt.includes('text/html') && (preSegPath.includes('/content/') || preSegPath.endsWith('.html') || preSegPath.includes('page-'))) {
      stream.destroy();
      try {
        const bufRes = await gotScraping.get(targetUrl.href, {
          headers: proxyHeaders,
          timeout: { request: 30000 },
          throwHttpErrors: false,
          followRedirect: true,
          http2: false,
          responseType: 'buffer',
        });
        if (!res.headersSent) {
          res.status(200);
          res.removeHeader('Content-Type');
          res.setHeader('Content-Type', 'video/mp2t');
          res.setHeader('Content-Length', bufRes.body.length);
          res.end(bufRes.body);
        }
        return;
      } catch (e) {
        if (!res.headersSent) res.status(502).send('Proxy error');
        return;
      }
    }

    // AniPriv8 segments return Content-Type: image/png when Range is requested
    // (server bug). The body is valid MPEG-TS — override Content-Type so
    // Stremio's HLS player accepts it.
    if (urlIsAniPriv8) {
      const ct2 = (response.headers['content-type'] || '').toLowerCase();
      if (ct2.includes('image/png') || ct2.includes('application/octet-stream') || !ct2) {
        res.setHeader('Content-Type', 'video/mp2t');
      }
    }

    // PlayIMDb segments return Content-Type: text/html (server quirk).
    // The body is valid MPEG-TS data — override to video/mp2t so Stremio's
    // HLS player accepts it. Without this, Stremio shows "stuck on loading"
    // because it refuses to play text/html as video.
    // Also apply to any .html segment URLs from HLS playlists (PlayIMDb uses
    // page-N.html for segment names).
    const ct = (response.headers['content-type'] || '').toLowerCase();
    const segPath = targetUrl.pathname.toLowerCase();
    if (ct.includes('text/html') && (segPath.includes('/content/') || segPath.endsWith('.html') || segPath.includes('page-'))) {
      res.setHeader('Content-Type', 'video/mp2t');
    }
    if (ct.includes('vnd.ms-excel') || ct.includes('application/vnd.ms-excel')) {
      res.removeHeader('Content-Type');
      res.setHeader('Content-Type', 'video/mp2t');
    }

    // Stream the body — pipe directly to avoid buffering in memory
    stream.pipe(res);
    stream.on('error', () => { try { res.end(); } catch {} });
  } catch (err) {
    logger.error(`[${ADDON_NAME}] proxy error: ${err.message}`);
    if (!res.headersSent) res.status(502).send('Proxy error');
    else try { res.end(); } catch {}
  }
});

// ============================================================================
// /range-proxy — Range-translation proxy for CDNs that IGNORE Range headers
// (e.g. video-downloads.googleusercontent.com, lh3.googleusercontent.com).
//
// Google's video-downloads.googleusercontent.com returns HTTP 200 with the
// FULL file regardless of any Range header sent. This breaks video seeking
// in Stremio because the player needs 206 Partial Content + Content-Range
// to scrub to a specific timestamp.
//
// This endpoint:
//   1. Receives Stremio's Range header (e.g. bytes=5000000-10000000)
//   2. Fetches the FULL file from upstream as a stream (no Range sent upstream)
//   3. Uses a byte-counting Transform stream to:
//      - Drop bytes 0 to Range.start-1
//      - Pipe bytes Range.start to Range.end (or EOF) to Stremio
//   4. Returns 206 Partial Content + Content-Range + Accept-Ranges: bytes
//      + correct Content-Length so Stremio can seek properly.
//
// When no Range is sent, pipes the whole file with 200 + Accept-Ranges: bytes
// so Stremio knows it CAN seek on the next request.
//
// Performance note: seeking to a late position (e.g. byte 5GB of a 6GB file)
// requires downloading 5GB from upstream first. This is slow but WORKS —
// better than no seeking at all. Most playback starts from byte 0 (fast).
// ============================================================================
app.get('/range-proxy', async (req, res) => {
  // Task 54: same playback-priority marking as /proxy above.
  playbackGate.begin();
  res.on('close', () => playbackGate.end());
  const rawUrl = req.query.url;
  if (!rawUrl) {
    return res.status(400).send('Missing url parameter');
  }

  let targetUrl;
  try {
    targetUrl = new URL(rawUrl);
  } catch {
    return res.status(400).send('Invalid url parameter');
  }

  logger.log(`[${ADDON_NAME}] range-proxy ${targetUrl.hostname}${targetUrl.pathname.slice(0, 50)}`);

  try {
    const { gotScraping } = await import('got-scraping');
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

    // Step 1: HEAD request to get Content-Length + Content-Type
    // Google returns 200 + full Content-Length for HEAD (even with Range).
    let totalSize = 0;
    let contentType = 'application/octet-stream';
    let contentDisposition = null;
    try {
      const headRes = await gotScraping.head(targetUrl.href, {
        headers: { 'User-Agent': UA, 'Accept': '*/*' },
        timeout: { request: 10000 },
        throwHttpErrors: false,
        followRedirect: true,
        http2: true,
      });
      if (headRes.statusCode < 400) {
        totalSize = parseInt(headRes.headers['content-length'] || '0', 10);
        contentType = headRes.headers['content-type'] || contentType;
        contentDisposition = headRes.headers['content-disposition'];
      }
    } catch (e) {
      logger.error(`[${ADDON_NAME}] range-proxy HEAD failed: ${e.message}`);
    }

    if (!totalSize) {
      // Can't determine size — fall back to direct stream without Range
      // translation. Task 41: upstream errors must NOT masquerade as 200.
      // The old code piped the upstream body blind with res.status(200), so
      // an expired googleusercontent URL (403/502 at HEAD+GET time) shipped
      // its HTML error page as a "video" — players hung on loading or threw
      // "[mpv] unrecognized file format". Wait for the response event and
      // pass the real upstream status through (same contract as the main
      // byte-range path below).
      logger.log(`[${ADDON_NAME}] range-proxy: no Content-Length, streaming direct`);
      const stream = gotScraping.stream(targetUrl.href, {
        headers: { 'User-Agent': UA, 'Accept': '*/*' },
        timeout: { request: 60000 },
        throwHttpErrors: false,
        followRedirect: true,
        isStream: true,
        http2: false,
      });
      let upstreamStatus = null;
      try {
        upstreamStatus = await new Promise((resolve, reject) => {
          stream.on('response', (resp) => resolve(resp.statusCode));
          stream.on('error', (err) => reject(err));
          setTimeout(() => reject(new Error('range-proxy upstream timeout')), 15000);
        });
      } catch (e) {
        logger.error(`[${ADDON_NAME}] range-proxy direct stream failed: ${e.message}`);
        try { stream.destroy(); } catch {}
        return res.status(502).send('Upstream connection failed');
      }
      if (upstreamStatus >= 400) {
        logger.error(`[${ADDON_NAME}] range-proxy upstream ${upstreamStatus} (direct path)`);
        stream.destroy();
        return res.status(upstreamStatus).send(`Upstream error: ${upstreamStatus}`);
      }
      res.status(200);
      res.setHeader('Content-Type', contentType);
      if (contentDisposition) res.setHeader('Content-Disposition', contentDisposition);
      stream.pipe(res);
      stream.on('error', () => { try { res.end(); } catch {} });
      return;
    }

    // Step 2: Parse Range header from Stremio
    const rangeHeader = req.headers.range;
    let rangeStart = 0;
    let rangeEnd = totalSize - 1;
    let hasRange = false;

    if (rangeHeader) {
      const m = String(rangeHeader).match(/bytes=(\d*)-(\d*)/);
      if (m) {
        hasRange = true;
        if (m[1]) rangeStart = parseInt(m[1], 10);
        if (m[2]) rangeEnd = parseInt(m[2], 10);
        // If start is empty but end is set: suffix range (last N bytes)
        if (!m[1] && m[2]) {
          rangeStart = Math.max(0, totalSize - parseInt(m[2], 10));
          rangeEnd = totalSize - 1;
        }
        // Clamp to file bounds
        if (rangeStart >= totalSize) {
          res.status(416);
          res.setHeader('Content-Range', `bytes */${totalSize}`);
          return res.end();
        }
        if (rangeEnd >= totalSize) rangeEnd = totalSize - 1;
      }
    }

    const contentLength = rangeEnd - rangeStart + 1;

    // Step 3: Fetch the FULL file from upstream (no Range — Google ignores it anyway)
    const upstreamStream = gotScraping.stream(targetUrl.href, {
      headers: { 'User-Agent': UA, 'Accept': '*/*' },
      timeout: { request: 60000 },
      throwHttpErrors: false,
      followRedirect: true,
      isStream: true,
      http2: false,  // HTTP/1.1 for better streaming compatibility
    });

    // Wait for upstream response headers
    const upstreamResp = await new Promise((resolve, reject) => {
      upstreamStream.on('response', (resp) => resolve(resp));
      upstreamStream.on('error', (err) => reject(err));
      setTimeout(() => reject(new Error('range-proxy upstream timeout')), 15000);
    });

    if (upstreamResp.statusCode >= 400) {
      logger.error(`[${ADDON_NAME}] range-proxy upstream ${upstreamResp.statusCode}`);
      upstreamStream.destroy();
      return res.status(upstreamResp.statusCode).send(`Upstream error: ${upstreamResp.statusCode}`);
    }

    // Use the upstream Content-Type if our HEAD didn't get it
    if (upstreamResp.headers['content-type']) {
      contentType = upstreamResp.headers['content-type'];
    }

    // Step 4: Set response headers
    if (hasRange) {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${rangeStart}-${rangeEnd}/${totalSize}`);
    } else {
      res.status(200);
    }
    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', contentLength);
    if (contentDisposition) res.setHeader('Content-Disposition', contentDisposition);

    // Step 5: Byte-range translation using a Transform stream
    // - Skip bytes 0 to rangeStart-1
    // - Pipe bytes rangeStart to rangeEnd
    // - Stop after contentLength bytes piped
    let bytesSkipped = 0;
    let bytesPiped = 0;
    let aborted = false;

    const { Transform } = await import('stream');
    const rangeTransform = new Transform({
      transform(chunk, encoding, callback) {
        if (aborted) return callback();

        let offset = 0;
        let chunkLen = chunk.length;

        // Skip bytes before rangeStart
        if (bytesSkipped < rangeStart) {
          const need = rangeStart - bytesSkipped;
          if (chunkLen <= need) {
            // Entire chunk is before rangeStart — skip it all
            bytesSkipped += chunkLen;
            return callback();
          }
          // Skip the first 'need' bytes, process the rest
          offset = need;
          chunkLen -= need;
          bytesSkipped += need;
        }

        // Limit to contentLength
        const remaining = contentLength - bytesPiped;
        if (chunkLen > remaining) {
          chunkLen = remaining;
        }

        if (chunkLen <= 0) {
          return callback();
        }

        bytesPiped += chunkLen;
        this.push(chunk.slice(offset, offset + chunkLen));

        // If we've piped all requested bytes, end the stream
        if (bytesPiped >= contentLength) {
          aborted = true;
          this.push(null);
          try { upstreamStream.destroy(); } catch {}
        }

        callback();
      },
      flush(callback) {
        if (!aborted && bytesPiped < contentLength) {
          // Upstream ended before we got all requested bytes — that's OK,
          // just end the response.
        }
        callback();
      },
    });

    // Pipe: upstream → rangeTransform → response
    upstreamStream.pipe(rangeTransform).pipe(res);

    // Handle errors
    upstreamStream.on('error', (err) => {
      logger.error(`[${ADDON_NAME}] range-proxy upstream stream error: ${err.message}`);
      rangeTransform.destroy();
      try { res.end(); } catch {}
    });
    rangeTransform.on('error', (err) => {
      logger.error(`[${ADDON_NAME}] range-proxy transform error: ${err.message}`);
      try { res.end(); } catch {}
    });

    // Handle client disconnect
    req.on('close', () => {
      aborted = true;
      try { upstreamStream.destroy(); } catch {}
      try { rangeTransform.destroy(); } catch {}
    });
  } catch (err) {
    logger.error(`[${ADDON_NAME}] range-proxy error: ${err.message}`);
    if (!res.headersSent) res.status(502).send('Range proxy error');
    else try { res.end(); } catch {}
  }
});

// ============================================================================
// /reanime-proxy — XOR-decryption proxy for ReAnime/FlixCloud streams
// ============================================================================
// ReAnime (reanime.to) returns HLS streams from FlixCloud CDN that are
// XOR-encrypted:
//   - m3u8 playlists: base64-encoded + XOR with 32-byte key
//   - Segments: WebP/PNG fake headers + XOR with 16-byte key
//
// This proxy:
//   1. Fetches the m3u8 from flixcloud.cc (via curl for CF bypass)
//   2. Decrypts XOR-encrypted m3u8 content
//   3. Rewrites segment URLs to route through this proxy
//   4. Decrypts segment payloads (strips fake headers + XOR)
//
// URL formats:
//   /reanime-proxy/playlist.m3u8?url=<encoded>&key=<base64-32-byte-key>
//   /reanime-proxy/seg.ts?url=<encoded>
//   /reanime-proxy/raw?url=<encoded>&key=<base64>
// ============================================================================
app.get('/reanime-proxy/*', async (req, res) => {
  const rawUrl = req.query.url;
  const keyB64 = req.query.key;

  if (!rawUrl) {
    return res.status(400).send('Missing url parameter');
  }

  let targetUrl;
  try { targetUrl = new URL(rawUrl); }
  catch { return res.status(400).send('Invalid url parameter'); }

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const isHead = req.method === 'HEAD';
  logger.log(`[${ADDON_NAME}] reanime-proxy ${targetUrl.hostname}${targetUrl.pathname.slice(0, 50)}`);

  try {
    // Fetch upstream via curl (CF bypass for flixcloud.cc)
    const { execFileSync } = await import('child_process');
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    const curlArgs = [
      '-sL', '--max-time', '15',
      '-H', `User-Agent: ${UA}`,
      '-H', 'Referer: https://flixcloud.cc/',
      '-H', 'Origin: https://flixcloud.cc',
      '-H', 'Accept: */*',
      rawUrl,
    ];

    let body;
    try {
      body = execFileSync('curl', curlArgs, { maxBuffer: 50 * 1024 * 1024, timeout: 20000, encoding: 'buffer' });
    } catch (e) {
      return res.status(502).send(`Upstream fetch failed: ${e.message.slice(0, 80)}`);
    }

    if (!body || body.length === 0) {
      return res.status(502).send('Empty upstream response');
    }

    // 16-byte XOR key for segment decryption — central registry (shared with
    // nuvio/reanime.cjs; previously byte-identical duplicates in both files).
    const SEGMENT_XOR_KEY = reanimeSegmentKey();

    // 32-byte XOR key for m3u8 playlist decryption
    let xorKey = null;
    if (keyB64) {
      try {
        xorKey = Buffer.from(keyB64, 'base64');
        if (xorKey.length !== 32) xorKey = null;
      } catch { xorKey = null; }
    }

    const bodyStr = body.toString('utf8');
    let plaintext;
    let contentType;
    let isSegment = false;
    let isM3u8 = false;

    // Detect content type by inspecting body bytes
    if (body.length >= 12 && body[0] === 0x52 && body[1] === 0x49 && body[2] === 0x46 && body[3] === 0x46
        && body[8] === 0x57 && body[9] === 0x45 && body[10] === 0x42 && body[11] === 0x50) {
      // WebP disguised segment — strip 12-byte header, XOR with 16-byte key
      const payload = body.slice(12);
      plaintext = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i++) plaintext[i] = payload[i] ^ SEGMENT_XOR_KEY[i % 16];
      isSegment = true;
      contentType = 'video/mp2t';
    } else if (body.length >= 8 && body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4E && body[3] === 0x47
               && body[4] === 0x0D && body[5] === 0x0A && body[6] === 0x1A && body[7] === 0x0A) {
      // PNG disguised segment — strip 8-byte header, XOR with 16-byte key
      const payload = body.slice(8);
      plaintext = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i++) plaintext[i] = payload[i] ^ SEGMENT_XOR_KEY[i % 16];
      isSegment = true;
      contentType = 'video/mp2t';
    } else if (bodyStr.startsWith('#EXTM3U')) {
      // Plain m3u8 (already decoded)
      plaintext = body;
      isM3u8 = true;
      contentType = 'application/vnd.apple.mpegurl';
    } else if (xorKey) {
      // Encrypted m3u8 playlist (base64 + XOR with 32-byte key)
      try {
        const decoded = Buffer.from(bodyStr, 'base64');
        plaintext = Buffer.alloc(decoded.length);
        for (let i = 0; i < decoded.length; i++) plaintext[i] = decoded[i] ^ xorKey[i % xorKey.length];
        if (plaintext.toString('utf8').startsWith('#EXTM3U')) {
          isM3u8 = true;
          contentType = 'application/vnd.apple.mpegurl';
        } else {
          plaintext = body;
          contentType = 'application/octet-stream';
        }
      } catch {
        plaintext = body;
        contentType = 'application/octet-stream';
      }
    } else {
      plaintext = body;
      contentType = 'application/octet-stream';
    }

    // HEAD request — return headers only
    if (isHead) {
      res.status(200);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', plaintext.length);
      res.setHeader('Cache-Control', isSegment ? 'public, max-age=86400' : 'no-store');
      return res.end();
    }

    // Segments — stream decrypted MPEG-TS directly
    if (isSegment) {
      res.status(200);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', plaintext.length);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Accept-Ranges', 'bytes');
      return res.end(plaintext);
    }

    // m3u8 playlists — rewrite URLs to route through this proxy
    let rewritten = plaintext.toString('utf8');
    if (isM3u8) {
      const baseUrl = targetUrl;
      const basePath = baseUrl.pathname.replace(/\/[^/]*$/, '/');
      const baseOrigin = `${baseUrl.protocol}//${baseUrl.host}`;
      // Task 41: req.protocol is 'http' on Render (TLS terminates at the edge
      // proxy and app.set('trust proxy') is intentionally not enabled), which
      // produced http:// children that Render 301-redirects to https — an
      // extra round trip per segment and a cross-protocol redirect hop that
      // some HLS readers fail to follow ("stuck on loading"). Honor
      // X-Forwarded-Proto when present; falls back to req.protocol locally.
      const reanimeProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || req.protocol;
      const proxyBase = `${reanimeProto}://${req.get('host')}/reanime-proxy`;

      const toAbsolute = (line) => {
        if (line.startsWith('http://') || line.startsWith('https://')) return line;
        if (line.startsWith('//')) return baseUrl.protocol + line;
        if (line.startsWith('/')) return baseOrigin + line;
        if (line.startsWith('../')) {
          let p = basePath;
          let rest = line;
          while (rest.startsWith('../')) { p = p.replace(/[^/]*\/$/, ''); rest = rest.substring(3); }
          return baseOrigin + p + rest;
        }
        return baseOrigin + basePath + line;
      };

      const toProxy = (absUrl) => {
        if (absUrl.includes('flixcloud.cc') || absUrl.includes('atomic4cdn.top')) {
          if (absUrl.endsWith('.webp') || absUrl.endsWith('.png')) {
            return `${proxyBase}/seg.ts?url=${encodeURIComponent(absUrl)}&e=.ts`;
          }
          if (absUrl.endsWith('.m3u8')) {
            return `${proxyBase}/playlist.m3u8?url=${encodeURIComponent(absUrl)}&key=${encodeURIComponent(keyB64 || '')}`;
          }
          return `${proxyBase}/raw?url=${encodeURIComponent(absUrl)}&key=${encodeURIComponent(keyB64 || '')}`;
        }
        return absUrl;
      };

      // Rewrite URI="..." attributes
      rewritten = rewritten.replace(/(URI=")([^"]+)(")/g, (m, prefix, url, suffix) =>
        prefix + toProxy(toAbsolute(url)) + suffix);

      // Rewrite standalone URL lines
      rewritten = rewritten.replace(/(^[^#\n].*$)/gm, (line) => {
        if (!line.trim() || line.startsWith('#')) return line;
        return toProxy(toAbsolute(line.trim()));
      });

      // Remove AES-128 KEY directives (segments are XOR-encrypted, not AES)
      rewritten = rewritten.replace(/^#EXT-X-KEY:METHOD=AES-128.*$/gm, '');
    }

    res.status(200);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Accept-Ranges', 'bytes');
    res.end(rewritten);
  } catch (err) {
    logger.error(`[${ADDON_NAME}] reanime-proxy error: ${err.message}`);
    if (!res.headersSent) res.status(502).send('ReAnime proxy error');
    else try { res.end(); } catch {}
  }
});

// Rewrite relative URLs in an m3u8 playlist to absolute /proxy URLs.
// This ensures the player fetches variant playlists and segments through
// the proxy with the correct Referer — without it, relative URLs resolve
// against the proxy URL itself and return 404.
function rewriteM3u8Urls(m3u8Text, baseUrl, referer, req, extraParams) {
  const lines = m3u8Text.split('\n');
  // Task 41: emit https:// children on TLS-terminating hosts (Render).
  // req.protocol is 'http' behind Render's edge proxy, so every rewritten
  // variant/segment URL was http:// and Render 301-redirected each one to
  // https — doubling round trips per segment and breaking HLS readers that
  // don't follow cross-protocol redirects inside a playlist tree (manifests
  // as "stuck on loading"). X-Forwarded-Proto is always set by Render;
  // absent locally → req.protocol fallback keeps dev behavior byte-identical.
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proxyProto = forwardedProto || req.protocol;
  const proxyBase = `${proxyProto}://${req.get('host')}/proxy`;

  // Optional decrypt-mode params (xor/strip/ct) propagated onto every
  // rewritten /proxy URL so variant playlists and segments decrypt too
  // (used by the opt-in ?xor= branch below; undefined for the normal path —
  // existing callers pass 4 args and are unaffected).
  const withExtra = (proxyUrl) => {
    if (extraParams) {
      for (const [k, v] of Object.entries(extraParams)) {
        if (v !== undefined && v !== null && v !== '') proxyUrl.searchParams.set(k, String(v));
      }
    }
    return proxyUrl;
  };

  return lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      // Rewrite URI= inside #EXT-X-STREAM-INF, #EXT-X-I-FRAME-STREAM-INF,
      // #EXT-X-MAP, and #EXT-X-MEDIA tags (all use URI="..." for variant/
      // segment/audio/subtitle references)
      if (trimmed.startsWith('#EXT-X-STREAM-INF') ||
          trimmed.startsWith('#EXT-X-I-FRAME-STREAM-INF') ||
          trimmed.startsWith('#EXT-X-MAP') ||
          trimmed.startsWith('#EXT-X-MEDIA')) {
        return line.replace(/URI="([^"]+)"/g, (match, uri) => {
          const absoluteUrl = new URL(uri, baseUrl).href;
          const proxyUrl = new URL(proxyBase);
          proxyUrl.searchParams.set('url', absoluteUrl);
          if (referer) proxyUrl.searchParams.set('referer', referer);
          return `URI="${withExtra(proxyUrl).href}"`;
        });
      }
      return line;
    }
    // This line is a URL (variant playlist or segment)
    const absoluteUrl = new URL(trimmed, baseUrl).href;
    const proxyUrl = new URL(proxyBase);
    proxyUrl.searchParams.set('url', absoluteUrl);
    if (referer) proxyUrl.searchParams.set('referer', referer);
    return withExtra(proxyUrl).href;
  }).join('\n');
}

// ============== HEALTH ==============
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    name: ADDON_NAME,
    version: VERSION,
    uptime: process.uptime(),
    sources: sources.map(s => s.id),
    extractors: extractors.map(e => e.id),
  });
});

// ============== DEBUG (diagnostic — safe, read-only) ==============
// Returns which proxy env vars are SET (boolean only — never exposes values).
app.get('/debug/env', (req, res) => {
  res.json({
    version: 'task59-fix4-cold-chain-calibration',
    startedAt: new Date(globalThis.__phoenixBootAt || Date.now()).toISOString(),
    ALL_PROXY: !!process.env.ALL_PROXY,
    HTTPS_PROXY: !!process.env.HTTPS_PROXY,
    HTTP_PROXY: !!process.env.HTTP_PROXY,
    TMDB_API_KEY: !!process.env.TMDB_API_KEY,
    FLARESOLVERR_ENDPOINT: !!process.env.FLARESOLVERR_ENDPOINT,
    NODE_ENV: process.env.NODE_ENV || 'development',
  });
});

// Task 49: universal-subtitle diagnostic — runs the SHARED subtitle module
// exactly as the resolver does and returns what it produces for a title.
// Isolates scraper failure (granite/natsuki unreachable from this instance)
// from integration failure (resolver not attaching). Additive; diagnostic only.
// Usage: /debug/subs?type=series&id=tmdb:1396:1:1
app.get('/debug/subs', async (req, res) => {
  try {
    const rawId = req.query.id || 'tmdb:1396';
    const type = req.query.type || 'series';
    const m = rawId.match(/(\d+)(?::(\d+))?(?::(\d+))?/);
    const tmdbId = m ? Number(m[1]) : 1396;
    const season = m && m[2] ? Number(m[2]) : undefined;
    const episode = m && m[3] ? Number(m[3]) : undefined;
    const t0 = Date.now();
    const subs = await Promise.race([
      fetchUnifiedSubs({ tmdbId, type, season, episode, hostUrl: new URL(`https://${req.headers.host}`), fetcher, ctx: { hostUrl: new URL(`https://${req.headers.host}`) } }),
      new Promise(r => setTimeout(() => r(null), 20000)),
    ]);
    const dt = Date.now() - t0;
    res.json({
      tmdbId, type, season, episode,
      durationMs: dt,
      timedOut: subs === null,
      count: Array.isArray(subs) ? subs.length : 0,
      byProvider: {
        granite: Array.isArray(subs) ? subs.filter(s => String(s.id).startsWith('gr-')).length : 0,
        natsuki: Array.isArray(subs) ? subs.filter(s => String(s.id).startsWith('nk-')).length : 0,
      },
      sample: Array.isArray(subs) ? subs.slice(0, 6).map(s => ({ lang: s.lang, url: String(s.url).slice(0, 90) })) : [],
    });
  } catch (e) {
    res.json({ error: e?.message || String(e) });
  }
});

// Runs a full /stream resolution and returns per-source timing data.
// This is the SAME code path as /stream/:type/:id.json, so it captures
// real-world behavior including concurrency, timeouts, and caching.
// Usage: /debug/stream?type=movie&id=tmdb:155
app.get('/debug/stream', async (req, res) => {
  const type = req.query.type || 'movie';
  const rawId = req.query.id || 'tmdb:155';

  let parsedId;
  try {
    if (rawId.startsWith('tmdb:')) {
      parsedId = TmdbId.fromString(rawId.replace('tmdb:', ''));
    } else if (rawId.startsWith('tt')) {
      parsedId = ImdbId.fromString(rawId);
    } else {
      return res.status(400).json({ error: `Unsupported ID: ${rawId}` });
    }
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const ctx = {
    hostUrl: new URL(`https://${req.headers.host}`),
    id: req.headers['x-request-id'] || '',
    ip: req.ip,
    config: { multi: 'on', en: 'on' },
  };

  const t0 = Date.now();
  try {
    let streams;
    ({ streams } = await streamResolver.resolve(ctx, sources, type, parsedId));
    const totalMs = Date.now() - t0;

    // Get per-source timing data (stashed by _resolveInternal)
    const timings = streamResolver._lastSourceTimings || [];

    // Sort by duration descending (slowest first)
    const sortedTimings = [...timings].sort((a, b) => b.durationMs - a.durationMs);

    return res.json({
      type,
      id: rawId,
      totalMs,
      totalStreams: streams.length,
      sourceCount: sources.length,
      // Client-budget telemetry — partial=true means the response was cut at
      // STREAM_CLIENT_BUDGET_MS with sources still resolving in background
      // (their results cache for the next request).
      partial: streamResolver._lastResolveWasPartial === true,
      clientBudgetMs: parseInt(process.env.STREAM_CLIENT_BUDGET_MS, 10) || 13000,
      // Per-source timing (slowest first)
      sources: sortedTimings.map(t => ({
        id: t.id,
        status: t.status,
        count: t.count,
        durationMs: t.durationMs,
        queueMs: t.queueMs,
      })),
      // Streams from Cinejoy + ZinkMovies specifically
      cinejoyStreams: streams
        .filter(s => /cinejoy/i.test(s.name || ''))
        .map(s => ({ name: s.name, title: (s.title || '').slice(0, 100) })),
      zinkStreams: streams
        .filter(s => /zink/i.test(s.name || ''))
        .map(s => ({ name: s.name, title: (s.title || '').slice(0, 100) })),
    });
  } catch (err) {
    return res.json({
      error: err.message,
      totalMs: Date.now() - t0,
    });
  }
});

// Tests a single source by id and returns its raw output + timing + errors.
// Usage: /debug/source/:sourceId?type=movie&id=tmdb:1081003
app.get('/debug/source/:sourceId', async (req, res) => {
  const { sourceId } = req.params;
  const type = req.query.type || 'movie';
  const rawId = req.query.id || 'tmdb:1081003';

  const source = sources.find(s => s.id === sourceId);
  if (!source) {
    return res.status(404).json({ error: `Source '${sourceId}' not found. Available: ${sources.map(s => s.id).join(', ')}` });
  }

  let parsedId;
  try {
    if (rawId.startsWith('tmdb:')) {
      parsedId = TmdbId.fromString(rawId.replace('tmdb:', ''));
    } else if (rawId.startsWith('tt')) {
      parsedId = ImdbId.fromString(rawId);
    } else {
      return res.status(400).json({ error: `Unsupported ID: ${rawId}` });
    }
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const ctx = {
    hostUrl: new URL(`https://${req.headers.host}`),
    id: req.headers['x-request-id'] || '',
    ip: req.ip,
    config: { multi: 'on', en: 'on' },
  };

  // Task 38: capture the scraper's console output so zero-stream sources can
  // be diagnosed from production telemetry without Render log access.
  const capturedLogs = [];
  const origLog = console.log, origError = console.error, origWarn = console.warn;
  console.log = (...a) => { const s = a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); if (capturedLogs.length < 60) capturedLogs.push(s.slice(0, 220)); origLog(...a); };
  console.error = (...a) => { const s = a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); if (capturedLogs.length < 60) capturedLogs.push('[err] ' + s.slice(0, 220)); origError(...a); };
  console.warn = (...a) => { const s = a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); if (capturedLogs.length < 60) capturedLogs.push('[warn] ' + s.slice(0, 220)); origWarn(...a); };
  const restoreConsole = () => { console.log = origLog; console.error = origError; console.warn = origWarn; };

  const t0 = Date.now();
  try {
    // Call handleInternal directly to bypass the cache
    const results = await Promise.race([
      source.handleInternal(ctx, type, parsedId),
      new Promise(r => setTimeout(() => r({ __timeout: true }), 35000)),
    ]);
    const dt = Date.now() - t0;
    restoreConsole();
    if (results?.__timeout) {
      return res.json({ source: sourceId, type, id: rawId, timedOut: true, durationMs: dt, logs: capturedLogs });
    }
    // full=1 → untruncated stream URLs (up to 3). Diagnostic use only: the
    // default 150-char slice keeps responses small for humans, but it makes
    // magic-byte playability checks impossible for long direct URLs.
    const wantFull = req.query.full === '1';
    const sliceLen = wantFull ? 3 : 5;
    return res.json({
      source: sourceId,
      type,
      id: rawId,
      durationMs: dt,
      logs: capturedLogs,
      count: Array.isArray(results) ? results.length : 0,
      results: Array.isArray(results) ? results.slice(0, sliceLen).map(r => ({
        url: wantFull ? r.url?.href : r.url?.href?.slice(0, 150),
        format: r.format,
        // Task 57: expose requestHeaders + notWebReady so external playability
        // probes can replicate the player's fetch (behaviorHints.proxyHeaders
        // comes from urlResult.requestHeaders on direct cards). Diagnostic only.
        requestHeaders: r.requestHeaders || null,
        notWebReady: r.notWebReady,
        meta: { ...r.meta, title: r.meta?.title?.slice(0, 120) },
      })) : [],
    });
  } catch (e) {
    const dt = Date.now() - t0;
    restoreConsole();
    return res.json({
      source: sourceId,
      type,
      id: rawId,
      durationMs: dt,
      logs: capturedLogs,
      error: e?.message || String(e),
      stack: e?.stack?.split('\n').slice(0, 5),
    });
  }
});

// Raw native-fetch probe from THIS server — diagnoses egress-IP/TLS blocks.
// Task 38: stellarrip/stellar/uhdmovies/bollyflix resolve 0 in production while
// identical code + got-scraping /proxy probes succeed; this endpoint isolates
// the native undici fetch path each scraper actually uses.
// Usage: /debug/rawfetch?url=https://stellar.rip/en/watch/embed/movie/27205
app.get('/debug/rawfetch', async (req, res) => {
  const rawUrl = req.query.url;
  if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) {
    return res.status(400).json({ error: 'query param url required (http/https)' });
  }
  const t0 = Date.now();
  try {
    const r = await fetch(rawUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', 'Accept': 'text/html,*/*' },
      signal: AbortSignal.timeout(12000),
      redirect: 'follow',
    });
    const text = await r.text();
    return res.json({
      url: rawUrl,
      ok: r.ok,
      status: r.status,
      finalUrl: r.url,
      durationMs: Date.now() - t0,
      bytes: text.length,
      head: text.slice(0, 300),
    });
  } catch (e) {
    return res.json({
      url: rawUrl,
      error: e?.message || String(e),
      cause: e?.cause?.message || e?.cause?.code || undefined,
      durationMs: Date.now() - t0,
    });
  }
});


// ============== LANDING PAGE ==============
app.get('/', (req, res) => {
  const hostUrl = `https://${req.headers.host}`;
  const manifestUrl = `${hostUrl}/manifest.json`;
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PhoeniX</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>
  body {
    margin: 0;
    min-height: 100vh;
    background: linear-gradient(135deg, #0a0a0f 0%, #1a0a1a 30%, #0f0a15 50%, #1a0a0f 70%, #0a0a0f 100%);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .phoenix-bg {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 80vmin;
    height: 80vmin;
    opacity: 0.06;
    background-image: url('${hostUrl}/public/logo.png');
    background-size: contain;
    background-position: center;
    background-repeat: no-repeat;
    filter: drop-shadow(0 0 60px rgba(255, 100, 0, 0.3));
    animation: glow 4s ease-in-out infinite alternate;
  }
  @keyframes glow {
    from { opacity: 0.04; filter: drop-shadow(0 0 40px rgba(255, 80, 0, 0.2)); }
    to { opacity: 0.08; filter: drop-shadow(0 0 80px rgba(255, 120, 0, 0.4)); }
  }
  .ember {
    position: fixed;
    bottom: -10px;
    width: 4px;
    height: 4px;
    background: rgba(255, 140, 0, 0.6);
    border-radius: 50%;
    animation: rise 3s linear infinite;
    pointer-events: none;
  }
  @keyframes rise {
    to { transform: translateY(-100vh) translateX(20px); opacity: 0; }
  }
</style>
</head>
<body>
<div class="phoenix-bg"></div>
<div id="embers"></div>
<div class="relative z-10 flex flex-col items-center px-6 w-full max-w-md">
  <img src="${hostUrl}/public/logo.png" alt="PhoeniX" class="w-20 h-20 mb-3 drop-shadow-[0_0_25px_rgba(255,100,0,0.5)]">
  <h1 class="text-5xl font-black text-white tracking-tight mb-1">PhoeniX</h1>
  <p class="text-sm text-orange-400/70 font-medium mb-8 tracking-wider uppercase">Stream movies, series & anime in HD</p>
  <div class="w-full rounded-3xl border border-white/10 p-6" style="background: rgba(15,15,20,0.6); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);">
    <a href="stremio://${hostUrl.replace('https://','')}/manifest.json" class="flex items-center justify-center w-full py-3.5 rounded-2xl text-white font-bold text-lg transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]" style="background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%); box-shadow: 0 8px 30px rgba(124,58,237,0.4);">
      <svg class="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20"><path d="M10 0C4.477 0 0 4.477 0 10c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.866-.014-1.699-2.782.602-3.369-1.34-3.369-1.34-.455-1.155-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.071 1.531 1.03 1.531 1.03.892 1.529 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.57 9.57 0 0110 4.836a9.59 9.59 0 012.504.336c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.579.688.481A10.001 10.001 0 0020 10c0-5.523-4.477-10-10-10z"/></svg>
      Install in Stremio
    </a>
    <button onclick="navigator.clipboard.writeText('${manifestUrl}').then(()=>{this.innerText='Copied!';setTimeout(()=>this.innerText='Copy Manifest URL',2000)})" class="mt-3 flex items-center justify-center w-full py-3 rounded-2xl text-gray-300 font-medium text-sm transition-all duration-300 hover:text-white hover:bg-white/5 border border-white/10">
      <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"/></svg>
      Copy Manifest URL
    </button>
  </div>
</div>
<script>
  // Ember particles
  const embers = document.getElementById('embers');
  for(let i=0;i<15;i++){
    const e=document.createElement('div');
    e.className='ember';
    e.style.left=Math.random()*100+'vw';
    e.style.animationDuration=(2+Math.random()*3)+'s';
    e.style.animationDelay=Math.random()*3+'s';
    e.style.width=e.style.height=(2+Math.random()*4)+'px';
    embers.appendChild(e);
  }
</script>
</body>
</html>`);
});

// ============== START ==============
app.listen(PORT, HOST, () => {
  logger.log(`[${ADDON_NAME}] listening on http://${HOST}:${PORT}`);
  logger.log(`[${ADDON_NAME}] manifest: http://${HOST}:${PORT}/manifest.json`);
  logger.log(`[${ADDON_NAME}] Sources: ${sources.length} (${sources.map(s => s.id).join(', ')})`);
  logger.log(`[${ADDON_NAME}] Extractors: ${extractors.length} (${extractors.map(e => e.id).join(', ')})`);
  // Task 54: boot-time warmup REMOVED (user request, standing): the original
  // PhoeniX repo has no pre-warm. On the 0.1-CPU free tier the 50+ origin TLS
  // handshakes raced exactly the requests that follow a scale-from-zero boot
  // (first /stream + playback) and contributed to the degraded-instance class.
  // The Task 45 idle-time prewarm loop was already removed earlier.
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
