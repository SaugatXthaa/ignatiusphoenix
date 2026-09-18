// src/nuvio/cineby.cjs — Cineby provider (Task 40 full clean rewrite)
//
// Reverse engineering trail (verified 2026-09-16):
//   https://cineby.by/                → Laravel Livewire catalog (TMDB-driven),
//                                       player pages iframe vidking.net:
//                                       movie  → www.vidking.net/embed/movie/<tmdbId>
//                                       series → www.vidking.net/embed/tv/<tmdbId>/<s>/<e>
//   vidking.net embed SPA             → assets/VideoPlayer-D5eTfQPp.js calls
//                                       api.speedracelight.com:
//     1) GET /seed?mediaId=<tmdbId>                      → { seed }
//     2) GET /<provider>/sources-with-title?title=&mediaType=&year=&episodeId=
//        &seasonId=&tmdbId=&imdbId=&enc=2&seed=&_t=      → encrypted body
//     Decryption = base64url decode + XOR keystream keyed by (seed, tmdbId),
//     magic prefix "mvm1" — the exact cipher ported in src/utils/speedracelight.js
//     (decryptPayload imported from there — single shared implementation).
//
// Provider registry below is VERBATIM from the current vidking bundle's server
// tabs (the "servers" the site offers). Live status verified from this server:
//   Yoru (cdn)      → OK, 480p/720p/1080p/2160p + inline VTT subs  ← 4K source
//   Breach (m4uhd)  → OK, "Auto HLS" master playlist
//   Vyse (hdmovie)  → OK, exact quality "English" (language server)
//   Fade (hdmovie)  → OK, exact quality "Hindi"   (language server)
//   Killjoy (meine) → intermittent 500 (language=german) — still attempted
//   Omen (lamovie)  → intermittent 500/timeout    — still attempted
//   Raze (superflix)→ intermittent 500            — still attempted
//   DROPPED: Cypher (downloader2) + Neon (vsrc) — permanent HTTP 404 (3 probes)
//
// Seed handling: the API rotates seeds per /seed request — parallel seed fetches
// invalidate each other and every concurrent call then fails decryption
// ("bad seed or tampered payload", reproduced in Task 40 probing). All provider
// calls for one mediaId therefore share ONE cached seed; on 401/decrypt-failure
// the seed is invalidated, refetched, and the failing provider retried once.
//
// Metadata: everything on the cards comes from the API/bundle — quality labels
// ("2160p", "1080p", "Auto HLS", language servers' exact "English"/"Hindi"),
// server names (the bundle's own registry), and inline subtitle tracks. Nothing
// is guessed or hardcoded. HLS size is intentionally NOT estimated (the old
// obfuscated build sampled segments for a fake byte count — too costly on the
// Render CPU and not real metadata).
//
// Anime note: vidking/speedracelight serves anime episodes from the same
// servers (verified Frieren S1E1 + One Piece S1E1 with 2160p). There are no
// separate dub servers in the current bundle — multi-language audio appears
// only via the language servers (Vyse/Fade/Killjoy). Inline subs are attached
// whenever the API returns them. Nothing fabricated.

'use strict';

const SPEEDRACELIGHT_API_BASE = 'https://api.speedracelight.com';
const TMDB_API_KEY = process.env.TMDB_API_KEY || '439c478a771f35c05022f9feabcca01c';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Shared seed store (Task 40) — the API rotates seeds per /seed request, so
// parallel fetches for the same mediaId (VidKing extractor / VidEasy / cineby
// all in resolver wave-1) invalidate each other → 401/decrypt-fail storms.
// srlSeed.cjs coalesces them into ONE upstream fetch and caches for 25s.
const srlSeed = require('../utils/srlSeed.cjs');

// vidking.net origin/referer — the API 403s without them, and the peakstorm
// CDN hotlink-gate is INVERTED for this family: it serves the files WITH a
// vidking.net referer (the old cineby.at referer got 403s — see Task 31 notes
// in src/source/Cineby.js history).
const HEADERS = {
  'User-Agent': UA,
  'Origin': 'https://www.vidking.net',
  'Referer': 'https://www.vidking.net/',
};

