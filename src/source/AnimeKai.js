// src/source/AnimeKai.js
// animekai.at — anime with sub+dub HLS streams
//
// Flow (verified live, pure Node.js — no Playwright):
//   1. Search: GET /?s={query} via curl → /watch/{slug}/
//   2. Watch page: GET /watch/{slug}/ via curl → extract POST_ID, MAL_ID, SUB_COUNT, DUB_COUNT
//   3. Stream: GET https://zokoanime.video/stream/mal/{MAL_ID}/{ep}/{sub|dub}
//   4. Deobfuscate: base64decode(window.__P) → XOR("otaku-embed-v1") → JSON → {src: m3u8}
//   5. Play m3u8 with Referer: https://zokoanime.video/
//
// Both SUB (Japanese audio) and DUB (English audio) supported.
// animekai.at uses CF JS Detection — requires system curl for search/info fetch.
// zokoanime.video is accessible via got-scraping.

import { execSync } from 'child_process';
import { CountryCode, Format } from '../types.js';
import { getTmdbId, getTmdbNameAndYear, TmdbId } from '../utils/index.js';
import { Source } from './Source.js';
import { gotScraping } from 'got-scraping';
import { HeaderGenerator } from 'header-generator';
import * as cheerio from 'cheerio';
import { OTAKU_XOR_KEY } from '../utils/site-secrets.cjs';

const BASE = 'https://animekai.at';
const ZOKO = 'https://zokoanime.video';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const OBF_KEY = OTAKU_XOR_KEY; // central registry — env OTAKU_XOR_KEY overrides (site-secrets.cjs)
const REFERER = 'https://zokoanime.video/';

const hg = new HeaderGenerator({ browsers: ['chrome'], devices: ['desktop'], operatingSystems: ['windows'], locales: ['en-US', 'en'] });

// Use system curl for CF-protected pages (animekai.at has CF JS Detection)
function curlGet(url, referer) {
  try {
    const refHeader = referer ? ` -H "Referer: ${referer}"` : '';
    return execSync(
      `curl -sS -L --max-time 10 -A "${UA}"${refHeader} "${url}"`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 12000 }
    );
  } catch { return null; }
}

// Task 52: got-scraping transport with h2→h1 fallback. On Render: curl is
// ABSENT (node:20-slim) and a single h2 attempt dies (GOAWAY class — Task 51
// evidence). h1 keeps the same browser JA3, which is what animekai.at's
// passive CF actually gates on (plain node TLS 403s even locally; curl and
// got-scraping pass).
async function gotPage(url, referer) {
  for (const http2 of [true, false]) {
    try {
      const res = await gotScraping.get(url, {
        headers: { ...hg.getHeaders({ httpVersion: http2 ? '2' : '1' }), 'User-Agent': UA, 'Accept': 'text/html,*/*', ...(referer && { Referer: referer }) },
        timeout: { request: 12000 }, throwHttpErrors: false, http2,
      });
      if (res.statusCode === 200 && res.body) return res.body;
      if (res.statusCode === 403) console.log(`[AnimeKai] got(${http2 ? 'h2' : 'h1'}) HTTP 403 for ${url.slice(0, 70)}`);
    } catch (e) {
      console.log(`[AnimeKai] got(${http2 ? 'h2' : 'h1'}) failed: ${String(e?.message || e).slice(0, 70)}`);
    }
  }
  return null;
}

function deobfuscate(p) {
  const padded = p + '='.repeat((4 - (p.length % 4)) % 4);
  const raw = Buffer.from(padded, 'base64');
  const out = Buffer.alloc(raw.length);
  for (let i = 0; i < raw.length; i++) {
    out[i] = raw[i] ^ OBF_KEY.charCodeAt(i % OBF_KEY.length);
  }
  return JSON.parse(out.toString('utf-8'));
}

// Fetch stream URL from zokoanime.video
async function getStream(malId, episode, type) {
  const streamUrl = `${ZOKO}/stream/mal/${malId}/${episode}/${type}`;
  const html = await gotPage(streamUrl, `${BASE}/`);
  if (!html) return null;
  const m = html.match(/window\.__P="([^"]+)"/);
  if (!m) return null;
  try { return deobfuscate(m[1]); } catch { return null; }
}

// Task 41b: parse watch links from a search page (shared by curl + got paths)
function parseWatchLinks(html) {
  if (!html) return [];
  const $ = cheerio.load(html);
  const results = [];
  const bySlug = new Map();
  $('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/\/watch\/([^/]+)\/?$/);
    if (!m) return;
    const text = $(el).text().trim();
    if (!bySlug.has(m[1])) {
      bySlug.set(m[1], { title: text || m[1].replace(/-/g, ' '), slug: m[1] });
    } else if (text.length > bySlug.get(m[1]).title.length) {
      // poster-card anchors have empty text; a later anchor may carry the
      // real title — prefer the most informative occurrence
      bySlug.get(m[1]).title = text;
    }
  });
  bySlug.forEach(v => results.push(v));
  return results;
}

// got-scraping fallback when plain curl comes back empty (CF TLS fingerprinting)
// — now with h2→h1 inside gotPage (Task 52).
async function gotSearch(query) {
  return gotPage(`${BASE}/?s=${encodeURIComponent(query)}`);
}

export class AnimeKai extends Source {
  constructor(fetcher) {
    super();
    this.id = 'animekai';
    this.label = 'AnimeKai';
    this.contentTypes = ['movie', 'series'];
    this.countryCodes = [CountryCode.multi, CountryCode.ja, CountryCode.en];
    this.baseUrl = BASE;
    this.fetcher = fetcher;
    this.ttl = 10 * 60 * 1000;
  }

