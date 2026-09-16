/**
 * VegaMovies Provider for Nuvio Plugins (Task 24)
 * Scrapes new2.vegamovies.futbol — movies / TV / anime with DIRECT
 * googleusercontent downloads (up to 4K) via the nexdrive → fastdl chain.
 *
 * CHAIN (live-verified 2026-09-14):
 *   1. Search:  GET /ts-search.php?q=<title>&page=1
 *               → Typesense proxy JSON {found, hits[].document{post_title,
 *                 permalink, post_thumbnail}}. Exact titles rank first.
 *               (The classic /?s= page is a JS app shell — useless to scrapers,
 *                and /wp-json/* is Cloudflare-403'd.)
 *   2. Post:    fetch permalink → <h5> quality label + nexdrive.fit link
 *               pairs ("Download Now" buttons).
 *   3. Nexdrive: each quality may have its own nexdrive page; the page embeds
 *               mirror buttons. fastdl.zip/embed.php?download=<id> is the
 *               usable mirror (vcloud.fit = CF JS challenge, filebee = JS app).
 *               For SEASON packs the page lists "Episodes: NN" labels, each
 *               followed by its own mirror triplet.
 *   4. fastdl:  embed page carries a video-downloads.googleusercontent.com
 *               direct URL (same family as MoviesDrive/BollyFlix — plays via
 *               the plugin's /range-proxy for seek support).
 *
 * SUBTITLES: files marked "ESub" carry embedded English subs (MKV internal);
 * the plugin's OpenSubtitles fallback attaches multi-language subs by IMDB ID.
 */

'use strict';

const PROVIDER_NAME = 'VegaMovies';
const MAIN_URL = 'https://new2.vegamovies.futbol';
const TMDB_API_KEY = '8476a7ab80ad76f0936744df0430e67c';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ─── got-scraping helpers ─────────────────────────────────────────────────
var _gotScrapingMod = null;
function getGotScraping() {
  if (_gotScrapingMod !== null) return Promise.resolve(_gotScrapingMod);
  return import('got-scraping').then(function (mod) {
    _gotScrapingMod = mod.gotScraping || (mod.default && mod.default.gotScraping) || mod.default;
    return _gotScrapingMod;
  }).catch(function () {
    _gotScrapingMod = false;
    return false;
  });
}

async function fetchText(url, opts) {
  opts = opts || {};
  const gs = await getGotScraping();
  if (!gs) throw new Error('got-scraping unavailable');
  const headers = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };
  if (opts.referer) headers['Referer'] = opts.referer;
  if (opts.accept) headers['Accept'] = opts.accept;
  const res = await gs({
    url: url,
    headers: headers,
    timeout: { request: opts.timeoutMs || 12000 },
    throwHttpErrors: false,
  });
  if (res.statusCode >= 400) throw new Error('HTTP ' + res.statusCode + ' for ' + url.slice(0, 80));
  return typeof res.body === 'string' ? res.body : String(res.body);
}

async function fetchJson(url, opts) {
  const text = await fetchText(url, { ...opts, accept: 'application/json, text/javascript, */*; q=0.01' });
  try { return JSON.parse(text); }
  catch (e) { throw new Error('JSON parse error: ' + e.message); }
}

// ─── TMDB info (same shape as moviesdrive_v2) ─────────────────────────────
async function getTMDBInfo(tmdbId, type) {
  const isTV = type === 'tv' || type === 'series';
  const url = 'https://api.themoviedb.org/3/' + (isTV ? 'tv' : 'movie') + '/' + tmdbId +
    '?api_key=' + TMDB_API_KEY + '&append_to_response=external_ids';
  try {
    const j = await fetchJson(url, { timeoutMs: 10000 });
    return {
      title: (isTV ? j.name : j.title) || '',
      year: ((isTV ? j.first_air_date : j.release_date) || '').slice(0, 4),
      imdbId: (j.external_ids && j.external_ids.imdb_id) || j.imdb_id || null,
      genres: (j.genres || []).map(g => g.id),
      originalLanguage: j.original_language || '',
    };
  } catch (e) {
    console.log('[VegaMovies] TMDB lookup failed: ' + e.message);
    return null;
  }
}

