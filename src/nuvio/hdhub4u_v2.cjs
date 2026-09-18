// HDHub4u (new5.hdhub4u.cl) — Standalone Scraper (Task 39 rewrite)
// =========================================================================
// Returns direct playable links (GDrive/pixeldrain/HLS) up to 4K with REAL
// metadata parsed from the site's own headings — no fabricated values.
//
// 2026-09 SITE MIGRATION (Task 39 probe evidence):
//   - Download buttons now go through greenmotors.cc/?id=<encrypted> (the
//     same ad-funnel Task 38 decoded for 4khdhub.one). The landing page
//     embeds token s('o','<token>') → atob→atob→ROT13→atob→JSON {w,l,o}
//     → atob(o) = real target:
//         hubcloud.*/drive|video/<id>   → resolvable (HubExtractor play-time)
//         hubcdn.*/file/<id>            → inventoryidea flow / HubExtractor
//         hblinks.co/archives/<id>      → HBLinks extractor (play-time)
//         hubdrive.pics/file/<id>       → login-gated 401 → skipped
//   - "Watch Online" buttons: hdstream4u.com/file/<id> → Dean-Edwards packed
//     JS → acek-cdn HLS master.m3u8 (verified live in production).
//   - Per-link metadata lives in the nearest preceding heading:
//         "720p 10Bit HEVC [760MB]" / "4K [2160p SDR WEB-DL – 9.5GB]"
//     and the post H1 carries audio/codec: "… [English DD5.1] … [x264/10Bit-HEVC]".
//   - Sitemaps fill sequentially: post-sitemap15.xml is the NEWEST (90 urls,
//     2026 posts) while sitemap1-4 hold 2017-2018 posts — scan newest first.
//
// USAGE:
//   const hh = require('./hdhub4u_v2.cjs');
//   const streams = await hh.getStreams('27205', 'movie');
//
// CLI:
//   node hdhub4u_v2.cjs 27205 movie

'use strict';

const PROVIDER_NAME = 'HDHub4u';
const ORIGIN = 'https://new5.hdhub4u.cl';
const TMDB_API_KEY = '8476a7ab80ad76f0936744df0430e67c';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// got-scraping helper for Cloudflare bypass
let _gotScraping = null;
async function loadGotScraping() {
  if (_gotScraping !== null) return _gotScraping;
  try { const mod = await import('got-scraping'); _gotScraping = mod.gotScraping || mod.default || mod.got; }
  catch (e) { _gotScraping = false; }
  return _gotScraping;
}

// Task 57 (2026-09-19): Fetcher transport injection. Production evidence
// (/debug/stream Inception): hdhub4uv2 TIMEOUT at 39.4s in a merged resolve
// while isolated /debug/source lands 6 cards @0.3s — the same Task 55
// DNS-stall class that hit 4khdhub/atlantic: under 15-source contention,
// got-scraping/undici DNS lookups stall past AbortSignal deadlines (the
// instance's IPv6/AAAA path makes it worse). The addon Fetcher (https.request,
// family:4 forced, node-level timeout) is immune. The wrapper calls
// setTransport(this.fetcher) once per resolve; fetchText/getTMDBInfo/headOk
// route through it FIRST, got-scraping and bare fetch stay as fallbacks.
// ctx is not used by the Fetcher internals — a neutral object suffices.
let _fetcher = null;
function setTransport(fetcher) { _fetcher = fetcher || null; }
const NEUTRAL_CTX = { config: {} };

async function fetchViaFetcher(url, { method = 'GET', timeout = 15000, headers }) {
  if (!_fetcher) return null;
  try {
    if (method === 'HEAD') {
      const h = await _fetcher.head(NEUTRAL_CTX, new URL(url), { timeout, headers });
      return { kind: 'head', ct: (h && (h['content-type'] || h['Content-Type'])) || '' };
    }
    const data = await _fetcher.text(NEUTRAL_CTX, new URL(url), { timeout, headers });
    return { kind: 'text', text: data };
  } catch (e) {
    const status = e?.statusCode || e?.status || 0;
    if (status >= 400) return { kind: 'error', status };
    return null; // network-level → caller fallback path
  }
}

