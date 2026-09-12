// src/extractor/SuperVideo.js
// Ported from research/webstreamr-mbg/src/extractor/SuperVideo.ts

import bytes from 'bytes';
import * as cheerio from 'cheerio';
import { NotFoundError } from '../error/index.js';
import { Format } from '../types.js';
import { extractUrlFromPacked, guessHeightFromPlaylist } from '../utils/index.js';
import { Extractor } from './Extractor.js';

export class SuperVideo extends Extractor {
  constructor(fetcher, logger) {
    super(fetcher, logger);
    this.id = 'supervideo';
    this.label = 'SuperVideo';
    this.ttl = 10800000; // 3h
  }

  supports(_ctx, url) {
    return null !== url.host.match(/supervideo/);
  }

  normalize(url) {
    return new URL(url.href.replace('/e/', '/').replace('/k/', '/').replace('/embed-', '/'));
  }

  async extractInternal(ctx, url, meta) {
    const headers = { Referer: meta.referer ?? url.href };

    const html = await this.fetcher.text(ctx, url, { headers });

    if (html.includes('This video can be watched as embed only')) {
      return await this.extractInternal(ctx, new URL(`/e${url.pathname}`, url.origin), meta);
    }

    if (/The file was deleted|The file expired|Video is processing/.test(html)) {
      throw new NotFoundError();
    }

    const playlistUrl = extractUrlFromPacked(html, [/sources:\[{file:"(.*?)"/]);
    const playlistHeaders = { Referer: 'https://supervideo.cc/' };

    // Liveness gate: the supervideo HLS edge (hfs*.serversicuro.cc)
    // stochastically serves an HTML "Loading..." JS-gate page INSTEAD of the
    // playlist — even for freshly-resolved token URLs (observed 2026-09-12 on
    // VerHdLink mirrors: extractor saw m3u8, the very next fetch got HTML).
    // Shipping the gated URL is a guaranteed "[mpv] unrecognized file format"
    // playback error. Verify the playlist actually resolves; drop otherwise.
    try {
      const probe = await fetch(playlistUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          ...playlistHeaders,
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
      });
      const head = (await probe.text()).slice(0, 400);
      if (!head.includes('#EXTM3U')) {
        console.log(`[supervideo] playlist gated/dead (HTTP ${probe.status}, ${probe.headers.get('content-type')}) — dropping: ${new URL(playlistUrl).host}`);
        throw new NotFoundError();
      }
    } catch (e) {
      if (e instanceof NotFoundError) throw e;
      // Probe itself failed (network/timeout) — keep the stream (best-effort;
      // don't drop streams merely because our probe couldn't complete)
    }

    const heightAndSizeMatch = html.match(/\d{3,}x(\d{3,}), ([\d.]+ ?[GM]B)/);
    const size = heightAndSizeMatch ? bytes.parse(heightAndSizeMatch[2]) : undefined;
    const height = heightAndSizeMatch
      ? parseInt(heightAndSizeMatch[1])
      : meta.height ?? await guessHeightFromPlaylist(ctx, this.fetcher, playlistUrl, { headers: playlistHeaders });

    const $ = cheerio.load(html);
    const title = $('.download__title').text().trim();

    return [
      {
        url: playlistUrl,
        format: Format.hls,
        meta: {
          ...meta,
          title,
          ...(size && { bytes: size }),
          ...(height && { height }),
        },
        requestHeaders: playlistHeaders,
      },
    ];
  }
}