// ─── Search via the site's Typesense proxy ────────────────────────────────
function decodeWpEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&#8211;|&ndash;/g, '–')
    .replace(/&mdash;/g, '—').replace(/&#8217;|&rsquo;/g, "'")
    .replace(/<[^>]+>/g, '').trim();
}

async function searchVegamovies(query, perPage) {
  perPage = perPage || 10;
  const url = MAIN_URL + '/ts-search.php?q=' + encodeURIComponent(query) + '&page=1';
  try {
    const data = await fetchJson(url, { referer: MAIN_URL + '/?s=' + encodeURIComponent(query) });
    if (!data || !Array.isArray(data.hits)) return [];
    return data.hits.slice(0, perPage).map(h => {
      const doc = h.document || {};
      return {
        title: decodeWpEntities(doc.post_title || ''),
        permalink: doc.permalink || '',
        thumbnail: doc.post_thumbnail || '',
        imdbId: null,
      };
    }).filter(r => r.title && r.permalink);
  } catch (e) {
    console.log('[VegaMovies] Search failed: ' + e.message);
    return [];
  }
}

// ─── Title scoring (shared logic class with moviesdrive_v2, Task 24) ──────
function normalizeTitleForMatch(s) {
  return String(s || '').toLowerCase()
    // fold diacritics FIRST — TMDB "Shippūden" vs site "Shippuden" must match
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/^download\s+/i, '')
    .replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, ' ')
    .replace(/\b(480p|720p|1080p|2160p|4k|web-?dl|web-?rip|bluray|bdrip|brrip|hdtv|hdrip|hevc|x264|x265|h265|10bit|60fps|dual[\s-]?audio|multi[\s-]?audio|esub?s?|hindi|english|dubbed|org|original|audio|season|complete|added|imax|uhd|hdr10\+?|dv|full|movie|hd)\b/gi, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function scoreCandidate(requestedTitle, requestedYear, postTitle, isTV, requestedSeason) {
  const tNorm = normalizeTitleForMatch(requestedTitle);
  const pNorm = normalizeTitleForMatch(postTitle);
  if (!tNorm || !pNorm) return 0;
  const tTok = new Set(tNorm.split(' '));
  const pTok = pNorm.split(' ');
  if (pTok.length === 0) return 0;
  const overlap = pTok.filter(w => tTok.has(w)).length;
  const ratio = overlap / Math.max(1, tTok.size);
  const contained = pNorm.includes(tNorm) || tNorm.includes(pNorm);
  let score = contained ? 0.6 + 0.4 * ratio : ratio;
  const years = (postTitle.match(/(19|20)\d{2}/g) || []).map(Number);
  if (requestedYear && years.length) {
    if (years.some(y => Math.abs(y - requestedYear) <= 1)) score += 0.25;
    else score -= 0.3;
  }
  const seriesLike = /\b(seasons?\s*\d|s\d{1,2}\s*[–—-]|episode\s*\d|s\d{1,2}e\d{1,3}|\bep\d+\b|complete\s+(anime\s+)?(web\s+)?series)\b/i.test(String(postTitle || ''));
  if (isTV) score += seriesLike ? 0.2 : -0.15;
  else if (seriesLike) score -= 0.1;
  // Task 24 (vegamovies): season-aware scoring. Posts here are per-season
  // packs, so "Reacher (2022) Season 1" must NOT win an S4 request over the
  // "Reacher {S04E07 Added}" post. Expand ranges ("Season 1 - 16") and
  // SxxEyy tokens before comparing.
  if (isTV && requestedSeason) {
    const seasonNums = new Set();
    for (const m of String(postTitle || '').matchAll(/seasons?\s*(\d{1,2})\s*(?:[–—-]\s*(\d{1,2}))?/gi)) {
      const a = parseInt(m[1], 10);
      const b = m[2] ? parseInt(m[2], 10) : a;
      if (a >= 1 && a <= 50) for (let i = a; i <= Math.min(b, a + 40); i++) seasonNums.add(i);
    }
    for (const m of String(postTitle || '').matchAll(/\bs(\d{1,2})e\d{1,3}\b/gi)) {
      seasonNums.add(parseInt(m[1], 10));
    }
    if (seasonNums.size > 0) {
      if (seasonNums.has(parseInt(requestedSeason, 10))) score += 0.35;
      else score -= 0.4;
    }
  }
  return Math.max(0, Math.min(1.25, score));
}

function pickBestPost(searchResults, info, isTV, requestedSeason) {
  const requestedYear = info.year ? parseInt(info.year, 10) : null;
  let best = null, bestScore = 0;
  for (const r of searchResults) {
    const s = scoreCandidate(info.title, requestedYear, r.title, isTV, requestedSeason);
    if (s > bestScore) { best = r; bestScore = s; }
  }
  if (best && bestScore >= 0.6) return best;
  return null;   // refuse: zero wrong-title streams beats one wrong stream
}

// ─── Post page → nexdrive links with quality labels ───────────────────────
function detectQuality(text) {
  const t = (text || '').toLowerCase();
  if (t.includes('2160') || t.includes('4k') || t.includes('uhd')) return '2160p';
  if (t.includes('1080')) return '1080p';
  if (t.includes('720')) return '720p';
  if (t.includes('480')) return '480p';
  if (t.includes('360')) return '360p';
  return null;
}

function detectSize(text) {
  const m = (text || '').match(/([\d.]+)\s*(GB|MB)\s*(?:\/E|\])/i);
  if (m) return m[1] + m[2].toUpperCase();
  const m2 = (text || '').match(/([\d.]+)\s*(GB|MB)\b/i);
  if (!m2) return null;
  return m2[1] + m2[2].toUpperCase();
}