async function fetchText(url, referer, timeout) {
  const headers = { 'User-Agent': UA, 'Accept': 'text/html,application/json,*/*' };
  if (referer) headers['Referer'] = referer;
  // Task 57: Fetcher first (family:4 — merged-resolve DNS-stall fix)
  const fRes = await fetchViaFetcher(url, { timeout: timeout || 15000, headers });
  if (fRes) {
    if (fRes.kind === 'text') return fRes.text;
    if (fRes.kind === 'error') throw new Error('HTTP ' + fRes.status);
  }
  const gs = await loadGotScraping();
  if (gs) {
    try {
      const res = await gs({ url, headers, timeout: { request: timeout || 15000 }, retry: { limit: 1 } });
      if (res.statusCode >= 200 && res.statusCode < 400) return typeof res.body === 'string' ? res.body : res.body.toString();
    } catch (e) { /* fall through */ }
  }
  // Task 49: one fast retry on NETWORK-level errors for the native fallback
  // (Render DNS/socket hiccup class — Task 48 fix2). HTTP-status errors keep
  // caller semantics (thrown without retry).
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 400));
    try {
      const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(timeout || 15000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (/^HTTP /.test(String(e?.message || ''))) throw e; // real answer — no retry
    }
  }
  throw lastErr;
}

async function getTMDBInfo(tmdbId, type) {
  const url = 'https://api.themoviedb.org/3/' + (type === 'tv' ? 'tv' : 'movie') + '/' + tmdbId + '?api_key=' + TMDB_API_KEY;
  // Task 57: Fetcher first (merged-resolve DNS-stall fix)
  const fRes = await fetchViaFetcher(url, { timeout: 10000, headers: { 'User-Agent': UA } });
  if (fRes && fRes.kind === 'text') {
    const j = JSON.parse(fRes.text);
    return { title: j.name || j.title || 'Unknown', year: (j.first_air_date || j.release_date || '').slice(0, 4), type, tmdbId: String(tmdbId) };
  }
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error('TMDB HTTP ' + res.status);
  const j = await res.json();
  return { title: j.name || j.title || 'Unknown', year: (j.first_air_date || j.release_date || '').slice(0, 4), type, tmdbId: String(tmdbId) };
}

// ---------------------------------------------------------------------------
// Sitemap search — NEWEST sitemaps first, parallel batches, deadline-bounded.
// (Old code scanned sitemap1→15 sequentially: sitemap1-4 are 2017-2018 posts,
// so most of the search window was burned on content that can never match a
// current title while the client budget expired.)
// ---------------------------------------------------------------------------
const SITEMAP_COUNT = 15;
const SEARCH_DEADLINE_MS = 7000;

