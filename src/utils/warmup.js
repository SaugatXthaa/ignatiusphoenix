// src/utils/warmup.js
//
// Boot-time warmup — additive, fire-and-forget, guarded; never affects request
// handling or response shapes.
//
// WHY: on a cold instance (fresh deploy / free-tier scale-from-zero / process
// restart), the FIRST /stream request pays every one-time cost at once:
//   - lazy `import('got-scraping')` (multi-MB CJS graph) inside several sources
//   - DNS + TLS handshakes to 50+ upstream hosts
//   - domains.json fetch used by Source.probeBaseUrl
// Sources that don't finish inside the resolver's queue+global deadline are
// dropped from the response, so users see "most sources returning no streams"
// on the first title after a deploy. Warming these costs up front (while the
// user hasn't asked for anything yet) removes that first-request penalty.
//
// Zero-breakage notes:
//   - Runs entirely in the background after listen(); never blocks boot.
//   - Only performs requests the addon would perform anyway on its first real
//     usage (origin roots + domains.json), with short timeouts and low
//     concurrency so free-tier CPU is unaffected.
//   - No caches are polluted: origin-root GETs only warm OS DNS/TLS; a 403/404
//     is equally effective for that purpose.
//   - Any failure is logged at most once and swallowed.

const WARM_CONCURRENCY = 5;
const WARM_TIMEOUT_MS = 6_000;

export function startWarmup({ sources = [], logger } = {}) {
  const log = logger?.log?.bind(logger) || (() => {});
  // Run detached so boot never waits on us; rethrow-guard everything.
  (async () => {
    const t0 = Date.now();
    // Phase 1: pre-import got-scraping (used as CF fallback by Fetcher and
    // lazily imported by several sources). Largest single cold-start cost.
    try {
      await import('got-scraping');
      log(`[warmup] got-scraping preloaded`);
    } catch (e) {
      log(`[warmup] got-scraping preload failed: ${e?.message || e}`);
    }

    // Phase 2: warm domains.json (same URL Source.probeBaseUrl uses).
    try {
      await withTimeout(fetch('https://raw.githubusercontent.com/Anshu78780/json/main/providers.json', {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      }).then(r => r.arrayBuffer()), WARM_TIMEOUT_MS);
      log(`[warmup] domains.json preloaded`);
    } catch { /* best-effort */ }

    // Phase 3: DNS+TLS warm to every distinct source origin (origin root only).
    const origins = new Set();
    for (const s of sources) {
      try { if (s.baseUrl) origins.add(new URL(s.baseUrl).origin); } catch { /* skip */ }
    }
    let ok = 0;
    let i = 0;
    const list = [...origins];
    await Promise.all(Array.from({ length: Math.min(WARM_CONCURRENCY, list.length) }, async () => {
      while (i < list.length) {
        const origin = list[i++];
        try {
          await withTimeout(fetch(origin, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              'Accept': 'text/html',
            },
            redirect: 'follow',
          }).then(r => { r.body?.cancel?.().catch(() => {}); return r; }), WARM_TIMEOUT_MS);
          ok++;
        } catch { /* best-effort */ }
      }
    }));
    log(`[warmup] ${ok}/${list.length} source origins warmed in ${Date.now() - t0}ms`);
  })().catch(() => {});
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('warmup timeout')), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