function detectCodec(text) {
  const t = (text || '').toLowerCase();
  if (t.includes('hevc') || t.includes('x265') || t.includes('h265') || t.includes('10bit')) return 'HEVC';
  if (t.includes('x264') || t.includes('h264') || t.includes('avc')) return 'x264';
  if (t.includes('2160') || t.includes('4k')) return 'HEVC';
  return 'x264';
}

function detectSourceType(text) {
  const t = (text || '').toLowerCase();
  if (t.includes('remux')) return 'BluRay Remux';
  if (t.includes('bluray') || t.includes('bdrip') || t.includes('brrip')) return 'BluRay';
  if (t.includes('web-dl') || t.includes('webdl') || t.includes('amzn') || t.includes('nf ')) return 'WebDL';
  if (t.includes('webrip')) return 'WebRip';
  if (t.includes('hdrip')) return 'HDRip';
  if (t.includes('hdtv')) return 'HDTV';
  return 'WebDL';
}

/**
 * Fetch a post page and extract nexdrive.fit links, each labeled with the
 * nearest preceding heading text (quality / episode / audio info).
 * Returns [{ url, label }].
 */
async function getNexdriveLinks(permalink) {
  const url = permalink.startsWith('http') ? permalink : (MAIN_URL + permalink);
  const html = (await fetchText(url, { referer: MAIN_URL + '/' }))
    .replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ').replace(/&#8211;|&ndash;/g, '–').replace(/&#x26a1;/g, ' ');
  const items = [];
  const re = /<a[^>]+href="(https:\/\/nexdrive\.fit\/[A-Za-z0-9]+\/?)"[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const before = html.slice(Math.max(0, m.index - 900), m.index);
    // nearest preceding h-tag (h1-h5 all carry quality/episode labels here)
    const hTags = [...before.matchAll(/<h([1-5])[^>]*>([\s\S]{0,220}?)<\/h\1>/gi)]
      .map(x => x[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(t => t.length > 2);
    // also allow a strong/span label if no h-tag found in window
    let label = hTags.length ? hTags[hTags.length - 1] : '';
    if (!label) {
      const spans = [...before.matchAll(/<strong[^>]*>([\s\S]{0,200}?)<\/strong>/gi)]
        .map(x => x[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
      label = spans.length ? spans[spans.length - 1] : '';
    }
    items.push({ url: m[1], label });
  }
  return items;
}

// ─── Nexdrive page → fastdl embed id (+ per-episode map for season packs) ─
async function fetchNexdrivePage(nexdriveUrl) {
  const html = (await fetchText(nexdriveUrl, { referer: MAIN_URL + '/' }))
    .replace(/&amp;/g, '&');
  return html;
}

/**
 * Map "Episodes: NN" labels → fastdl ids on a season-pack nexdrive page.
 * Returns { epMap: Map<number, fastdlId>, bareFastdl: id|null }.
 */
function extractFastdlMap(nexdriveHtml) {
  const epMap = new Map();
  // Task 39: link form differs by post age — 2026+ posts use "embed.php?download=",
  // older posts use "embed?download=" (no .php). Accept both or the whole
  // pre-2026 catalog resolves to zero.
  const re = /https:\/\/fastdl\.zip\/embed(?:\.php)?\?download=([A-Za-z0-9]+)/gi;
  let m;
  while ((m = re.exec(nexdriveHtml)) !== null) {
    const before = nexdriveHtml.slice(Math.max(0, m.index - 2500), m.index);
    const eps = [...before.matchAll(/Episodes?\s*:?\s*(\d{1,3})/gi)];
    if (eps.length) {
      const ep = parseInt(eps[eps.length - 1][1], 10);
      if (!epMap.has(ep)) epMap.set(ep, m[1]);
    }
  }
  return { epMap, count: (nexdriveHtml.match(/fastdl\.zip\/embed(?:\.php)?/g) || []).length };
}

// ─── fastdl embed → direct googleusercontent URL ──────────────────────────
async function resolveFastdl(fastdlId) {
  const url = 'https://fastdl.zip/embed.php?download=' + fastdlId;
  const html = await fetchText(url, { referer: 'https://nexdrive.fit/' , timeoutMs: 10000 });
  const m = html.match(/https:\/\/video-downloads\.googleusercontent\.com\/[A-Za-z0-9_-]+/);
  if (!m) return null;
  return m[0];
}

// ─── Main entry ───────────────────────────────────────────────────────────
async function getStreams(tmdbId, type, season, episode) {
  tmdbId = String(tmdbId);
  const isTV = type === 'tv' || type === 'series';
  console.log(`[VegaMovies] Request: tmdb=${tmdbId} type=${type}` +
              (isTV ? ` S${season}E${episode}` : ''));

  const info = await getTMDBInfo(tmdbId, type);
  if (!info) { console.log('[VegaMovies] TMDB fetch failed'); return []; }
  const isAnime = (info.genres || []).includes(16) || info.originalLanguage === 'ja';
  console.log(`[VegaMovies] TMDB: ${info.title}${info.year ? ` (${info.year})` : ''}` +
              ` IMDB: ${info.imdbId || 'N/A'}${isAnime ? ' [ANIME]' : ''}`);

  // 1. search (query ladder: full title → short title)
  let picked = pickBestPost(await searchVegamovies(info.title, 10), info, isTV, season);
  if (!picked) {
    const shortTitle = info.title.split(/[:–—-]/)[0].trim();
    if (shortTitle && shortTitle.toLowerCase() !== info.title.toLowerCase()) {
      picked = pickBestPost(await searchVegamovies(shortTitle, 10), info, isTV, season);
      if (picked) console.log(`[VegaMovies] Short-title fallback "${shortTitle}" matched: ${picked.title.slice(0, 50)}`);
    }
  }
  if (!picked) {
    console.log(`[VegaMovies] No confident match for "${info.title}" — refusing wrong-title post`);
    return [];
  }
  console.log(`[VegaMovies] Best match: ${picked.title.slice(0, 60)} (${picked.permalink})`);

  // 2. post page → nexdrive links with labels
  const items = await getNexdriveLinks(picked.permalink);
  if (items.length === 0) { console.log('[VegaMovies] No nexdrive links on post'); return []; }
  console.log(`[VegaMovies] ${items.length} nexdrive link(s) on post`);

  // 3. group links by quality (movie mode) — for series the quality label
  //    also marks season packs, we resolve episodes INSIDE the nexdrive page
  const byQuality = new Map();
  for (const it of items) {
    const q = detectQuality(it.label) || detectQuality(picked.title);
    if (!q) continue;
    if (!byQuality.has(q)) byQuality.set(q, []);
    byQuality.get(q).push(it);
  }
  if (byQuality.size === 0) { console.log('[VegaMovies] No quality labels detected'); return []; }
  console.log('[VegaMovies] Qualities:', [...byQuality.keys()].join(','));

  // 4. resolve per quality — concurrent pool of 3 (each needs nexdrive page +
  //    fastdl embed = 2 upstream fetches), bounded by the wrapper race
  const results = [];
  const seenQuality = new Set();
  const queue = [...byQuality.entries()];
  const resolveOne = async ([quality, links]) => {
    // pick the first nexdrive link for this quality that actually yields a
    // fastdl mirror (some files are vcloud-only — CF-challenged, skip those)
    // try every link for this quality until one yields a fastdl mirror
    // (bounded by the wrapper's 30s race; vcloud-only pages just fail fast)
    for (const link of links) {
      try {
        const ndHtml = await fetchNexdrivePage(link.url);
        const { epMap } = extractFastdlMap(ndHtml);
        let fastdlId = null;
        if (isTV && season != null && episode != null) {
          fastdlId = epMap.get(parseInt(episode, 10)) || null;
          if (!fastdlId) {
            const eps = [...epMap.keys()].sort((a, b) => a - b);
            console.log(`[VegaMovies]   ${quality}: episode ${episode} not on pack (hosts: ${eps.slice(0, 10).join(',')}…) — skipping`);
            return null;
          }
        } else {
          // movie: first fastdl id on the page (embed.php and embed forms — Task 39)
          fastdlId = (ndHtml.match(/https:\/\/fastdl\.zip\/embed(?:\.php)?\?download=([A-Za-z0-9]+)/) || [])[1] || null;
        }
        if (!fastdlId) continue;
        const direct = await resolveFastdl(fastdlId);
        if (!direct) continue;
        console.log(`[VegaMovies]   ✓ ${quality} resolved (fastdl ${fastdlId.slice(0, 8)}…)`);
        return {
          url: direct,
          quality,
          label: link.label,
          size: detectSize(link.label || picked.title),
          codec: detectCodec(link.label || picked.title),
          sourceType: detectSourceType(link.label || picked.title),
        };
      } catch (e) {
        console.log(`[VegaMovies]   ${quality} link failed: ${e.message.slice(0, 60)}`);
      }
    }
    console.log(`[VegaMovies]   ✗ ${quality}: no usable fastdl mirror`);
    return null;
  };

  const workers = [];
  const qList = queue.filter(([q]) => { if (seenQuality.has(q)) return false; seenQuality.add(q); return true; });
  let idx = 0;
  const CONCURRENCY = 3;
  async function pool() {
    while (idx < qList.length) {
      const my = idx++;
      const r = await resolveOne(qList[my]).catch(() => null);
      if (r) results.push(r);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, qList.length) }, pool));

  // 4K first
  results.sort((a, b) => parseInt(b.quality) - parseInt(a.quality));
  console.log(`[VegaMovies] ✅ ${results.length} playable stream(s) total`);
  return results;
}

module.exports = { getStreams, getTMDBInfo, searchVegamovies, pickBestPost, getNexdriveLinks, resolveFastdl, PROVIDER_NAME, MAIN_URL };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('VegaMovies Direct Stream Extractor (Task 24, got-scraping)');
    console.log('Usage: node vegamovies.cjs <tmdbId> <movie|tv> [season] [episode]');
    process.exit(1);
  }
  getStreams(args[0], args[1] || 'movie', args[2] || null, args[3] || null)
    .then(s => {
      console.log('\n=== Final playable streams (sorted by quality) ===');
      if (!s.length) return console.log('No streams found.');
      s.forEach((x, i) => console.log(`${i + 1}. ${x.quality} | ${x.sourceType} ${x.codec} | ${x.size || 'n/a'}\n   URL: ${x.url.slice(0, 100)}…`));
    })
    .catch(e => { console.error('FATAL', e); process.exit(1); });
}