async function searchSite(title, year) {
  const deadline = Date.now() + SEARCH_DEADLINE_MS;
  const titleWords = title.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);
  const firstWord = titleWords[0] || '';
  if (!firstWord) return [];
  const yearStr = year ? String(year) : '';

  const results = [];
  const seenSlugs = new Set();

  const scanSitemap = async (n) => {
    try {
      const xml = await fetchText(ORIGIN + '/post-sitemap' + n + '.xml', null, 6000);
      const urls = [...xml.matchAll(/<loc>(https:\/\/new5\.hdhub4u\.cl\/([a-z0-9-]+)\/?)<\/loc>/g)];
      const found = [];
      for (const m of urls) {
        const slug = m[2];
        if (seenSlugs.has(slug)) continue;
        if (slug.match(/^(category|tag|page|wp-|feed|comment|search|author|disclaimer|dmca|privacy|contact|about|how-to|join|request|xmlrpc)/)) continue;
        if (!slug.toLowerCase().includes(firstWord)) continue;
        seenSlugs.add(slug);
        found.push({ url: m[1], slug, site: 'hdhub4u' });
      }
      return found;
    } catch (e) { return []; }
  };

  // Newest first (post-sitemapN: N=15 is the current, partially-filled file)
  for (let start = SITEMAP_COUNT; start >= 1 && Date.now() < deadline && results.length < 24; start -= 4) {
    const batch = [];
    for (let n = start; n >= Math.max(1, start - 3); n--) batch.push(scanSitemap(n));
    const settled = await Promise.all(batch);
    for (const list of settled) results.push(...list);
  }

  // Score: title-word overlap + year match (slug signal).
  // Task 53b: WORD-BOUNDARY matching, not substring — the substring match
  // let "darkgame-2024" score 1 for "Game of Thrones" ("dark**game**") and
  // ship DarkGame (2024) movie links labeled as GoT S1E1 (verified: hblinks
  // archives/112256 title = "DarkGame (2024)"). Word-boundary regex keeps
  // real-title slugs scoring while compound-word fakes score 0.
  const wordRe = (w) => new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)');
  for (const r of results) {
    const slugLower = r.slug.toLowerCase();
    let score = 0, hits = 0;
    for (const w of titleWords) if (wordRe(w).test(slugLower)) { score++; hits++; }
    if (yearStr && slugLower.includes(yearStr)) score += 2;
    r.score = score;
    // Task 53b: expose word-hit count + required minimum so getStreams can
    // refuse candidates that don't contain the requested title's words
    // (misattribution guard — see getStreams).
    r.hits = hits;
    r.minWords = Math.min(2, titleWords.length);
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}

// ---------------------------------------------------------------------------
// Metadata parsing — everything comes from the site's own text; unknown stays
// unknown (the old code fabricated codec/sourceType/audio, which then poisoned
// the resolver's enrichMeta into displaying false specs).
// ---------------------------------------------------------------------------
function parseQuality(text) {
  const t = String(text || '');
  if (/\b2160p?\b|\b4k\b/i.test(t)) return '2160p';
  const m = t.match(/\b(1080p|720p|480p|360p)\b/i);
  return m ? m[1].toLowerCase() : null;
}

function parseSize(text) {
  const m = String(text || '').match(/(\d+(?:\.\d+)?\s*(?:GB|MB))(?![a-z])/i);
  return m ? m[1].replace(/\s+/g, '') : null;
}

function parseCodec(text) {
  const t = String(text || '').toLowerCase();
  if (t.includes('hevc') || t.includes('x265') || t.includes('h265') || t.includes('h.265')) return 'HEVC';
  if (t.includes('x264') || t.includes('h264') || t.includes('h.264') || t.includes('avc')) return 'x264';
  return null;
}

function parseSourceType(text) {
  const t = String(text || '').toLowerCase();
  if (t.includes('remux')) return 'BluRay Remux';
  if (t.includes('bluray') || t.includes('bdrip') || t.includes('brrip')) return 'BluRay';
  if (t.includes('web-dl') || t.includes('webdl')) return 'WebDL';
  if (t.includes('webrip') || /\bweb\b/.test(t)) return 'WebRip';
  if (t.includes('hdrip')) return 'HDRip';
  if (t.includes('hdtv')) return 'HDTV';
  if (t.includes('dvdrip')) return 'DVDRip';
  return null;
}

function parseBitDepth(text) {
  return /10\s*-?\s*bit/i.test(String(text || '')) ? '10-bit' : null;
}

