// src/utils/siteSubtitles.cjs — Task 49: unified subtitle provider stack.
//
// User requirement: "Use same subtitles providers for all of our sources for
// movies/series/kdramas and animes." The atlantic.st integration (Task 48)
// shipped a far richer subtitle stack than anything else in the addon
// (27-48 languages per title vs OpenSubtitles' 15): the site's two providers
//
//   granite  — GET https://sub.vdrk.site/v1/movie/<tmdb> | /v1/tv/<tmdb>/<s>/<e>
//              → [{label:"Arabic Hi5"|..., file:"https://cache.vdrk.site/...vtt"}]
//              VTT, header-free (UA-only verified 200). "Hi"/"HiN" label
//              suffix = hearing-impaired (site convention). Trailing digits
//              are distinct site variants ("Arabic2" ≠ "Arabic").
//   natsuki  — GET https://natsuki.maybeoneday.ch/subs?tmdbId=&[season&episode]
//              → {subtitles:[{sid,language,langCode,url,fileName,hearingImpaired}]}
//              SRT files — Origin/Referer GATED (403 UA-only) → sub URLs are
//              wrapped through the addon's own /proxy (referer+origin params)
//              so any player can fetch them. The proxy params are part of the
//              URL, so the SAME wrapped URL works on ANY source's card.
//
// This module is the SHARED copy of that stack (atlantic.cjs keeps its own
// inline copy — untouched for zero-breakage; both were verified identical in
// Task 48). StreamResolver fires it ONCE per title IN PARALLEL with the
// source resolves and merges the result into EVERY card from EVERY source,
// so movies, series, kdramas and animes all carry the same providers.
//
// Caching: per-title result cached 6h (subtitle sets are stable), failures
// cached 5min so a flaky upstream isn't hammered per request; in-flight
// dedupe so a user request + prewarm for the same title share one fetch.

'use strict';

const GRANITE_API = 'https://sub.vdrk.site/v1';
const NATSUKI_API = 'https://natsuki.maybeoneday.ch/subs';
const ATLANTIC_ORIGIN = 'https://atlantic.st';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const HEADERS = {
  'User-Agent': UA,
  'Origin': ATLANTIC_ORIGIN,
  'Referer': `${ATLANTIC_ORIGIN}/`,
};

const SUBS_TIMEOUT_MS = 6000;
const MAX_SUBS = 48;
const MAX_GRANITE_SUBS = 32;

// Task 49 production finding: bare undici fetch() (this module's original
// transport) HANGS on Render during/after resolve storms — DNS lookups stall
// past the AbortSignal deadline (undici does not cancel in-flight lookups on
// abort; the instance's IPv6/AAAA path makes it worse). The addon's own
// Fetcher (https.request, family:4 forced, node-level timeout, got-scraping
// CF fallback) is battle-tested on exactly this environment — every source
// uses it. When the caller provides a Fetcher instance + ctx we route all
// upstream calls through it; bare fetch remains as the no-fetcher fallback
// (local tooling).

const CACHE_TTL = 6 * 60 * 60 * 1000;   // 6h — subtitle sets are stable
const NEG_CACHE_TTL = 5 * 60 * 1000;    // 5min — don't hammer a flaky upstream

const subsCache = new Map();   // key → { ts, value }
const subsInflight = new Map(); // key → Promise

// ─── Language table — verbatim from the atlantic.st site bundle ───
const LANG_MAP = {
  english: 'en', french: 'fr', spanish: 'es', 'spanish (latin america)': 'es',
  german: 'de', italian: 'it', portuguese: 'pt', 'portuguese (brazil)': 'pt-br',
  brazilian: 'pt-br', dutch: 'nl', russian: 'ru', japanese: 'ja', korean: 'ko',
  'chinese (simplified)': 'zh-cn', 'chinese (traditional)': 'zh-tw', chinese: 'zh',
  arabic: 'ar', hindi: 'hi', turkish: 'tr', polish: 'pl', swedish: 'sv',
  norwegian: 'no', danish: 'da', finnish: 'fi', greek: 'el', hebrew: 'he',
  thai: 'th', vietnamese: 'vi', indonesian: 'id', czech: 'cs', hungarian: 'hu',
  romanian: 'ro', ukrainian: 'uk', bulgarian: 'bg', croatian: 'hr', serbian: 'sr',
  slovak: 'sk', slovenian: 'sl', estonian: 'et', latvian: 'lv', lithuanian: 'lt',
  farsi: 'fa', persian: 'fa', bengali: 'bn', tamil: 'ta', telugu: 'te',
  malay: 'ms', filipino: 'tl', tagalog: 'tl',
};
function langCodeOf(name) {
  const s = String(name || '').trim().toLowerCase();
  if (!s) return '';
  if (LANG_MAP[s]) return LANG_MAP[s];
  if (/^[a-z]{2}(-[a-z]{2})?$/.test(s)) return s;
  return '';
}