  async handleInternal(ctx, _type, id) {
    const tmdbId = await getTmdbId(this.fetcher, ctx, id);
    const [name, year] = await getTmdbNameAndYear(this.fetcher, ctx, tmdbId);
    const titleBase = name + (tmdbId.season ? ` ${TmdbId.formatSeasonAndEpisode(tmdbId)}` : ` (${year})`);

    // Task 41b: Step 1 — progressive search. animekai's site search is strict:
    // the full TMDB title "Frieren: Beyond Journey's End" returns 0 hits while
    // "Frieren" (before the colon) hits exactly; "Sousou no Frieren" (original
    // title) also returns 0. Candidates: full title → pre-colon segment →
    // first 2 words → first word. Each candidate tries curl, then got-scraping.
    const candidates = [];
    const push = (t) => {
      const v = (t || '').trim();
      if (v.length >= 3 && !candidates.includes(v)) candidates.push(v);
    };
    push(name);
    const colonIdx = name.search(/[:–—]\s/);
    if (colonIdx > 0) push(name.slice(0, colonIdx).trim());
    const words = name.split(/\s+/);
    if (words.length > 2) push(words.slice(0, 2).join(' '));
    if (words.length > 1) push(words[0]);

    let results = [];
    let usedCandidate = '';
    for (const cand of candidates) {
      let searchHtml = curlGet(`${BASE}/?s=${encodeURIComponent(cand)}`);
      let parsed = parseWatchLinks(searchHtml);
      if (!parsed.length) {
        searchHtml = await gotSearch(cand);
        parsed = parseWatchLinks(searchHtml);
      }
      if (parsed.length) { results = parsed; usedCandidate = cand; break; }
    }
    console.log(`[AnimeKai] search "${name}" → candidate "${usedCandidate}" → ${results.length} hits`);
    if (!results.length) return [];

    // Pick best match — require fuzzy score >= 60 to avoid false matches
    // Apostrophes are dropped BEFORE tokenizing so "Journey's" == "journeys"
    // (TMDB title text vs site slug artifact otherwise never converge).
    const normalize = (s) => s.toLowerCase().replace(/['\u2019]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const nameNorm = normalize(name);
    let best = null;
    let bestScore = 0;
    for (const r of results) {
      const tNorm = normalize(r.title);
      if (!tNorm) continue;
      let score = 0;
      if (tNorm === nameNorm) score = 100;
      else if (tNorm.includes(nameNorm) || nameNorm.includes(tNorm)) {
        score = Math.min(tNorm.length, nameNorm.length) / Math.max(tNorm.length, nameNorm.length) * 90;
      }
      if (score > bestScore) { bestScore = score; best = r; }
    }
    if (!best || bestScore < 60) {
      console.log(`[AnimeKai] no match >=60 (best=${best ? bestScore.toFixed(1) : 'none'}) for "${name}"`);
      return [];
    }
    console.log(`[AnimeKai] matched "${best.slug}" (score=${bestScore.toFixed(1)})`);

    // Step 2: Get anime info (POST_ID, MAL_ID) — curl first (local), then the
    // got-scraping h2→h1 chain (Render has no curl binary). If curl came back
    // with a CF challenge/empty shell (no MAL_ID), retry through gotPage so a
    // locally-challenged curl never silently kills the source.
    const watchUrl = `${BASE}/watch/${best.slug}/`;
    let watchHtml = curlGet(watchUrl, `${BASE}/`);
    let malId = watchHtml?.match(/MAL_ID\s*=\s*["'](\d+)["']/)?.[1];
    if (!malId) {
      const gotHtml = await gotPage(watchUrl, `${BASE}/`);
      if (gotHtml) {
        malId = gotHtml.match(/MAL_ID\s*=\s*["'](\d+)["']/)?.[1];
        if (malId) watchHtml = gotHtml;
      }
    }
    if (!watchHtml) {
      console.log('[AnimeKai] watch page fetch failed');
      return [];
    }

    if (!malId) {
      console.log('[AnimeKai] MAL_ID not found on watch page');
      return [];
    }

    // Step 3: Fetch streams for both sub and dub via zokoanime.video
    const epNum = tmdbId.season ? (tmdbId.episode || 1) : 1;
    const results2 = [];
    const seenUrls = new Set();

    for (const category of ['sub', 'dub']) {
      try {
        const data = await getStream(malId, epNum, category);
        if (!data?.src || seenUrls.has(data.src)) continue;
        seenUrls.add(data.src);

        let parsed;
        try { parsed = new URL(data.src); } catch { continue; }

        const audioLabel = category === 'dub' ? 'DUB' : 'SUB';
        const countryCodes = category === 'dub'
          ? [CountryCode.multi, CountryCode.en]
          : [CountryCode.multi, CountryCode.ja];

        // Task 41b: attach the stream's real inline subtitles (zoko payload
        // carries {lang, label, src} VTT tracks per audio category).
        const subs = Array.isArray(data.subtitles)
          ? data.subtitles
              .filter(s => s?.src && typeof s.src === 'string')
              .map((s, i) => {
                const lang = (s.lang || s.label || 'en').toString().slice(0, 8);
                try {
                  return { id: `${lang}${i}`.slice(0, 8), url: new URL(s.src).href, lang };
                } catch { return null; }
              })
              .filter(Boolean)
          : [];

        results2.push({
          url: parsed,
          format: Format.hls,
          meta: {
            countryCodes,
            title: `${titleBase} (AnimeKai ${audioLabel})`,
            sourceId: this.id,
            sourceLabel: this.label,
            height: 1080,
            ...(subs.length > 0 && { subtitles: subs }),
          },
        });
      } catch { /* skip */ }
    }
    console.log(`[AnimeKai] S${tmdbId.season || 1}E${epNum} mal=${malId} → ${results2.length} stream(s) (sub+dub attempted)`);
    return results2;
  }
}