// Audio from the post H1 — real patterns seen live:
//   "… WEB-DL [English DD5.1] 4K …"                → English
//   "… Dual Audio {Hindi-English} 480p …"           → Hindi + English
//   "… {Hindi-English} 720p …"                      → Hindi + English
//   "… Dual Audio [Hindi DD5.1 + English] …"        → Hindi + English
//   "… Hindi 720p WEBRip …"                         → Hindi
function parseAudio(postTitle) {
  const t = String(postTitle || '');
  const langs = [];
  const add = (name) => { if (name && !langs.includes(name)) langs.push(name); };
  if (/\bhindi\b|\bhin\b|\bdesi\b/i.test(t)) add('Hindi');
  if (/\benglish\b|\beng\b/i.test(t)) add('English');
  if (/\btamil\b/i.test(t)) add('Tamil');
  if (/\btelugu\b/i.test(t)) add('Telugu');
  if (/\bmalayalam\b/i.test(t)) add('Malayalam');
  if (/\bjapanese\b/i.test(t)) add('Japanese');
  if (/\bkorean\b/i.test(t)) add('Korean');
  return langs.length ? langs.join(' + ') : null;
}

// ---------------------------------------------------------------------------
// Post page → labeled download links.
// Walk the HTML linearly; every candidate link inherits the nearest preceding
// heading text (h1-h6) as its label — that's where the site prints
// "720p 10Bit HEVC [760MB]" / "4K [2160p SDR WEB-DL – 9.5GB]".
// Returns [{ url, type, label, h1 }]
// ---------------------------------------------------------------------------
const LINK_PATTERNS = [
  // Task 50: TLD-agnostic — funnel domain rotates (greenmotors.cc → .club
  // observed 2026-09; same script, same decode chain on every TLD).
  { type: 'greenmotors', re: /href="(https:\/\/greenmotors\.[a-z]{2,}\/\?id=[A-Za-z0-9+/=]+)"/gi },
  { type: 'hdstream4u', re: /href="(https:\/\/hdstream4u\.com\/file\/([A-Za-z0-9]+))"/g },
  { type: 'hubcloud', re: /href="(https:\/\/hubcloud\.[a-z]+\/(?:drive|video)\/([a-z0-9_]+))"/g },
  { type: 'hubcdn', re: /href="(https:\/\/hubcdn\.[a-z]+\/file\/([A-Za-z0-9]+))"/g },
  { type: 'gdflix', re: /href="(https:\/\/(?:new\d+\.)?gdflix\.[a-z]+\/file\/([A-Za-z0-9]+))"/g },
];

function parsePostLinks(html) {
  const h1Match = html.match(/<h1[^>]*>([\s\S]{0,300}?)<\/h1>/i);
  const h1 = h1Match ? h1Match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';

  // heading positions (all levels) — label = nearest heading before the link
  const headings = [];
  for (const m of html.matchAll(/<h([1-6])[^>]*>([\s\S]{0,300}?)<\/h\1>/gi)) {
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length > 2) headings.push({ idx: m.index, text });
  }

  const links = [];
  const seen = new Set();
  for (const pat of LINK_PATTERNS) {
    pat.re.lastIndex = 0;
    for (const m of html.matchAll(pat.re)) {
      const url = m[1];
      if (seen.has(url)) continue;
      seen.add(url);
      // nearest heading strictly before this link (search backwards)
      let label = '';
      for (let i = headings.length - 1; i >= 0; i--) {
        if (headings[i].idx < m.index) { label = headings[i].text; break; }
      }
      links.push({ url, type: pat.type, label, h1 });
    }
  }
  return { links, h1 };
}

