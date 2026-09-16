// src/utils/streamGate.cjs
// ─── Server-side liveness verdicts for flaky direct-card hosts ──────────────
//
// WHY (Task 42 sweep evidence — every final card on Inception / BreakingBad
// S1E1 / Frieren S1E1 probed with magic-byte + playlist-tree checks):
//   1. pixeldrain.com|dev /api/file/<id> hosts ANY file type. Status-only
//      liveness checks (Task 39/41 headOk / pdAliveCached) pass 200/206 ZIP
//      season-packs (sweep caught "Movies4u.Foo.Frieren...S01E01-14...zip",
//      4.97GB, application/zip, filename says 1080p!) → shipped as "streams"
//      → player error / stuck loading. 8 such dead cards measured on
//      BreakingBad S1E1 alone.
//   2. vimeos.(zip|net) HLS fronts (speedracelight Omen/lamovie servers and
//      framextv providers) flipped to unconditional 403 text/html for
//      datacenter ranges (Task 40 verified 200-#EXTM3U no-referer from the
//      same sandbox; 2026-09-17 sweep: 403 text/html with/without Referer,
//      with/without browser header set, fresh tokens included) → the card
//      IS an HTML error page — the exact "html url" class the user reports.
//   3. fetch.nexabloom.top (itachi/anikoto/anidoor/animeflix/raflix/
//      nikastream/anikototv/streamxtv anime cards): Cloudflare 403 HTML,
//      referer-immune (verified with itachi.su / animekoto / strem referers),
//      cf-ray present. 15+ dead anime cards in one sweep.
//   4. nhdapi.com/anime/<id>/<ep> (raflix): returns 200 text/html — an API
//      HTML PAGE shipped as a stream URL. Never a media stream.
//   5. moon|sun.peakstorm.top + playeng.animeapps.top + scraper.vidbolt.xyz
//      (the vidking/speedracelight family behind cinewave/videasy/cineby/
//      videasyto/vidsrcsbs/watchseries/vidking/streamxtv/anibd): these trees
//      DIE TRANSIENTLY — 2026-09-16 sweep caught peakstorm r2/cdn1 trees
//      with dead children across 10 sources simultaneously (same backend
//      shared); 2026-09-17 vidbolt master+variant 200 but SEGMENTS return
//      text/html. Trees recover later (peakstorm verified alive again next
//      day), so verdicts must SELF-HEAL, not ban permanently.
//
// HOW (zero budget impact — Task 36 architecture untouched):
//   Probes NEVER block resolution. StreamResolver fires a non-blocking
//   kick() per gated URL as each source settles; the card-build loop
//   consults the verdict cache synchronously:
//       alive   → ship
//       dead    → drop card (no html-url / zip-url / dead-tree cards ship)
//       unknown → ship (status quo — probe pending/inconclusive/network flake)
//   Deep HLS probe follows the playlist tree (master → child → grandchild)
//   exactly as the player would, so "alive master + dead children" trees
//   are caught. Verdicts self-heal via short TTLs.
//   /proxy-wrapped cards are gated on their INNER hostname (the upstream
//   we proxy), but probed at the CARD URL — exactly what the player fetches.
//
// DUAL IMPORT (same pattern as site-secrets.cjs): CJS require + ESM default
// interop both work.

'use strict';

// Verdict cache: positive entries live longer than negative ones (a dead
// file can be re-uploaded under the same ID far less often than a flaky
// host recovers).
const VERDICT_TTL_ALIVE_MS = 10 * 60 * 1000;
const VERDICT_TTL_DEAD_MS = 5 * 60 * 1000;
const PROBE_TIMEOUT_MS = 4000;
const MAX_HLS_FETCHES = 3;      // master + up to 2 playlist levels
const MAX_CONCURRENT = 6;       // probe chains in flight (fire-and-forget CPU guard)

