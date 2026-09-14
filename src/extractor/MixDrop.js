// src/extractor/MixDrop.js
// MixDrop (mixdrop.ag/.ch/.to/… — delivery on *.mxcontent.net) — direct MP4.
//
// Embed flow (mapped live 2026-09-14 via VerHdLink mirrors):
//   1. GET https://mixdrop.{tld}/e/<id> → page ships an eval(p,a,c,k,e,d)
//      packed player whose token table decodes to MDCore.* vars
//   2. MDCore.wurl = "//<vserver>.mxcontent.net/v2/<id>.mp4?s=<token>&e=<ts>"
//      → direct MP4 (hotlink token + expiry in the query string)
//   3. mxcontent.net is IP-gated: datacenter ranges get 403 regardless of
//      Referer (verified live). Ship with NO Referer so NuvioExtractor /
//      players treat it as a plain direct MP4 — residential IPs pass.

import { NotFoundError } from '../error/index.js';
import { Format } from '../types.js';
import { extractUrlFromPacked } from '../utils/index.js';
import { Extractor } from './Extractor.js';

export class MixDrop extends Extractor {
  constructor(fetcher, logger) {
    super(fetcher, logger);
    this.id = 'mixdrop';
    this.label = 'MixDrop';
    this.ttl = 1800000; // 30min — hotlink tokens rotate faster than filehosts
  }

  supports(_ctx, url) {
    return null !== url.host.match(/mixdrop/);
  }

  async extractInternal(ctx, url, meta) {
    const html = await this.fetcher.text(ctx, url, { headers: { Referer: url.href } });

    if (/File (was deleted|Not Found)|video is processing/i.test(html)) {
      throw new NotFoundError();
    }

    // MDCore.wurl may appear pre-unpacked OR inside the packed eval —
    // extractUrlFromPacked handles the packed path; try the raw path first.
    let direct;
    const raw = html.match(/MDCore\.wurl\s*=\s*["']([^"']+)["']/);
    if (raw?.[1]) {
      direct = raw[1].startsWith('//') ? `https:${raw[1]}` : raw[1];
    } else {
      const packedUrl = extractUrlFromPacked(html, [/MDCore\.wurl="([^"]+)"/]);
      direct = packedUrl.href;
    }

    this.logger.debug?.(`[mixdrop] resolved ${url.host} → ${new URL(direct).host}`);
    return [{
      url: new URL(direct),
      format: Format.mp4,
      // NO Referer on purpose — see header comment. MP4 ships direct.
      // Spread the incoming meta so sourceId/vidking survive into the card
      // (bingeGroup attribution + VidKing fallback need them).
      meta: {
        ...meta,
        title: 'MixDrop',
        provider: 'MixDrop',
      },
    }];
  }
}
