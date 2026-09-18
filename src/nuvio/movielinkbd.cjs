// src/nuvio/movielinkbd.cjs
// movielinkbd.net — movies/series/kdrama/animes/cartoons via WP REST API +
// post-page parsing, resolved through the KiteCloud file host to DIRECT
// googleusercontent MKV files. Task 58 reverse engineering (2026-09-19).
//
// SITE MAP (verified live):
//   - Discovery : GET /wp-json/wp/v2/posts?search=<q>&per_page=20
//                 (JSON — no CF challenge; title/link/id per post)
//   - Post page : HTML only (theme renders quality blocks from post meta,
//                 NOT in wp-json content) → must parse HTML:
//       movies : <div class="dl-box"> → dl-quality-text (480P/720P/1080P),
//                dl-size-badge (430 MB), kitecloud.me/<code> link
//       series : <div class="yv-season-block"> → yv-season-header (Season NN)
//                → yv-ep-row → yv-ep-title ("Episode 01" | "Ep 01-05" zip
//                pack) + yv-ep-lang ("Hindi & English", "Bengali",
//                "Hindi, English & Japanese") + yv-pill links (480p/720p/1080p)
//   - Host      : kitecloud.me is the ONLY file host (all posts, all types)
//
// KITECLOUD CHAIN (verified live, fully server-side):
//   1. GET  kitecloud.me/<code>            → landing HTML
//         dead file  = generic "Secure Cloud Storage" page, NO /drive/ href
//         live file  = <title> holds the REAL filename
//                      (Movielinkbd.net.Squid.Game.S01E01.WEB.DL...1080p.ESub.mkv)
//                      + /drive/<token> href + metadata (resolution badge,
//                      audio tracks, subtitle tracks, size, codec)
//   2. POST kitecloud.me/drive/<token>     → 302
//         body get_10gbps_link=1 (+ Referer/Origin); Location =
//         kitecloud.pages.dev/?file=<video-downloads.googleusercontent.com
//         signed URL> — parse the file= param → DIRECT playable URL
//   3. GET  file URL                       → 200 video/mkv, Content-Length
//         real, works fresh (server ignores Range → sequential playback;
//         same documented class as UHDMovies/CineFreak GDrive files).
//
// FACTS (honest, verified):
//   - Site quality ceiling is 1080p — dl-quality-text across the catalog
//     only ever reads 480P/720P/1080P (the "2160p"/"4K" strings found on
//     pages are site chrome, not per-post download blocks). No 4K exists
//     upstream; nothing fabricated.
//   - Audio is embedded multi-track (Hindi+English dual audio; anime posts
//     list "Hindi, English & Japanese") — both sub & dub languages in ONE
//     file per quality. Subtitles are EMBEDDED (ESub/English) — the site
//     exposes no separate .srt endpoints; side-loaded tracks still come
//     from the addon-wide unified granite+natsuki stack like every source.
//   - Old uploads go dead on kitecloud (generic landing page) — landing
//     liveness check at resolve time drops them (free, one GET per code).
//
// Task 57 pattern: ALL upstream GETs route through the addon Fetcher
// (preloaded {fetcher, ctx}) — family:4, node-level timeout, got-scraping
// CF fallback for GETs; bare fetch remains the fallback for local tooling.

'use strict';

const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const BASE_URL = 'https://movielinkbd.net';
const KITE_BASE = 'https://kitecloud.me';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Internal soft deadline — the resolver's flat 35s cap still governs; we aim
// to RETURN inside ~25s so background-cache writes land well before it.
const SEARCH_TIMEOUT = 12000;
const PAGE_TIMEOUT = 12000;
const LANDING_TIMEOUT = 10000;
const DRIVE_TIMEOUT = 12000;
const RESOLVE_CAP = 6;      // max kitecloud codes resolved in parallel batch
const PAGE_CAP = 4;         // max post pages fetched in parallel (series)
const MOVIE_PAGE_CAP = 2;   // movies live in ONE post; 2 covers split posts