// Gated host families (regex on the effective hostname — INNER host for
// /proxy-wrapped cards):
//   pixeldrain.com|dev  — any-file-type host (zips ship as "streams")
//   vimeos.zip|net      — inverted-referer HLS, now unconditional 403 html
//   peakstorm.top       — vidking/speedracelight family (moon/sun/… rotate)
//   animeapps.top       — anibd/nikastream playeng trees
//   vidbolt.xyz         — vidking family m3u8 proxy (segments went html)
//   nexabloom.top       — CF 403-html anime CDN (itachi/anikoto/…)
//   nhdapi.com          — HTML page shipped as stream URL (raflix)
const GATED_HOST_RE = /(^|\.)pixeldrain\.(com|dev)$|(^|\.)vimeos\.(zip|net)$|(^|\.)peakstorm\.top$|(^|\.)animeapps\.top$|(^|\.)vidbolt\.xyz$|(^|\.)nexabloom\.top$|(^|\.)nhdapi\.com$|(^|\.)urbansolardiyprojectshub\.site$/i;
const VIDEO_EXT_RE = /\.(mkv|mp4|webm|avi|ts|m2ts|mov|flv|wmv|mpg|mpeg|m4v)(?:[?#]|$)/i;
const ARCHIVE_EXT_RE = /\.(zip|rar|7z|tar|gz|001)(?:[?#]|$)/i;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const verdicts = new Map(); // url -> { state: 'alive'|'dead', at }
const inFlight = new Map(); // url -> promise
const hostLocks = new Map(); // inner host -> promise chain (serialize probes per upstream)
// Host-level circuit breaker: when a host racks up consecutive dead verdicts
// (nexabloom: EVERY url 403-html; vidbolt: whole trees dead), stop re-probing
// every new per-URL token — verdict 'dead' instantly. Self-heals after the
// window; a single alive verdict resets the counter.
const circuits = new Map(); // host -> { deaths, lastAt, openUntil }
const CIRCUIT_DEATHS = 3;
const CIRCUIT_WINDOW_MS = 10 * 60 * 1000;
const CIRCUIT_OPEN_MS = 5 * 60 * 1000;
let activeProbes = 0;
const waiters = [];

// Effective hostname for gating: /proxy and /range-proxy cards act on their
// INNER url (the upstream we proxy); everything else is its own host.
function gateHostOf(href) {
  try {
    const u = new URL(href);
    if (u.pathname === '/proxy' || u.pathname === '/range-proxy') {
      const inner = u.searchParams.get('url');
      if (inner) return new URL(inner).hostname;
    }
    return u.hostname;
  } catch (e) {
    return '';
  }
}

function isGatedHost(hostname) {
  return GATED_HOST_RE.test(hostname || '');
}

// Concurrency gate so a burst of gated cards cannot stampede upstream/CPU.
async function acquire() {
  if (activeProbes < MAX_CONCURRENT) { activeProbes++; return; }
  await new Promise(resolve => waiters.push(resolve));
  activeProbes++;
}
function release() {
  activeProbes--;
  const w = waiters.shift();
  if (w) w();
}

async function fetchWithTimeout(url, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, redirect: 'follow' });
  } finally {
    clearTimeout(t);
  }
}

// Pixeldrain file verdict. HEAD is enough (headers carry every signal);
// falls back to a 2KB ranged GET when HEAD is rejected outright.
//   dead file  → 404 (+ application/json)
//   non-video  → 200/206 + Content-Disposition filename.zip/.rar
//   video      → 200/206 + ct video/x-matroska|video/mp4 (or octet-stream)
//                + Content-Disposition filename.mkv/.mp4
async function probePixeldrain(url) {
  let res;
  try {
    res = await fetchWithTimeout(url, { method: 'HEAD', headers: { 'user-agent': UA } });
  } catch (e) {
    try {
      res = await fetchWithTimeout(url, { headers: { 'user-agent': UA, 'range': 'bytes=0-2047' } });
      try { await res.body.cancel(); } catch (_) { /* already consumed or errored */ }
    } catch (e2) {
      return 'unknown'; // network flake — never drop on inconclusive
    }
  }
  if (res.status === 404 || res.status === 410) return 'dead';
  if (res.status === 403) return 'unknown'; // datacenter-gated → residential may pass
  if (res.status < 200 || res.status >= 400) return 'unknown';

  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const cd = (res.headers.get('content-disposition') || '').toLowerCase();
  const fnMatch = cd.match(/filename\*?=(?:utf-8'')?([^;\s]+)/);
  const filename = fnMatch ? decodeURIComponent(fnMatch[1].replace(/^"|"$/g, '')) : '';

  if (ct.includes('application/json')) return 'dead';
  if (ct.includes('text/html')) return 'dead';
  if (filename && ARCHIVE_EXT_RE.test(filename)) return 'dead';
  if (/\bzip\b|\brar\b|x-7z|x-tar|gzip/.test(ct)) return 'dead';
  if (filename && VIDEO_EXT_RE.test(filename)) return 'alive';
  if (ct.startsWith('video/') || ct.includes('x-matroska')) return 'alive';
  if (ct.includes('octet-stream') && !filename) return 'unknown'; // can't tell — ship
  if (ct.includes('octet-stream') && filename && !ARCHIVE_EXT_RE.test(filename)) return 'alive';
  return 'unknown';
}

// Body-truth media sniff: mirrors in the vidking/peakstorm family lie about
// Content-Type (200 text/html + real MPEG-TS body, 206 image/jpeg + TS body —
// both verified live Task 42). The BODY decides, the header never does.
function isMediaBody(body) {
  const s = body.slice(0, 2048);
  if (s.length === 0) return false;
  if (s.indexOf('\u0000') !== -1) return true;                                 // NUL byte → binary (TS/MKV/MP4)
  if (s.charCodeAt(0) === 0x47 && s.length > 188 && s.charCodeAt(188) === 0x47) return true; // TS sync doublet
  if (s.slice(4, 8) === 'ftyp') return true;                                   // MP4
  if (s.charCodeAt(0) === 0x1a && s.charCodeAt(1) === 0x45 && s.charCodeAt(2) === 0xdf && s.charCodeAt(3) === 0xa3) return true; // MKV EBML
  return false;
}

// One fetch level of an HLS tree, exactly as the player requests it.
//   'dead'  → definitive: 403/410/404 status, or an HTML body (the "html url" class)
//   'm3u8'  → valid playlist, body + first child line returned
//   'media' → binary/video response (segment or direct file)
//   'unknown' → inconclusive (network flake, 5xx, weird body)
async function fetchHlsLevel(url) {
  let res;
  let body = '';
  try {
    res = await fetchWithTimeout(url, { headers: { 'user-agent': UA } });
    body = (await res.text()).slice(0, 16384); // playlists are KB-sized
  } catch (e) {
    return { state: 'unknown' };
  }
  const status = res.status;
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (status === 403 || status === 410 || status === 404) return { state: 'dead', status, ct };
  if (status < 200 || status >= 400) return { state: 'unknown', status, ct };
  const head = body.trimStart().slice(0, 64).toLowerCase();
  // BODY TRUTH first: binary data with a lying text/html ct is MEDIA
  // (quickstorm.top verified shipping exactly that); an html body with a
  // media ct is still an html page. Playlist markers override ct too.
  if (head.startsWith('#extm3u') || head.startsWith('#ext-x')) {
    const child = body.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))[0];
    if (!child) return { state: 'dead', status, ct, note: 'empty-playlist' };
    let childUrl;
    try { childUrl = new URL(child, res.url || url).href; } catch (e) { return { state: 'unknown', status, ct }; }
    return { state: 'm3u8', childUrl, status, ct };
  }
  if (head.startsWith('<!doctype') || head.startsWith('<html') || (head.includes('<html') && !isMediaBody(body))) {
    return { state: 'dead', status, ct };
  }
  if (isMediaBody(body)) return { state: 'media', status, ct };
  if (ct.includes('text/html')) return { state: 'dead', status, ct }; // html-ish body without literal <html head
  if (ct.includes('application/json')) return { state: 'dead', status, ct };
  if (ct.includes('mpegurl') || ct.includes('vnd.apple')) return { state: 'unknown', status, ct }; // ct says playlist, body unclear (truncated fetch)
  return { state: 'unknown', status, ct };
}