// Unified transport: Fetcher (production) or bare fetch with one fast retry
// (fallback). Returns { ok, status, data } — callers keep their semantics.
async function transportGet(url, { headers, timeoutMs, tag, fetcher, ctx }) {
  if (fetcher && ctx) {
    try {
      const r = await fetcher.fetchWithTimeout(ctx, new URL(url), {
        timeout: timeoutMs,
        headers,
      });
      return { ok: r.status >= 200 && r.status < 300, status: r.status, data: r.data };
    } catch (e) {
      console.log(`[UnifiedSubs] fetcher fail${tag ? ` (${tag})` : ''}: ${e?.message || e} (${url.slice(0, 70)})`);
      return { ok: false, status: 0, data: '' };
    }
  }
  // Fallback: bare fetch, one fast retry on NETWORK-level errors only.
  let lastErr;
  for (let i = 0; i < 2; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 400));
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      const data = await res.text();
      return { ok: res.ok, status: res.status, data };
    } catch (e) {
      lastErr = e;
      console.log(`[UnifiedSubs] fetch fail${tag ? ` (${tag})` : ''} attempt ${i + 1}/2: ${e?.message || e} (${url.slice(0, 70)})`);
    }
  }
  void lastErr;
  return { ok: false, status: 0, data: '' };
}

async function fetchGraniteSubs(tmdbId, type, season, episode, fetcher, ctx) {
  const path = type === 'tv'
    ? `${GRANITE_API}/tv/${tmdbId}/${season || 1}/${episode || 1}`
    : `${GRANITE_API}/movie/${tmdbId}`;
  try {
    const r = await transportGet(path, { headers: { 'User-Agent': UA }, timeoutMs: SUBS_TIMEOUT_MS, tag: 'granite', fetcher, ctx });
    if (!r.ok) return [];
    let arr;
    try { arr = JSON.parse(r.data); } catch { return []; }
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const item of arr) {
      if (!item || typeof item.file !== 'string' || typeof item.label !== 'string') continue;
      const hi = /\shi\d*$/i.test(item.label);
      const base = item.label.replace(/\s*hi\d*$/i, '').trim();
      const variant = base.match(/(\d+)$/);
      const langName = (base.replace(/(\d+)$/, '').trim() || base);
      const display = langName + (variant ? ` ${variant[1]}` : '');
      out.push({
        id: `gr-${langCodeOf(langName) || display.slice(0, 4)}-${out.length}`,
        url: item.file,
        lang: display + (hi ? ' (HI)' : ''),
      });
      if (out.length >= MAX_GRANITE_SUBS) break;
    }
    return out;
  } catch {
    return [];
  }
}

// natsuki sub files are Origin-gated → wrap in the addon's own /proxy so any
// player can fetch them (hostUrl passed in from the resolver's ctx).
// Both queries (tmdbId + imdbId) fire in PARALLEL with a 5s cap.
// Preference: tmdbId result, then imdbId result (site order).
async function fetchNatsukiSubs(tmdbId, imdbId, type, season, episode, hostUrl, fetcher, ctx) {
  if (!hostUrl) return []; // cannot proxy-wrap → raw URLs would 403 in players
  const buildQuery = (params) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) q.set(k, String(v));
    if (type === 'tv') { q.set('season', String(season || 1)); q.set('episode', String(episode || 1)); }
    return q;
  };
  const queries = [];
  if (tmdbId) queries.push(buildQuery({ tmdbId }));
  if (imdbId) queries.push(buildQuery({ imdbId }));
  if (queries.length === 0) return [];

  const attempt = async (q) => {
    try {
      const r = await transportGet(`${NATSUKI_API}?${q.toString()}`, { headers: HEADERS, timeoutMs: 5000, tag: 'natsuki', fetcher, ctx });
      if (!r.ok) return [];
      let j;
      try { j = JSON.parse(r.data); } catch { return []; }
      const subs = Array.isArray(j?.subtitles) ? j.subtitles : [];
      const out = [];
      const seenLangs = new Set();
      for (const s of subs) {
        if (!s || typeof s.url !== 'string' || !s.url) continue;
        const code = langCodeOf(s.langCode) || langCodeOf(s.language);
        if (!code || seenLangs.has(code)) continue;
        seenLangs.add(code);
        const display = (s.language && String(s.language).trim()) || code;
        const proxy = new URL('/proxy', hostUrl);
        proxy.searchParams.set('url', s.url);
        proxy.searchParams.set('referer', `${ATLANTIC_ORIGIN}/`);
        proxy.searchParams.set('origin', ATLANTIC_ORIGIN);
        out.push({
          id: `nk-${code}-${out.length}`,
          url: proxy.href,
          lang: display + (s.hearingImpaired ? ' (HI)' : ''),
        });
        if (out.length >= MAX_SUBS) break;
      }
      // Sample-validate the first file — natsuki's SRT host flaps 502 per-file
      // (verified live in Task 48). If even the first file fails, drop the
      // whole natsuki set rather than ship dead subtitle tracks; granite
      // (stable, direct VTT) still covers the common languages.
      if (out.length > 0) {
        const sampleUrl = subs.find(s => s && typeof s.url === 'string' && s.url)?.url;
        const ok = sampleUrl ? await probeSubFile(sampleUrl, fetcher, ctx) : false;
        if (!ok) return [];
      }
      return out;
    } catch { return []; }
  };

  const results = await Promise.all(queries.map(attempt));
  return results.find(r => r.length > 0) || [];
}

