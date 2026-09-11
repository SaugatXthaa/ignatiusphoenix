// src/utils/cf-fetch.cjs — Cloudflare bypass via curl subprocess (guide §4.1)
//
// Why curl: Cloudflare JA3 TLS fingerprinting blocks Node.js's handshake with
// 403. curl's TLS fingerprint looks like a real browser and passes. The repo
// already uses got-scraping (Chrome TLS) everywhere — this module is the
// ESCAPE HATCH for hosts that still 403 got-scraping, and for sources being
// onboarded before their got-scraping headers are dialed in (the proven
// pattern is /reanime-proxy in src/index.js, now reusable).
//
// Usage (both ESM and CJS consumers):
//   import { fetchWithCurl, SHORT_UA } from '../utils/cf-fetch.cjs';   // ESM
//   const { fetchWithCurl, SHORT_UA } = require('../utils/cf-fetch.cjs'); // CJS
//
// Decision order when a site 403s (guide §4.4):
//   1. got-scraping (default — fast, pooled)      → try first
//   2. fetchWithCurl (this module)                → JA3-level blocks
//   3. SHORT_UA                                   → UA-based bot detection
//   4. Referer header matching the player domain  → CDN hotlink protection
//   5. No luck? The site runs a full CF challenge — find a CF-free API
//      subdomain instead (guide §4.4).

'use strict';

const { execFileSync } = require('child_process');

// §4.2 — the FULL Chrome UA string is rejected as a bot by some CF sites;
// the truncated one passes. Use SHORT_UA for curl fetches unless the site
// provably needs the full string.
const SHORT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

/**
 * Build a curl argv for a GET (or HEAD) request. Exported for tests and for
 * callers that need to stream via spawn instead of buffering.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {object} [opts.headers]   extra headers, e.g. { Referer: 'https://player.x/' }
 * @param {number} [opts.maxTimeSec] curl --max-time (transfer cap), default 30
 * @param {boolean} [opts.head]     HEAD request
 * @param {string} [opts.userAgent] default SHORT_UA
 * @param {string} [opts.outFile]   write body to file instead of stdout
 * @returns {string[]} argv
 */
function curlArgsFor(url, opts = {}) {
  const { headers = {}, maxTimeSec = 30, head = false, userAgent = SHORT_UA, outFile } = opts;
  const args = ['-sL', '--max-time', String(maxTimeSec), '--compressed', '-H', `User-Agent: ${userAgent}`];
  for (const [k, v] of Object.entries(headers)) {
    if (String(k).toLowerCase() === 'user-agent') continue;
    args.push('-H', `${k}: ${v}`);
  }
  if (head) args.push('-I');
  if (outFile) args.push('-o', outFile);
  args.push(url);
  return args;
}

/**
 * Fetch a URL through curl and return the raw body Buffer.
 * Throws with a short message on non-zero exit or empty body.
 *
 * @param {string} url
 * @param {object} [opts] curlArgsFor options plus:
 * @param {number} [opts.maxBufferMB] stdout cap (default 50 MB — segment-sized)
 * @param {number} [opts.timeoutMs]   hard kill timer (default maxTimeSec*1000 + 15s)
 * @returns {Promise<Buffer>}
 */
async function fetchWithCurl(url, opts = {}) {
  const { maxBufferMB = 50, timeoutMs, ...argOpts } = opts;
  const maxTimeSec = argOpts.maxTimeSec || 30;
  return new Promise((resolve, reject) => {
    let body;
    try {
      body = execFileSync('curl', curlArgsFor(url, argOpts), {
        encoding: 'buffer',
        maxBuffer: maxBufferMB * 1024 * 1024,
        timeout: timeoutMs || maxTimeSec * 1000 + 15000,
      });
    } catch (e) {
      return reject(new Error(`curl failed: ${(e.message || String(e)).slice(0, 120)}`));
    }
    if (!body || body.length === 0) return reject(new Error('curl returned empty body'));
    resolve(body);
  });
}

module.exports = { SHORT_UA, curlArgsFor, fetchWithCurl };