// Gated HLS host verdict (vimeos.*, peakstorm.*, animeapps.*, vidbolt.xyz,
// nexabloom.top, nhdapi.com): walk the tree as the player would, up to 3
// fetches. Catches alive-master-with-dead-children and html-segment trees.
//   alive → every probed level is a valid playlist ending in real media
//   dead  → any level 403/410/404/html/empty (definitive dead signals only)
async function probeHls(url) {
  let current = url;
  for (let i = 0; i < MAX_HLS_FETCHES; i++) {
    const lvl = await fetchHlsLevel(current);
    if (lvl.state === 'dead') return 'dead';
    if (lvl.state === 'unknown') return 'unknown';
    if (lvl.state === 'media') return 'alive';
    // m3u8 → follow first child (next loop iteration)
    current = lvl.childUrl;
  }
  return 'alive'; // 3 playlist levels deep and every level valid — real tree
}

async function probe(url) {
  const host = gateHostOf(url);
  // Circuit open → host is conclusively dead recently; skip the fetch queue.
  const circ = circuits.get(host);
  if (circ && circ.openUntil > Date.now()) return 'dead';
  if (activeProbes >= MAX_CONCURRENT) return 'unknown'; // busy — never queue-drop cards on latency
  await acquire();
  try {
    if (/^pixeldrain\.(com|dev)$/i.test(host)) return await record(host, await probePixeldrain(url));
    // Serialize per upstream host: concurrent same-host probes can trip
    // upstream rate-limiters (403 bursts) → false dead verdicts. Chained
    // locks keep at most ONE probe chain in flight per gated host.
    const prev = hostLocks.get(host) || Promise.resolve();
    let releaseLock;
    const myToken = new Promise(r => { releaseLock = r; });
    hostLocks.set(host, prev.then(() => myToken));
    await prev.catch(() => {});
    try {
      return await record(host, await probeHls(url));
    } finally {
      releaseLock();
    }
  } catch (e) {
    return 'unknown';
  } finally {
    release();
  }
}