// Status-only probe of a subtitle file (3s cap) — 200/206 is enough, the
// bytes are text by construction.
async function probeSubFile(url, fetcher, ctx) {
  try {
    const r = await transportGet(url, { headers: HEADERS, timeoutMs: 3000, tag: 'subprobe', fetcher, ctx });
    return r.ok;
  } catch { return false; }
}

function mergeSubs(granite, natsuki) {
  const out = [...granite];
  const seen = new Set(granite.map(s => s.lang.toLowerCase()));
  for (const s of natsuki) {
    if (out.length >= MAX_SUBS) break;
    const key = String(s.lang || '').toLowerCase().replace(/\s*\(hi\)$/i, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out.slice(0, MAX_SUBS);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch the unified subtitle set for a title (granite first, natsuki fills
 * remaining slots). Results are cached 6h; the fetch runs once per title even
 * under concurrent requests (in-flight dedupe).
 *
 * @param {object} p
 * @param {string|number} p.tmdbId  TMDB id (granite + natsuki are TMDB-keyed —
 *                                   same ids work for movies, series, kdramas, animes)
 * @param {string} p.type           'movie' | 'series' | 'tv'
 * @param {number} [p.season]
 * @param {number} [p.episode]
 * @param {string|URL} [p.hostUrl]  addon origin for /proxy-wrapped natsuki URLs
 * @returns {Promise<Array<{id,url,lang}>>}
 */
async function fetchUnifiedSubs({ tmdbId, type, season, episode, hostUrl, fetcher, ctx }) {
  const tv = (type === 'tv' || type === 'series');
  const s = tv ? (season || 1) : 0;
  const e = tv ? (episode || 1) : 0;
  const key = `${tv ? 'tv' : 'movie'}:${tmdbId}:${s}:${e}`;

  const cached = subsCache.get(key);
  if (cached) {
    const ttl = (Array.isArray(cached.value) && cached.value.length > 0) ? CACHE_TTL : NEG_CACHE_TTL;
    if (Date.now() - cached.ts < ttl) return cached.value;
    subsCache.delete(key);
  }

  const running = subsInflight.get(key);
  if (running) return running;

  const p = (async () => {
    const [granite, natsuki] = await Promise.all([
      fetchGraniteSubs(tmdbId, tv ? 'tv' : 'movie', s, e, fetcher, ctx),
      fetchNatsukiSubs(tmdbId, null, tv ? 'tv' : 'movie', s, e, hostUrl, fetcher, ctx),
    ]);
    const merged = mergeSubs(granite, natsuki);
    subsCache.set(key, { ts: Date.now(), value: merged });
    // Hard cap to prevent unbounded growth on long-lived instances.
    if (subsCache.size > 300) {
      const entries = [...subsCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
      for (let i = 0; i < 60; i++) subsCache.delete(entries[i][0]);
    }
    return merged;
  })().finally(() => { subsInflight.delete(key); });

  subsInflight.set(key, p);
  return p;
}

/**
 * Merge subtitle tracks for one card: source-provided / OpenSubtitles tracks
 * (primary) keep priority, then the universal granite+natsuki set fills in.
 * Deduped by language (case-insensitive). The "(HI)" hearing-impaired marker
 * is PART of the key so a normal and an HI track of one language coexist
 * (more coverage); distinct site variants ("Arabic 2") stay distinct.
 * Capped at 48 tracks per card.
 */
function mergeSubtitleTracks(primary, secondary, cap = MAX_SUBS) {
  const out = [];
  const seen = new Set();
  const norm = (l) => String(l || '').toLowerCase().trim();
  const lists = [Array.isArray(primary) ? primary : [], Array.isArray(secondary) ? secondary : []];
  for (const list of lists) {
    for (const s of list) {
      if (!s || typeof s.url !== 'string' || !s.url) continue;
      const key = norm(s.lang) || `u:${s.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
      if (out.length >= cap) return out;
    }
  }
  return out;
}

module.exports = { fetchUnifiedSubs, mergeSubtitleTracks };