// ---------------------------------------------------------------------------
// greenmotors decode — same funnel Task 38 cracked for 4khdhub.one:
// token s('o','<token>') → atob → atob → ROT13 → atob → JSON {l,w,o} → atob(o)
// ---------------------------------------------------------------------------
function rot13(s) {
  return String(s).replace(/[a-zA-Z]/g, c => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}
function b64decode(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('binary');
}

async function resolveGreenmotors(href) {
  try {
    const html = await fetchText(href, ORIGIN + '/', 12000);
    const tokenMatch = html.match(/s\(\s*['"]o['"]\s*,\s*['"]([A-Za-z0-9+/=]+)['"]/);
    if (!tokenMatch) return null;
    let s = b64decode(tokenMatch[1]);
    s = b64decode(s);
    s = rot13(s);
    s = b64decode(s);
    const json = JSON.parse(s);
    if (!json || !json.o) return null;
    const real = b64decode(json.o);
    if (!/^https?:\/\//.test(real)) return null;
    return real;
  } catch (e) { return null; }
}

const _gmCache = new Map();
const GM_CACHE_TTL = 30 * 60 * 1000;
async function resolveGreenmotorsCached(href) {
  const hit = _gmCache.get(href);
  if (hit && Date.now() - hit.ts < GM_CACHE_TTL) return hit.val;
  const val = await resolveGreenmotors(href);
  if (_gmCache.size > 400) _gmCache.clear();
  _gmCache.set(href, { ts: Date.now(), val });
  return val;
}

// ---------------------------------------------------------------------------
// Legacy resolvers (kept from the pre-greenmotors era — some posts/qualities
// still carry direct hubcloud/hubcdn/gdflix anchors)
// ---------------------------------------------------------------------------
// Task 54: lh3.googleusercontent.com/pw/ links are Google-hotlink-blocked from
// many IPs (403 image/png identity pixel — shipped as "streams" they play
// nothing). Same guard as movieshunt_v2: only emit when provably reachable.
async function headOk(url) {
  try {
    // Task 57: Fetcher HEAD first (DNS-stall fix, same class as fetchText)
    const fRes = await fetchViaFetcher(url, { method: 'HEAD', timeout: 4000, headers: { 'User-Agent': UA } });
    if (fRes && fRes.kind === 'head') {
      const ct = String(fRes.ct || '').toLowerCase();
      return !ct.startsWith('image/');
    }
    if (fRes && fRes.kind === 'error') return false;
    const res = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': UA },
      redirect: 'follow',
      signal: AbortSignal.timeout(4000),
    });
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    return res.ok && !ct.startsWith('image/');
  } catch { return false; }
}

async function resolveHubcloudDrive(driveUrl) {
  try {
    const html = await fetchText(driveUrl, 'https://hubcloud.cx/');
    const gxMatch = html.match(/https:\/\/gamerxyt\.com\/hubcloud\.php\?[^"'\s]+/);
    if (!gxMatch) return null;
    const gxHtml = await fetchText(gxMatch[0], driveUrl);
    const gdMatch = gxHtml.match(/https:\/\/lh3\.googleusercontent\.com\/[^\s"'<>]+/);
    if (gdMatch) {
      let url = gdMatch[0].split('#')[0].split('=m')[0];
      const lh3Url = url + '=d';
      // Task 54: only emit when provably a real file, else fall through to
      // pixeldrain (the identity-pixel thumbnail class never plays).
      if (await headOk(lh3Url)) return lh3Url;
    }
    const pdMatch = gxHtml.match(/https:\/\/pixeldrain\.[a-z]+\/u\/([A-Za-z0-9]+)/);
    if (pdMatch) return 'https://pixeldrain.com/api/file/' + pdMatch[1] + '?download';
    return null;
  } catch (e) { return null; }
}

async function resolveHubcdn(hubcdnUrl) {
  try {
    const html = await fetchText(hubcdnUrl, 'https://hubcdn.sbs/');
    const invMatches = [...html.matchAll(/inventoryidea\.com\/\?r=([A-Za-z0-9+/=]+)/g)];
    for (const m of invMatches) {
      try {
        const decoded = Buffer.from(m[1], 'base64').toString('utf8');
        // hubcdn.club (Task 39): decoded value is hubcdn.<tld>/dl/?link=<FINAL>.
        // The /dl page's JS just copies the link param onto <a id="vd">, so the
        // FINAL target is already server-side visible — no extra fetch needed.
        // Accept the known direct-file families (GDrive CDN + Cloudflare R2 MKV).
        const dlLink = decoded.match(/[?&]link=(https?:\/\/[^\s&]+)/);
        if (dlLink) {
          const target = decodeURIComponent(dlLink[1]);
          if (/googleusercontent\.com|\.r2\.dev|pixeldrain\.com\/api|\.(mkv|mp4)(\?|$)/i.test(target)) return target;
        }
        const gdMatch = decoded.match(/link=(https:\/\/video-downloads\.googleusercontent\.com\/[^&\s]+)/);
        if (gdMatch) return gdMatch[1];
        const lh3Match = decoded.match(/(https:\/\/lh3\.googleusercontent\.com\/[^\s&]+)/);
        if (lh3Match) {
          const lh3Url = lh3Match[1].split('=m')[0] + '=d';
          if (await headOk(lh3Url)) return lh3Url;
        }
      } catch (e) {}
    }
    const atobMatch = html.match(/atob\(["']([A-Za-z0-9+/=]+)["']\)/);
    if (atobMatch) {
      const decoded = Buffer.from(atobMatch[1], 'base64').toString('utf8');
      if (decoded.includes('googleusercontent')) return decoded;
    }
    return null;
  } catch (e) { return null; }
}

async function resolveGdflix(gdflixUrl) {
  try {
    const html = await fetchText(gdflixUrl);
    const indexMatch = html.match(/https:\/\/[a-z0-9-]+\.indexserver\.site\/[^\s"'<>]+/);
    if (indexMatch) return { url: indexMatch[0], type: 'zip' };
    return null;
  } catch (e) { return null; }
}

async function resolveHdstream4u(hdstreamUrl) {
  try {
    const html = await fetchText(hdstreamUrl, 'https://hdstream4u.com/');
    const match = html.match(/eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)\)\)/);
    if (!match) return null;

    const p = match[1], a = parseInt(match[2]), c = parseInt(match[3]), keys = match[4].split('|');
    function baseN(num, base) {
      if (num === 0) return '0';
      const chars = '0123456789abcdefghijklmnopqrstuvwxyz'.slice(0, base);
      let out = '';
      while (num > 0) { out = chars[num % base] + out; num = Math.floor(num / base); }
      return out;
    }
    let result = p;
    for (let i = 0; i < c; i++) {
      const token = baseN(i, a);
      if (keys[i]) result = result.replace(new RegExp('\\b' + token + '\\b', 'g'), keys[i]);
    }
    const m3u8Match = result.match(/https:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/);
    if (m3u8Match) return m3u8Match[0];
    const hlsMatch = result.match(/links\.hls[0-9]?\s*=\s*["']([^"']+)/);
    if (hlsMatch) return hlsMatch[1];
    return null;
  } catch (e) { return null; }
}

// ---------------------------------------------------------------------------
// Per-link resolution → { url, mime } | null.
// greenmotors-decoded targets are emitted DIRECTLY when they land on hosts the
// extractor layer already resolves at play time (hubcloud.* → HubExtractor,
// hblinks.co → HBLinks) — same architecture as the Task 38 4khdhub source.
// hubdrive.pics (login-gated) is skipped.
// ---------------------------------------------------------------------------
async function resolveLink(link) {
  const label = link.label || '';
  const isHlsWatch = link.type === 'hdstream4u';

  if (link.type === 'greenmotors') {
    const real = await resolveGreenmotorsCached(link.url);
    if (!real) return null;
    if (/hubdrive\.pics/i.test(real)) return null;               // login-gated 401
    if (/^https:\/\/hubcdn\.[a-z]+\/file\//i.test(real)) {
      // server-side inventoryidea→final-URL chain (Task 39: also covers the
      // hubcdn.club /dl/?link=<r2.dev> form). Unresolvable → skip the link —
      // emitting the raw hubcdn page URL just ships a dead card (HubExtractor
      // can't parse the inventoryidea-only page generation either).
      const direct = await resolveHubcdn(real);
      if (direct) return { url: direct, mime: 'video/x-matroska' };
      return null;
    }
    // Task 51: hblinks rotated .co → .lol (TLD-agnostic). The HBLinks
    // extractor matches /hblinks/ on the host so any TLD resolves at play
    // time; NuvioExtractor's download-page gate is also TLD-agnostic now.
    if (/hubcloud\.|hblinks\.[a-z]{2,}/i.test(real)) return { url: real, mime: 'video/x-matroska' };
    if (/video-downloads\.googleusercontent\.com/i.test(real)) return { url: real, mime: 'video/mp4' };
    return null;
  }
  if (isHlsWatch) {
    const resolved = await resolveHdstream4u(link.url);
    return resolved ? { url: resolved, mime: 'application/vnd.apple.mpegurl' } : null;
  }
  if (link.type === 'hubcloud') {
    const resolved = await resolveHubcloudDrive(link.url);
    return resolved ? { url: resolved, mime: 'video/x-matroska' } : null;
  }
  if (link.type === 'hubcdn') {
    const direct = await resolveHubcdn(link.url);
    return direct ? { url: direct, mime: 'video/x-matroska' } : null;
  }
  if (link.type === 'gdflix') {
    const r = await resolveGdflix(link.url);
    if (r) return { url: r.url, mime: r.type === 'zip' ? 'application/zip' : 'video/x-matroska' };
    return null;
  }
  return null;
}

// Bounded-concurrency map
async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); } catch (e) { out[idx] = null; }
    }
  }));
  return out;
}

// ---------------------------------------------------------------------------
async function getStreams(tmdbId, type, season, episode) {
  tmdbId = String(tmdbId);
  const isTV = type === 'tv';
  console.log('[HDHub4u] Request: tmdb=' + tmdbId + ' type=' + type + (isTV && season ? ' S' + season + 'E' + episode : ''));

  let info;
  try {
    info = await Promise.race([
      getTMDBInfo(tmdbId, type),
      new Promise((_, rej) => setTimeout(() => rej(new Error('TMDB timeout')), 10000)),
    ]);
  } catch (e) { console.log('[HDHub4u] TMDB error: ' + e.message); return []; }
  console.log('[HDHub4u] TMDB: ' + info.title + (info.year ? ' (' + info.year + ')' : ''));

  const results = await searchSite(info.title, info.year);
  if (results.length === 0) { console.log('[HDHub4u] No results'); return []; }
  console.log('[HDHub4u] Found ' + results.length + ' results: ' + results.slice(0, 3).map(r => r.slug).join(' | '));

  // Movie requests: skip season/series posts (slug guard, mirrors vegamovies'
  // seriesLike logic — a "Season 1 all episodes" post is never the movie)
  const SERIES_LIKE = /(season-\d|s\d{1,2}e\d{1,3}|-all-episodes|full-series|complete-series)/i;
  // Task 53b: minimum title match — the slug must contain at least
  // min(2, wordCount) of the requested title's words (word-boundary). A movie
  // post sharing ONE token (darkgame vs "game of thrones") used to sail
  // through when the real post sat outside the sitemap scan window and ship
  // WRONG-CONTENT links under the requested title.
  const minWords = results[0] ? (results[0].minWords || 1) : 1;
  let posts = results.filter(r => (r.hits || 0) >= minWords);
  if (posts.length === 0) { console.log('[HDHub4u] no title-matched posts (min ' + minWords + ' words), refusing misattribution'); return []; }
  if (!isTV) posts = posts.filter(r => !SERIES_LIKE.test(r.slug));
  else {
    // TV requests: prefer series posts; if none carry a series signal, keep
    // title-matched candidates (never movie-only fallbacks like before)
    const seriesPosts = posts.filter(r => SERIES_LIKE.test(r.slug));
    if (seriesPosts.length > 0) posts = seriesPosts;
  }
  posts = posts.slice(0, 3);

  const allStreams = [];
  const seenUrls = new Set();

  // Per-post pipeline, posts processed CONCURRENTLY (old code walked them
  // sequentially — 3 posts × (fetch + parse + serial resolve) blew the budget)
  await Promise.all(posts.map(async (post) => {
    try {
      // Task 53b: post fetch 12s → 15s — ALIGNED TO THE TRUE ORIGINAL REPO
      // (SaugatXthaa/PhoeniX calls fetchText(post.url, referer) with the 15s
      // default + got retry:1). Production: the post page flapped >12s / 503
      // and every movie run died at the fetch ("post failed ... aborted due
      // to timeout") while the scraper itself was healthy.
      const html = await fetchText(post.url, ORIGIN + '/', 15000);
      const { links, h1 } = parsePostLinks(html);
      if (links.length === 0) { console.log('[HDHub4u] 0 links on ' + post.slug); return; }
      console.log('[HDHub4u] ' + links.length + ' links on ' + post.slug);

      // Metadata from the post H1 (site's own text — audio etc.)
      const postAudio = parseAudio(h1 || post.slug.replace(/-/g, ' '));
      const postSource = parseSourceType(h1) || (/webrip/i.test(post.slug) ? 'WebRip' : /bluray/i.test(post.slug) ? 'BluRay' : null);
      const postCodec = parseCodec(h1);

      // greenmotors links first (download editions w/ full labels), then HLS
      const ordered = [...links].sort((a, b) => {
        const rank = (t) => (t === 'greenmotors' ? 0 : t === 'hdstream4u' ? 1 : 2);
        return rank(a.type) - rank(b.type);
      }).slice(0, 12);

      const resolved = await mapPool(ordered, 5, async (link) => {
        try {
          const out = await resolveLink(link);
          if (!out || !out.url || seenUrls.has(out.url)) return null;
          seenUrls.add(out.url);
          const label = link.label || '';
          const quality = parseQuality(label) || parseQuality(h1);
          return {
            url: out.url,
            mime: out.mime,
            quality: quality || '',
            size: parseSize(label),
            codec: parseCodec(label) || postCodec,
            sourceType: parseSourceType(label) || postSource,
            bitDepth: parseBitDepth(label),
            audio: postAudio,
            label: label || post.slug,
          };
        } catch (e) { return null; }
      });

      for (const r of resolved) {
        if (!r) continue;
        allStreams.push(r);
        console.log('[HDHub4u] + ' + (r.quality || '?') + (r.size ? ' ' + r.size : '') + ': ' + r.url.slice(0, 70));
      }
    } catch (e) { console.log('[HDHub4u] post failed: ' + post.slug + ' ' + (e.message || e)); }
  }));

  const qOrder = { '2160p': 0, '1080p': 1, '720p': 2, '480p': 3, '360p': 4 };
  allStreams.sort((a, b) => (qOrder[a.quality] ?? 99) - (qOrder[b.quality] ?? 99));

  console.log('[HDHub4u] ' + allStreams.length + ' streams total');
  return allStreams;
}

module.exports = {
  setTransport, getStreams, getTMDBInfo, searchSite, parsePostLinks,
  parseQuality, parseSize, parseCodec, parseSourceType, parseAudio,
  resolveGreenmotors, resolveHubcloudDrive, resolveHubcdn, resolveHdstream4u, resolveGdflix,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 2) { console.log('Usage: node hdhub4u_v2.cjs <tmdbId> <movie|tv> [season] [episode]'); process.exit(1); }
  getStreams(args[0], args[1], args[2] ? parseInt(args[2]) : null, args[3] ? parseInt(args[3]) : null)
    .then(s => {
      console.log('\n=== Final streams ===');
      s.forEach((x, i) => console.log((i + 1) + '. ' + (x.quality || '?') + ' | ' + (x.size || 'n/a') + ' | ' + (x.sourceType || 'n/a') + ' | ' + (x.codec || 'n/a') + ' | ' + (x.audio || 'n/a') + '\n   ' + x.url.slice(0, 100)));
      console.log('\nTotal: ' + s.length);
    })
    .catch(e => console.error('FATAL: ' + e.stack));
}