// Feed the host circuit breaker: dead → deaths++, ≥3 in window → open;
// alive → reset.
function record(host, state) {
  if (state === 'unknown') return state;
  const now = Date.now();
  const circ = circuits.get(host) || { deaths: 0, lastAt: 0, openUntil: 0 };
  if (state === 'dead') {
    circ.deaths = (now - circ.lastAt < CIRCUIT_WINDOW_MS) ? circ.deaths + 1 : 1;
    circ.lastAt = now;
    if (circ.deaths >= CIRCUIT_DEATHS) circ.openUntil = now + CIRCUIT_OPEN_MS;
  } else {
    circ.deaths = 0;
    circ.openUntil = 0;
  }
  if (circuits.size > 512) circuits.clear();
  circuits.set(host, circ);
  return state;
}
// Fire-and-forget probe. Safe to call repeatedly: fresh verdicts short-
// circuit, concurrent probes for the same URL coalesce.
function kick(url) {
  const hit = verdicts.get(url);
  if (hit) {
    const ttl = hit.state === 'alive' ? VERDICT_TTL_ALIVE_MS : VERDICT_TTL_DEAD_MS;
    if (Date.now() - hit.at < ttl) return;
    verdicts.delete(url);
  }
  if (inFlight.has(url)) return;
  const p = probe(url)
    .then(state => {
      inFlight.delete(url);
      if (state === 'unknown') return; // no verdict — leave uncached, retry next kick
      if (verdicts.size > 2048) verdicts.clear();
      verdicts.set(url, { state, at: Date.now() });
    })
    .catch(() => { inFlight.delete(url); });
  inFlight.set(url, p);
}

// Sync consult for the card-build loop: 'alive' | 'dead' | 'unknown'
function verdict(url) {
  const v = verdicts.get(url);
  if (!v) return 'unknown';
  const ttl = v.state === 'alive' ? VERDICT_TTL_ALIVE_MS : VERDICT_TTL_DEAD_MS;
  if (Date.now() - v.at >= ttl) return 'unknown';
  return v.state;
}

// Awaitable boolean for scrapers that pick between mirror candidates:
// true only when the pixeldrain file is a definitively playable VIDEO.
function pdVideoOk(pixeldrainUrl) {
  return probe(pixeldrainUrl).then(s => s === 'alive');
}

module.exports = { isGatedHost, gateHostOf, kick, verdict, probe, pdVideoOk };