// Server registry — names + endpoints + per-server params, verbatim from the
// current vidking VideoPlayer bundle (window server tabs), deduplicated by
// endpoint. The bundle defines Vyse (hdmovie, exact quality "English") and
// Fade (hdmovie, exact quality "Hindi") as two separate tabs hitting the SAME
// endpoint twice; we fetch hdmovie once and split locally with the bundle's
// exact-match semantics (see HDMOVIE_ENDPOINT below).
const PROVIDERS = [
  { name: 'Yoru',    endpoint: 'cdn/sources-with-title' },
  { name: 'Breach',  endpoint: 'm4uhd/sources-with-title' },
  { name: 'hdmovie', endpoint: 'hdmovie/sources-with-title' },
  { name: 'Killjoy', endpoint: 'meine/sources-with-title',  params: { language: 'german' } },
  { name: 'Omen',    endpoint: 'lamovie/sources-with-title' },
  { name: 'Raze',    endpoint: 'superflix/sources-with-title' },
];
const HDMOVIE_ENDPOINT = 'hdmovie/sources-with-title';

// The playhq subtitle proxy answers 400 "Error 1001" server-side (verified
// Task 40) — attaching its URLs would ship dead subtitles. Skip that host.
const DEAD_SUB_HOSTS = /api\.playhq\.net/i;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchSeed(tmdbId) {
  const key = String(tmdbId);
  const cached = srlSeed.getCached(key);
  if (cached) return cached;
  const existing = srlSeed.getInFlight(key);
  if (existing) return existing;

  const p = (async () => {
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${SPEEDRACELIGHT_API_BASE}/seed?mediaId=${encodeURIComponent(key)}`, {
          headers: HEADERS,
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 429) {
          const ra = parseInt(res.headers.get('retry-after') || '', 10);
          await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 10) * 1000 : 2000);
          lastErr = new Error('seed HTTP 429');
          continue;
        }
        if (!res.ok) throw new Error(`seed HTTP ${res.status}`);
        const json = await res.json();
        if (!json || !json.seed) throw new Error('seed response missing seed field');
        srlSeed.storeSeed(key, json.seed);
        return json.seed;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('seed fetch failed');
  })();

  const tracked = p.finally(() => srlSeed.clearInFlight(key));
  srlSeed.setInFlight(key, tracked);
  return tracked;
}

function invalidateSeed(tmdbId) {
  srlSeed.invalidateSeed(String(tmdbId));
}

// TMDB fallback — only used when the wrapper did not preload title/year/imdbId.
async function getTmdbMeta(tmdbId, mediaType) {
  const type = mediaType === 'tv' ? 'tv' : 'movie';
  const url = `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const j = await res.json();
    const name = type === 'tv' ? j.name : j.title;
    const date = type === 'tv' ? j.first_air_date : j.release_date;
    return {
      title: name || '',
      year: date ? String(date).slice(0, 4) : '',
      imdbId: (j.external_ids && j.external_ids.imdb_id) || '',
    };
  } catch {
    return null;
  }
}

// One provider fetch + decrypt. Returns the parsed JSON.
// Throws an error with .status === 401 when the seed was rejected/stale so the
// caller can invalidate + refetch + retry once.
async function fetchProviderJson(seed, provider, meta) {
  const u = new URL(`/${provider.endpoint}`, SPEEDRACELIGHT_API_BASE);
  u.searchParams.set('title', meta.title);
  u.searchParams.set('mediaType', meta.type);
  u.searchParams.set('year', meta.year || '');
  u.searchParams.set('episodeId', String(meta.episodeId || 1));
  u.searchParams.set('seasonId', String(meta.seasonId || 1));
  u.searchParams.set('tmdbId', String(meta.tmdbId));
  u.searchParams.set('imdbId', meta.imdbId || '');
  u.searchParams.set('enc', '2');
  u.searchParams.set('seed', seed);
  u.searchParams.set('_t', String(Date.now()));
  if (provider.params) {
    for (const [k, v] of Object.entries(provider.params)) u.searchParams.append(k, v);
  }

  const res = await fetch(u, {
    headers: { ...HEADERS, 'Cache-Control': 'no-cache, no-store, must-revalidate', Pragma: 'no-cache' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    const err = new Error(`provider HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const body = await res.text();

  const { decryptPayload } = await import('../utils/speedracelight.js');
  let json;
  try {
    json = JSON.parse(decryptPayload(body, seed, parseInt(meta.tmdbId, 10)));
  } catch {
    // Seed stale/rotated — synthetic 401 so the caller retries with a fresh seed
    const err = new Error('decrypt failed: bad seed or tampered payload');
    err.status = 401;
    throw err;
  }
  if (!json || !Array.isArray(json.sources)) return null;
  return json;
}

function qualityRank(q) {
  if (!q) return 0;
  if (/4k|2160/i.test(q)) return 2160;
  const m = String(q).match(/(\d{3,4})/);
  return m ? parseInt(m[1], 10) : 0;
}

function mapSubtitles(json) {
  const subs = Array.isArray(json.subtitles) ? json.subtitles : [];
  const out = [];
  for (const s of subs) {
    if (!s || !s.url || DEAD_SUB_HOSTS.test(String(s.url))) continue;
    const lang = s.lang || s.language || 'en';
    out.push({ id: String(lang).slice(0, 8), url: String(s.url), lang: String(lang) });
  }
  return out;
}

// Run one provider (with one 401-retry), returning
// { endpoint, serverName, sources: [{url, quality}], subtitles, master } or null.
// t0 = getStreams start — the 401 retry round is skipped when the elapsed time
// already makes it unable to finish inside the wrapper's 30s race (production
// TV run Task 40: round-1 hangs + 401 rotation + full round-2 = 30s+ → 0).
async function runProvider(meta, provider, t0) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let seed;
    try {
      seed = await fetchSeed(meta.tmdbId);
    } catch {
      return null; // seed endpoint down — nothing this source can do
    }
    try {
      const json = await fetchProviderJson(seed, provider, meta);
      if (!json) return null;
      return {
        endpoint: provider.endpoint,
        serverName: provider.name,
        sources: json.sources.filter(s => s && s.url),
        subtitles: mapSubtitles(json),
        master: typeof json.playlist === 'string' && json.playlist ? json.playlist : null,
      };
    } catch (e) {
      if (e?.status === 401 && attempt === 0 && (Date.now() - t0) < 12_000) {
        invalidateSeed(meta.tmdbId);
        continue; // fresh seed, retry once
      }
      return null; // 404/5xx/timeout — server down or content absent
    }
  }
  return null;
}

async function getStreams(tmdbId, mediaType, season, episode, preloaded) {
  const t0 = Date.now();
  try {
    const type = mediaType === 'tv' ? 'tv' : 'movie';
    const meta = {
      type,
      tmdbId: parseInt(tmdbId, 10),
      seasonId: type === 'tv' ? (season || 1) : 1,
      episodeId: type === 'tv' ? (episode || 1) : 1,
      title: preloaded?.title || '',
      year: preloaded?.year || '',
      imdbId: preloaded?.imdbId || '',
    };
    if (!meta.tmdbId) return [];
    if (!meta.title || !meta.imdbId) {
      const fallback = await getTmdbMeta(meta.tmdbId, type);
      if (fallback) {
        if (!meta.title) meta.title = fallback.title;
        if (!meta.year) meta.year = fallback.year;
        if (!meta.imdbId) meta.imdbId = fallback.imdbId;
      }
    }
    if (!meta.title) return [];

    // One run per unique endpoint — hdmovie is fetched ONCE and shared.
    const runs = await Promise.all(PROVIDERS.map(p => runProvider(meta, p, t0)));

    const streams = [];
    const seen = new Set();

    const push = (source, serverName, subtitles, masterUrl) => {
      if (!source || !source.url) return;
      const url = String(source.url);
      if (!/^https?:\/\//.test(url) || seen.has(url)) return;
      seen.add(url);
      const rawQuality = String(source.quality || '').trim();
      const label = rawQuality || 'Auto';
      streams.push({
        url,
        quality: label,
        title: masterUrl ? `Auto (all variants) · ${serverName}` : `${label} · ${serverName}`,
        name: 'Cineby',
        headers: HEADERS,
        subtitles: subtitles || [],
      });
    };

    for (const r of runs) {
      if (!r) continue;
      if (r.endpoint === HDMOVIE_ENDPOINT) {
        // Bundle's Vyse/Fade tabs = the same hdmovie endpoint with exact-match
        // quality filters ("English" / "Hindi" — the API labels language-as-
        // quality on this server). Split locally, same output as the bundle,
        // half the requests. Leftover languages keep the endpoint family name.
        let english = [], hindi = [], rest = [];
        for (const s of r.sources) {
          const q = String(s.quality || '');
          if (q === 'English') english.push(s);
          else if (q === 'Hindi') hindi.push(s);
          else rest.push(s);
        }
        for (const s of english) push(s, 'Vyse (English)', r.subtitles);
        for (const s of hindi) push(s, 'Fade (Hindi)', r.subtitles);
        for (const s of rest) push(s, 'hdmovie', r.subtitles);
        if (r.master) push({ url: r.master, quality: 'Auto' }, 'hdmovie', r.subtitles, true);
        continue;
      }
      for (const s of r.sources) push(s, r.serverName, r.subtitles);
      // Master playlist (multi-variant m3u8) — one resilient "Auto" card
      if (r.master) push({ url: r.master, quality: 'Auto' }, r.serverName, r.subtitles, true);
    }

    // Task 54 — pre-flight liveness for the hdmovie CDN family. The
    // speedracelight hdmovie endpoint hands out i-cdn-*.salsa436jam.com paths
    // that are frequently DEAD upstream (production evidence, Oak Street +
    // Breaking Bad: ALL language variants of a title shared ONE 404 path —
    // "Vyse (English)", Bengali, Tamil, Telugu, "Hindi Subbed" all 404). A
    // dead card is the player's eternal loading screen. Validate salsa-host
    // URLs with a ranged GET (4s cap, parallel) and drop definitive 404/410.
    // Anything else (403/429/5xx/timeout) KEEPS the card — no drops on
    // uncertainty, matching the repo-wide probe convention.
    const SALSA_RE = /(^|\.)salsa\d*jam\.com$/i;
    const salsaAlive = async (u) => {
      try {
        const res = await fetch(u, {
          headers: { ...HEADERS, Range: 'bytes=0-255' },
          redirect: 'follow',
          signal: AbortSignal.timeout(4000),
        });
        try { await res.body?.cancel(); } catch { /* body already consumed */ }
        return !(res.status === 404 || res.status === 410);
      } catch { return true; /* probe failure = keep (best-effort) */ }
    };
    const salsaIdx = [];
    streams.forEach((s, i) => {
      try { if (SALSA_RE.test(new URL(s.url).hostname)) salsaIdx.push(i); } catch { /* keep */ }
    });
    if (salsaIdx.length) {
      const verdicts = await Promise.all(salsaIdx.map(i => salsaAlive(streams[i].url)));
      for (let k = salsaIdx.length - 1; k >= 0; k--) {
        if (!verdicts[k]) {
          console.log(`[Cineby] dropping dead salsa URL (${streams[salsaIdx[k]].quality} · ${streams[salsaIdx[k]].title})`);
          streams.splice(salsaIdx[k], 1);
        }
      }
    }

    // 4K first — Stremio renders cards top-down
    streams.sort((a, b) => qualityRank(b.quality) - qualityRank(a.quality));
    return streams;
  } catch (e) {
    console.error('[Cineby]', e?.message || e);
    return [];
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