// Safe error brief — error objects from Fetcher/AbortSignal can carry EMPTY
// or non-string messages (e.status-bearing HttpError instances); falling
// back to the raw object then calling .slice crashes the catch handler
// itself and MASKS the real failure (found live in the first E2E run).
function errBrief(e) {
  if (e instanceof Error && e.message) return String(e.message).slice(0, 80);
  if (typeof e === 'string') return e.slice(0, 80);
  const parts = [];
  if (e && typeof e === 'object') {
    if (e.status || e.statusCode) parts.push(`status ${e.status || e.statusCode}`);
    if (e.statusText) parts.push(String(e.statusText));
    if (e.code) parts.push(String(e.code));
  }
  return (parts.join(' ') || 'unknown error').slice(0, 80);
}

async function fetchText(url, options = {}) {
  const { fetcher, ctx, timeout = 15000, headers = {} } = options;
  if (fetcher && ctx) {
    try {
      const data = await fetcher.text(ctx, new URL(url), {
        headers: { 'User-Agent': UA, 'Accept': 'text/html,application/json,*/*', ...headers },
        timeout,
      });
      return data;
    } catch (e) {
      const status = e?.statusCode || e?.status || 0;
      if (status === 404) return ''; // clean no-match for search/pages
      throw e;
    }
  }
  // bare-fetch fallback (local tooling / no-fetcher callers)
  const r = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { 'User-Agent': UA, ...headers } });
  if (!r.ok) return '';
  return r.text();
}

// POST that does NOT follow redirects (kitecloud drive → 302 Location).
// Fetcher.queuedFetch returns the raw {status, headers} for 3xx when
// maxRedirects: 0 (Fetcher.fetchWithTimeout only follows when the option
// is absent/non-zero) — exactly what the chain needs.
//
// CF REALITY (measured live, Task 58): kitecloud.me challenges Node's TLS
// fingerprint on POST — https.request POST = 403 "cf-mitigated: challenge"
// while browser-TLS got-scraping POST passes with 302 (the Fetcher's
// got-scraping fallback only covers GETs, so the POST carries its own).
async function drivePost(driveUrl, fetcher, ctx) {
  const headers = {
    'User-Agent': UA,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Referer': driveUrl,
    'Origin': 'https://kitecloud.me',
  };
  if (fetcher && ctx) {
    try {
      const res = await fetcher.fetch(ctx, new URL(driveUrl), {
        method: 'POST',
        data: 'get_10gbps_link=1',
        headers,
        maxRedirects: 0,
        timeout: DRIVE_TIMEOUT,
      });
      return { status: res.status, location: res.headers?.location || '' };
    } catch (e) {
      const status = e?.status || e?.statusCode || 0;
      // 403/CF-challenge (and any hard error) → got-scraping browser-TLS retry
      console.log(`[MovieLinkBD] drive POST via Fetcher failed (status ${status || 'n/a'}) → got-scraping fallback`);
    }
    try {
      const { gotScraping } = await import('got-scraping');
      const resp = await gotScraping.post(driveUrl, {
        body: 'get_10gbps_link=1',
        headers,
        timeout: { request: DRIVE_TIMEOUT },
        throwHttpErrors: false,
        followRedirect: false,
      });
      return { status: resp.statusCode, location: resp.headers?.location || '' };
    } catch (e) {
      throw new Error(`drive POST failed: ${errBrief(e)}`);
    }
  }
  // bare fallback (no Fetcher — local tooling)
  const r = await fetch(driveUrl, {
    method: 'POST',
    signal: AbortSignal.timeout(DRIVE_TIMEOUT),
    redirect: 'manual',
    headers,
    body: 'get_10gbps_link=1',
  });
  return { status: r.status, location: r.headers.get('location') || '' };
}

