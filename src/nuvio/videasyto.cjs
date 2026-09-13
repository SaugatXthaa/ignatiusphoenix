// videasyto.cjs — videasy.to Direct Stream Extractor (NO Playwright)
// =========================================================================
// Returns DIRECT PLAYABLE HLS/MP4 streams from videasy.to via the
// speedracelight.com API (9 provider backends).
//
// This scraper reuses the existing videasy.cjs obfuscated scraper's
// decryption logic (which already handles the speedracelight API's custom
// stream cipher in pure Node.js — no browser needed).
//
// The difference from 'videasy' source:
//   - videasy: uses player.videasy.net, 10 servers (Hydrogen, Titanium, etc.)
//   - videasyto: uses player.videasy.to, 9 providers (Yoru, Cypher, etc.)
//
// Both call the same api.speedracelight.com backend and return the same
// direct playable URLs from moon.peakstorm.top / sun.peakstorm.top.
//
// USAGE
//   node videasyto.cjs <tmdbId> <movie|tv> [season] [episode]
//   node videasyto.cjs 693134 movie          # Dune: Part Two
//   node videasyto.cjs 1396 tv 1 1           # Breaking Bad S01E01

'use strict';

// Reuse the existing videasy.cjs scraper — it already has the decryption
// logic for the speedracelight API. We just wrap it with a different name
// and ensure subtitles are passed through.
const videasyScraper = require('./videasy.cjs');

const PROVIDER_NAME = 'Videasy';

// The speedracelight backend fails stochastically per sweep: each of the 10
// provider servers 404/500s independently per run (live-verified: Endgame
// sweeps landed "Nitrogen only", "Hydrogen only" and "4 streams from
// Hydrogen" on three consecutive runs), and the /seed fetch is single-shot.
// One empty sweep therefore does NOT mean the title has no streams — retry
// after a short pause so a transient bad window doesn't zero both videasy
// source cards at once. Bounded: empty sweeps fail fast (upstream 404/500s
// return in ~2-4s), so worst-case wall time stays well under the resolver's
// 35s per-source cutoff.
const EMPTY_RETRY_MAX = 2;      // total attempts = 1 + 2 retries
const EMPTY_RETRY_DELAY_MS = 2000;

// ─── Per-request deadline for speedracelight API calls ───
// Verified live (2026-09): individual provider servers can hang 2+ minutes on
// certain titles (raw Endgame sweep: 127s wall even though Hydrogen had
// returned 4 streams early). The scraper awaits ALL servers before returning,
// so one hung request stalls the whole sweep past the resolver deadline even
// though fast servers already produced streams. Per-server errors are caught
// upstream (404/500s are handled per-server), so aborting a hung request just
// turns it into another caught per-server failure and lets the sweep finish.
const SPEEDRACELIGHT_RE = /speedracelight\.com/i;
const SL_REQUEST_TIMEOUT_MS = 12000;
if (!globalThis.__speedracelightTimeoutShim) {
  globalThis.__speedracelightTimeoutShim = true;
  const __origFetch = globalThis.fetch;
  globalThis.fetch = async function speedracelightBoundedFetch(input, init) {
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || String(input);
      if (SPEEDRACELIGHT_RE.test(url)) {
        init = { ...(init || {}) };
        const t = AbortSignal.timeout(SL_REQUEST_TIMEOUT_MS);
        init.signal = (typeof AbortSignal.any === 'function' && init.signal)
          ? AbortSignal.any([init.signal, t])
          : t;
      }
    } catch (e) { /* never break the call */ }
    return __origFetch.call(this, input, init);
  };
}

async function getStreams(tmdbId, type, season, episode) {
  // Delegate to the existing videasy scraper — it handles:
  //   1. TMDB info fetch
  //   2. Seed retrieval from api.speedracelight.com/seed
  //   3. Querying 10 speedracelight servers in parallel
  //   4. Decrypting responses (custom stream cipher)
  //   5. Returning streams with subtitles
  let streams = await videasyScraper.getStreams(tmdbId, type, season, episode);

  for (let attempt = 0; Array.isArray(streams) && streams.length === 0 && attempt < EMPTY_RETRY_MAX; attempt++) {
    await new Promise(r => setTimeout(r, EMPTY_RETRY_DELAY_MS));
    streams = await videasyScraper.getStreams(tmdbId, type, season, episode);
  }

  if (!Array.isArray(streams)) return [];

  // Enrich streams with provider name and ensure subtitles are passed through
  return streams.map(s => ({
    ...s,
    name: s.name || `${PROVIDER_NAME} | ${s._is4k ? '4K' : (s.quality || '1080p')} | ${s._serverName || 'Server'}`,
    // Ensure subtitles are in the format buildStreamResults expects
    subtitles: Array.isArray(s.subtitles) && s.subtitles.length > 0
      ? s.subtitles.map(sub => {
          // Handle various subtitle formats from the scraper
          if (typeof sub === 'string') {
            return { id: 'en', url: sub, lang: 'en', label: 'English' };
          }
          return {
            id: sub.id || sub.lang || sub.srclang || sub.language || 'en',
            url: sub.url || sub.file || sub.src || '',
            lang: sub.lang || sub.language || sub.srclang || sub.label || 'en',
            label: sub.label || sub.lang || sub.language || 'English',
          };
        }).filter(sub => sub.url)
      : undefined,
  }));
}

async function getTMDBInfo(tmdbId, type) {
  return videasyScraper.getTMDBInfo(tmdbId, type);
}

module.exports = { getStreams, getTMDBInfo, PROVIDER_NAME };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('Videasy.to Direct Stream Extractor (NO Playwright)');
    console.log('  Movies + TV — direct playable HLS/MP4 via Speedracelight API');
    console.log('');
    console.log('Usage: node videasyto.cjs <tmdbId> <movie|tv> [season] [episode]');
    console.log('Examples:');
    console.log('  node videasyto.cjs 693134 movie        # Dune: Part Two');
    console.log('  node videasyto.cjs 1396 tv 1 1        # Breaking Bad S01E01');
    process.exit(1);
  }
  getStreams(args[0], args[1], args[2], args[3])
    .then(s => {
      console.log('\n=== Final playable streams ===');
      if (s.length === 0) { console.log('No streams found.'); return; }
      s.forEach((x, i) => {
        console.log(`${i+1}. ${x.name}`);
        console.log(`   URL: ${x.url?.slice(0, 180)}${(x.url?.length || 0) > 180 ? '...' : ''}`);
        console.log(`   Quality: ${x.quality || (x._is4k ? '4K' : 'Unknown')}`);
        console.log(`   Subtitles: ${x.subtitles?.length || 0}`);
      });
      console.log(`\nTotal: ${s.length}`);
    })
    .catch(e => { console.error('FATAL: ' + e.stack); process.exit(1); });
}