async function getTMDBInfo(tmdbId, mediaType, fetcher, ctx) {
  const type = mediaType === 'tv' ? 'tv' : 'movie';
  try {
    const raw = await fetchText(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_API_KEY}`, { fetcher, ctx, timeout: 8000 });
    const d = JSON.parse(raw);
    return {
      title: (type === 'tv' ? d.name : d.title) || '',
      originalTitle: d.original_title || d.original_name || '',
      year: ((d.first_air_date || d.release_date || '') + '').split('-')[0],
    };
  } catch { return { title: '', originalTitle: '', year: '' }; }
}

function normalize(s) {
  return String(s || '').toLowerCase()
    .replace(/&#0*38;|&amp;/g, '&')
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// WP REST API search — JSON, no CF, includes id/title/link
async function searchPosts(title, fetcher, ctx) {
  const url = `${BASE_URL}/wp-json/wp/v2/posts?search=${encodeURIComponent(title)}&per_page=20&_fields=id,title,link,date`;
  try {
    const raw = await fetchText(url, { fetcher, ctx, timeout: SEARCH_TIMEOUT, headers: { Accept: 'application/json,text/plain,*/*' } });
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map(p => ({ id: p.id, title: String(p.title?.rendered || '').replace(/&#8217;|&#[0-9]+;/g, "'").replace(/&amp;/g, '&').replace(/&#039;/g, "'").trim(), link: p.link, date: p.date })).filter(p => p.link);
  } catch (e) {
    console.error('[MovieLinkBD] search error: ' + errBrief(e));
    return [];
  }
}

// Candidate ordering: normalized-title containment is mandatory; score by
// name equality + year. TV keeps several candidates (seasons live in
// different posts — GoT 2011..2014 = S1..S4; Naruto Shippuden splits S6/S15/S16).
function rankCandidates(posts, info, isTv) {
  const nameNorm = normalize(info.title);
  const origNorm = normalize(info.originalTitle);
  const words = nameNorm.split(' ').filter(w => w.length > 2);
  const scored = [];
  for (const p of posts) {
    const tNorm = normalize(p.title);
    const hasName = (nameNorm && tNorm.includes(nameNorm)) || (origNorm && tNorm.includes(origNorm));
    const wordHits = words.filter(w => tNorm.includes(w)).length;
    if (!hasName && words.length > 0 && wordHits / words.length < 0.6) continue;
    let score = hasName ? 4 : wordHits;
    if (origNorm && tNorm.includes(origNorm)) score += 2;
    const ym = p.title.match(/\b(19|20)\d{2}\b/);
    if (info.year && ym && ym[0] === String(info.year)) score += 2;
    // TV: a post titled with the EXACT requested year may be another season's
    // post — never punish, the season blocks decide. Movie: year bonus above.
    scored.push({ ...p, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// ---- Post page parsing (HTML; theme-rendered blocks) ----

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&#0*39;|&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
}

function parsePostPage(html) {
  const out = { seasons: [], movieBoxes: [], tmdb: null, poster: '', duration: '' };

  // TMDB id (enriched metadata hook, e.g. themoviedb.org/tv/1399)
  const tm = html.match(/themoviedb\.org\/(movie|tv)\/(\d+)/);
  if (tm) out.tmdb = { type: tm[1], id: tm[2] };

  const pm = html.match(/<img[^>]+src="(https:\/\/image\.tmdb\.org\/t\/p\/[^"]+)"/);
  if (pm) out.poster = pm[1];

  const dm = html.match(/(\d+\s*Hours?\s+\d+\s*Minutes?|\d+\s*Minutes?)/i);
  if (dm) out.duration = dm[1];

  // MOVIE boxes: dl-grid → dl-box (quality / size / kitecloud link).
  // NOTE: `</div></div>` boundaries CANNOT delimit dl-boxes — the only
  // adjacent double-close in the panel is (dl-box close + dl-grid close),
  // so a lazy body regex swallows all boxes into one match. Parse by
  // SEGMENTS instead: split on each `<div class="dl-box">` opening; each
  // box's quality/size/link live before the next box opens.
  const boxStarts = [];
  {
    const re = /<div class="dl-box">/g;
    let m;
    while ((m = re.exec(html))) boxStarts.push(m.index);
  }
  for (let i = 0; i < boxStarts.length; i++) {
    const seg = html.slice(boxStarts[i], i + 1 < boxStarts.length ? boxStarts[i + 1] : Math.min(boxStarts[i] + 4000, html.length));
    const q = (seg.match(/dl-quality-text">([^<]+)/) || [])[1];
    const s = (seg.match(/dl-size-badge">([^<]+)/) || [])[1];
    const l = (seg.match(/href="(https:\/\/kitecloud\.me\/[^"]+)"/) || [])[1];
    if (q && l) out.movieBoxes.push({ quality: decodeEntities(q).trim(), size: s ? decodeEntities(s).trim() : '', url: l });
  }

  // SERIES rows: yv-season-block → season header → ep rows → pills.
  // Split on season headers so rows attach to the RIGHT season even when
  // one post holds several (Naruto Shippuden S06+S16 in one post).
  const seasonRe = /yv-season-header">\s*<span>([^<]+)<\/span>/g;
  const marks = [];
  let m;
  while ((m = seasonRe.exec(html))) marks.push({ idx: m.index, name: decodeEntities(m[1]).trim() });
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].idx;
    const end = i + 1 < marks.length ? marks[i + 1].idx : (html.length);
    const seg = html.slice(start, end);
    const numM = marks[i].name.match(/(\d+)/);
    const season = { name: marks[i].name, num: numM ? parseInt(numM[1]) : null, rows: [] };
    if (season.num === null) { out.seasons.push(season); continue; }

    const rowRe = /<div class="yv-ep-row">([\s\S]*?)<div class="yv-pill-group">([\s\S]*?)<\/div>\s*<\/div>/g;
    let r;
    while ((r = rowRe.exec(seg))) {
      const info = r[1];
      const pillsHtml = r[2];
      const titleM = info.match(/yv-ep-title">([^<]+)/);
      if (!titleM) continue;
      const epTitle = decodeEntities(titleM[1]).trim();
      const langM = info.match(/yv-ep-lang">([^<]+)/);
      const lang = langM ? decodeEntities(langM[1]).trim() : '';
      const isPack = /yv-tag-combo/i.test(info) || /\bpack\b/i.test(epTitle) || /\bEp\s*\d+\s*-\s*\d+/i.test(epTitle);
      const pills = [];
      const pillRe = /<a href="(https:\/\/kitecloud\.me\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
      let p;
      while ((p = pillRe.exec(pillsHtml))) {
        const label = decodeEntities(p[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();
        pills.push({ url: p[1], label });
      }
      if (pills.length) season.rows.push({ epTitle, lang, isPack, pills });
    }
    out.seasons.push(season);
  }
  return out;
}

// Quality helpers -----------------------------------------------------------

function pillQuality(label, filename) {
  const hay = `${label || ''} ${filename || ''}`;
  if (/2160|4k/i.test(hay)) return '2160p';
  const m = hay.match(/(\d{3,4})p/i);
  return m ? m[1] + 'p' : '';
}

function qRank(q) {
  const s = String(q || '');
  if (/2160|4k/i.test(s)) return 0;
  if (/1080/.test(s)) return 1;
  if (/720/.test(s)) return 2;
  if (/480/.test(s)) return 3;
  return 4;
}

function parseSizeBytes(size) {
  const m = String(size || '').match(/([\d.]+)\s*(GB|MB|TB)/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const u = m[2].toUpperCase();
  return u === 'TB' ? n * 1024 ** 4 : u === 'GB' ? n * 1024 ** 3 : n * 1024 ** 2;
}

// KiteCloud resolution ------------------------------------------------------

// Movie filename → request verification (Task 53 wrong-content class).
// Filenames look like "Movielinkbd.net.Your.Fault.London.2026.WEB.DL...mkv".
// Checks: (a) ≥80% of significant title words (len>2) hit as word-boundary
// matches in the normalized filename; (b) when BOTH years are known, they
// must be within ±1 (franchise entries years apart get rejected). Titles
// with few significant words ("Up", "It") pass on the year gate alone.
function movieFileMatches(fname, title, originalTitle, reqYear) {
  const norm = s => String(s || '').toLowerCase().replace(/&[a-z#0-9]+;/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  const fn = norm(fname);
  let bestRatio = 0, bestWords = 0, bestHits = 0;
  for (const c of [title, originalTitle].map(norm).filter(Boolean)) {
    const words = c.split(' ').filter(w => w.length > 2);
    if (!words.length) continue;
    const hits = words.filter(w => new RegExp(`(^| )${w}( |$)`).test(fn)).length;
    const ratio = hits / words.length;
    if (ratio > bestRatio || (ratio === bestRatio && words.length > bestWords)) {
      bestRatio = ratio; bestWords = words.length; bestHits = hits;
    }
  }
  if (bestWords > 0 && bestRatio < 0.8) {
    return { ok: false, reason: `title words ${bestHits}/${bestWords}` };
  }
  const fy = fname.match(/\b(19|20)\d{2}\b/);
  if (fy && reqYear) {
    const d = Math.abs(parseInt(fy[0]) - parseInt(reqYear));
    if (d > 1) return { ok: false, reason: `year ${fy[0]} vs ${reqYear}` };
  }
  return { ok: true };
}

// Landing GET → { dead, filename, driveUrl, meta }
async function resolveLanding(codeUrl, fetcher, ctx) {
  let html = '';
  try {
    html = await fetchText(codeUrl, { fetcher, ctx, timeout: LANDING_TIMEOUT });
  } catch (e) {
    return { dead: true, reason: 'landing ' + errBrief(e) };
  }
  if (!html) return { dead: true, reason: 'empty landing' };
  const drive = (html.match(/href="(\/drive\/[^"]+)"/) || [])[1];
  if (!drive) return { dead: true, reason: 'no drive href (generic/dead page)' };
  const filename = decodeEntities((html.match(/<title>([^<]+)<\/title>/) || [])[1] || '').trim();
  const meta = {
    resolution: (html.match(/badge-spec">([\d x]+)<\/span>/) || [])[1] || '',
    codec: '',
    audio: '',
    subs: '',
    size: (html.match(/<i id="size">([^<]+)<\/i>/) || [])[1] || '',
    type: '',
  };
  // list-group items are stable anchors: File Type / Audio Tracks / Subtitles
  const itemType = html.match(/File Type(?:<\/i><i>|<i[^>]*>)([^<]+)</i);
  if (itemType) meta.type = itemType[1].trim();
  const itemAudio = html.match(/Audio Tracks<\/span>[\s\S]{0,120}?<i[^>]*>([\s\S]*?)<\/i>/);
  if (itemAudio) meta.audio = decodeEntities(itemAudio[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
  const itemSubs = html.match(/Subtitles<\/span>[\s\S]{0,120}?<i[^>]*>([\s\S]*?)<\/i>/);
  if (itemSubs) meta.subs = decodeEntities(itemSubs[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
  const codecM = html.match(/badge-spec">([^<]*)<\/span>\s*<span class="badge bg-secondary badge-spec">([^<]+)</);
  if (codecM) meta.codec = codecM[2].trim();
  return { dead: false, filename, driveUrl: KITE_BASE + drive, meta };
}

// Drive POST → direct file URL (302 Location ?file= param)
async function resolveDrive(driveUrl, fetcher, ctx) {
  let res;
  try {
    res = await drivePost(driveUrl, fetcher, ctx);
  } catch (e) {
    return { url: '', reason: errBrief(e) };
  }
  const loc = res.location || '';
  if (!loc) return { url: '', reason: 'no redirect (status ' + res.status + ')' };
  try {
    const fileUrl = new URL(loc).searchParams.get('file') || '';
    if (!fileUrl || !/^https?:\/\//.test(fileUrl)) return { url: '', reason: 'no file param' };
    return { url: fileUrl };
  } catch {
    return { url: '', reason: 'bad redirect URL' };
  }
}

// Resolve one kitecloud code end-to-end, with the filename cross-check that
// prevents the Task 53 wrong-content class (verify SxxExx on series files
// when the filename carries it; movie files check the title words + year).
async function resolveCode(job, fetcher, ctx) {
  const land = await resolveLanding(job.codeUrl, fetcher, ctx);
  if (land.dead) return { ok: false, reason: land.reason };
  const fname = land.filename || '';
  // WRONG-CONTENT GUARD (series): if the filename carries SxxExx it MUST
  // match the request. Filenames look like "...S01E01.WEB.DL...1080p.mkv".
  if (job.isTv && job.season && job.episode) {
    const m = fname.match(/\bS(\d{1,2})E(\d{1,3})\b/i);
    if (m) {
      const fs = parseInt(m[1]);
      const fe = parseInt(m[2]);
      if (fs !== Number(job.season) || fe !== Number(job.episode)) {
        return { ok: false, reason: `filename mismatch S${fs}E${fe}` };
      }
    }
  }
  // WRONG-CONTENT GUARD (movies): the post title can be a FRANCHISE NEIGHBOUR
  // (measured live: request "Your Fault (2024)" matched the "Your Fault:
  // London (2026)" post — different movie). The FILENAME is ground truth:
  // require the title words as word-boundary hits AND a plausible year.
  if (!job.isTv && job.reqTitle) {
    const verdict = movieFileMatches(fname, job.reqTitle, job.reqOriginalTitle, job.reqYear);
    if (!verdict.ok) return { ok: false, reason: `file mismatch: ${verdict.reason}` };
  }
  const drv = await resolveDrive(land.driveUrl, fetcher, ctx);
  if (!drv.url) return { ok: false, reason: drv.reason };
  const quality = job.quality || pillQuality(job.label, fname) || pillQuality('', fname) || '';
  return {
    ok: true,
    url: drv.url,
    filename: fname,
    quality,
    size: land.meta.size || job.size || '',
    meta: land.meta,
  };
}

// Main ----------------------------------------------------------------------

// getStreams(tmdbId, type, season, episode, preloaded)
// type: 'movie' | 'tv'; preloaded: {fetcher, ctx} (Task 57 transport threading)
async function getStreams(tmdbId, type, season, episode, preloaded) {
  const fetcher = preloaded?.fetcher || null;
  const ctx = preloaded?.ctx || null;
  const isTv = type === 'tv';
  console.log(`[MovieLinkBD] Request: tmdb=${tmdbId} type=${type}` +
    (isTv ? ` S${season}E${episode}` : '') + (fetcher ? ' (Fetcher transport)' : ' (bare fetch)'));

  const info = await getTMDBInfo(tmdbId, type, fetcher, ctx);
  if (!info.title) return [];
  console.log(`[MovieLinkBD] TMDB: ${info.title}${info.year ? ' (' + info.year + ')' : ''}`);

  const posts = await searchPosts(info.title, fetcher, ctx);
  if (!posts.length) {
    console.log('[MovieLinkBD] no search results');
    return [];
  }
  const candidates = rankCandidates(posts, info, isTv);
  if (!candidates.length) {
    console.log('[MovieLinkBD] no candidates after title ranking');
    return [];
  }
  console.log(`[MovieLinkBD] ${candidates.length} candidate post(s), top: ${candidates[0].title}`);

  // Fetch post pages in parallel (cap)
  const cap = isTv ? PAGE_CAP : MOVIE_PAGE_CAP;
  const tops = candidates.slice(0, cap);
  const pages = await Promise.all(tops.map(async c => {
    try {
      const html = await fetchText(c.link, { fetcher, ctx, timeout: PAGE_TIMEOUT });
      return { post: c, parsed: html ? parsePostPage(html) : null };
    } catch { return { post: c, parsed: null }; }
  }));

  // Collect kitecloud jobs
  const jobs = [];
  if (isTv) {
    const targetSeason = Number(season) || 1;
    const targetEpisode = Number(episode) || 1;
    for (const { post, parsed } of pages) {
      if (!parsed) continue;
      for (const s of parsed.seasons) {
        if (s.num !== targetSeason) continue;
        for (const row of s.rows) {
          if (row.isPack) continue; // zip packs are not per-episode playable
          const em = row.epTitle.match(/Ep(?:isode)?\s*\.?\s*0*(\d{1,3})/i);
          if (!em) continue;
          if (parseInt(em[1]) !== targetEpisode) continue;
          for (const pill of row.pills) {
            jobs.push({
              codeUrl: pill.url,
              label: pill.label,
              quality: pillQuality(pill.label, ''),
              size: '',
              lang: row.lang,
              postTitle: post.title,
              isTv, season: targetSeason, episode: targetEpisode,
            });
          }
        }
      }
    }
  } else {
    // movie: best-scoring page that actually carries dl-boxes wins; all boxes
    // from it (site editions are complete in one post)
    const withBoxes = pages.find(p => p.parsed && p.parsed.movieBoxes.length);
    if (withBoxes) {
      for (const b of withBoxes.parsed.movieBoxes) {
        jobs.push({
          codeUrl: b.url, label: b.quality, quality: pillQuality(b.quality, ''),
          size: b.size, lang: '', postTitle: withBoxes.post.title, isTv: false,
          season: null, episode: null,
          reqTitle: info.title, reqOriginalTitle: info.originalTitle || '',
          reqYear: info.year || '',
        });
      }
    }
  }

  if (!jobs.length) {
    console.log('[MovieLinkBD] no matching kitecloud links for the request');
    return [];
  }

  // Dedupe + quality-first ordering, resolve in one parallel batch
  const seen = new Set();
  const unique = jobs.filter(j => !seen.has(j.codeUrl) && seen.add(j.codeUrl));
  unique.sort((a, b) => qRank(a.quality) - qRank(b.quality));
  const batch = unique.slice(0, RESOLVE_CAP);
  console.log(`[MovieLinkBD] resolving ${batch.length}/${unique.length} kitecloud link(s)`);

  const settled = await Promise.all(batch.map(j => resolveCode(j, fetcher, ctx).catch(e => ({ ok: false, reason: errBrief(e) }))));
  const resolved = [];
  const seenUrls = new Set();
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (!r.ok) {
      console.log(`[MovieLinkBD] drop ${batch[i].codeUrl}: ${r.reason}`);
      continue;
    }
    if (seenUrls.has(r.url)) continue;
    seenUrls.add(r.url);
    resolved.push({ ...r, label: batch[i].label, lang: batch[i].lang });
  }
  if (!resolved.length) {
    console.log('[MovieLinkBD] all links dead or unresolvable (honest zero)');
    return [];
  }

  // Highest quality first
  resolved.sort((a, b) => qRank(a.quality) - qRank(b.quality));

  const epSuffix = isTv ? ` S${String(season || 1).padStart(2, '0')}E${String(episode || 1).padStart(2, '0')}` : '';
  return resolved.map(r => {
    const langTag = r.lang ? ` — ${r.lang}` : '';
    const name = `MovieLinkBD${epSuffix} — ${r.quality || 'Auto'}${r.size ? ' [' + r.size + ']' : ''}${langTag}`;
    // Rich title feeds enrichMeta: filename carries WEB.DL/Hindi/English/ESub
    const richTitle = `${info.title}${epSuffix} — ${r.filename || r.quality || 'Download'}${r.meta?.audio ? ' — Audio: ' + r.meta.audio : ''}${r.meta?.subs ? ' — Subs: ' + r.meta.subs : ''}`;
    return {
      name,
      title: richTitle,
      url: r.url,
      quality: r.quality || '',
      size: r.size || '',
      filename: r.filename || '',
      audioTracks: r.meta?.audio || '',
      subsInfo: r.meta?.subs || '',
      type: 'video/mkv',
      headers: { 'User-Agent': UA },
      behaviorHints: { bingeGroup: 'movielinkbd' + epSuffix },
    };
  });
}

module.exports = { getStreams, searchPosts, parsePostPage, resolveCode, resolveLanding, resolveDrive, rankCandidates, movieFileMatches };
