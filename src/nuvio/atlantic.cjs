// src/nuvio/atlantic.cjs — Atlantic (atlantic.st) provider (Task 48 clean rewrite)
//
// Reverse engineering trail (verified live 2026-09-17):
//   https://atlantic.st/            → React SPA (Vite build), TMDB-driven catalog.
//                                     Player code lives in assets/index-BWLBkgfa.js;
//                                     request signing in assets/aphrodite-gate-*.js.
//   Stream servers (2, verbatim from the bundle):
//     Artemis   — GET https://stellar.maybeoneday.ch/resolve
//                   ?tmdbId=<tmdb>&type=movie|tv[&season=&episode=]
//                 → {found, format:"hls", source:"Orbit"|"Nova", url}
//                 NO signing. The server picks the source itself (the
//                 availableSources array is informational; a &source= param is
//                 ignored — verified). Orbit = movies/TV fMP4 up to 2160p with
//                 separate audio groups; Nova = anime/TV muxed up to 1080p.
//     Aphrodite — GET https://cdn.maybeoneday.ch/content/movie/<tmdb>
//                             https://cdn.maybeoneday.ch/content/tv/<tmdb>/<s>/<e>
//                 → {found, type:"hls", hls?|url, title, renew?}
//                 CURATED content (spotty coverage — Dune2/BB yes, Inception no)
//                 single 4K variant master. SIGNED — aphrodite.a.v1 gate:
//
//   Gate protocol (deobfuscated from aphrodite-gate-BsVicaYl.js, webcrack):
//     seed[W]    = M[b + W*2] ^ X[W]                      (M=64B table, X=32B, b=1, s=2)
//     masterKey  = SHA256("aphrodite.a.v1" || seed)
//     session    = POST /content/index {c:"a", ts, n:<8B hex>, s:HMAC(masterKey,"a|ts|n")}
//                  → {d:<hex>} = AES-256-GCM(iv 12B || ct || tag 16B) with masterKey
//                  → JSON {sid, skey:<hex>, exp}
//     per request: X-A-Sid, X-A-Ts, X-A-Nonce(8B hex),
//                  X-A-Sig = HMAC-SHA256(skey, sid|path|ts|nonce)   (path ONLY)
//     client resets the session on response renew:true (mirror: also on 401/403)
//
//   CDN hotlink gates (verified live): both peraspera.nbsycfzrpa4.workers.dev
//   (Artemis) and totallyacdn.org (Aphrodite) answer 200 text/html decoys to
//   UA-only requests — they require Origin/Referer https://atlantic.st. Cards
//   carry headers {Origin, Referer, User-Agent} → NuvioExtractor routes them
//   through /proxy with referer= + origin= (+ forceHls=1, URLs are ambiguous)
//   and the proxy propagates both onto the whole rewritten m3u8 tree.
//
//   Subtitles (the site's 3-provider stack; all fetched per play):
//     granite  — GET https://sub.vdrk.site/v1/movie/<tmdb> | /v1/tv/<tmdb>/<s>/<e>
//                → [{label:"Arabic Hi5"|..., file:"https://cache.vdrk.site/...vtt"}]
//                VTT, header-free (UA-only verified 200). "Hi"/"HiN" label
//                suffix = hearing-impaired (site convention).
//     natsuki  — GET https://natsuki.maybeoneday.ch/subs?tmdbId=&[season&episode]
//                     (also imdbId= variant; tmdbId path preferred, verified)
//                → {subtitles:[{sid,language,langCode,url,fileName,hearingImpaired}]}
//                SRT files — Origin/Referer GATED (403 UA-only) → sub URLs are
//                wrapped through the addon's own /proxy (referer+origin params)
//                so players can actually fetch them.
//     opensubs — VLSub rest.opensubtitles.org path exists in the bundle but the
//                addon already has OpenSubtitles fallback injection for streams
//                without meta.subtitles — skipped here to avoid double work.
//
// Metadata honesty: quality labels come from parsed master RESOLUTION lines,
// server names (Artemis/Orbit/Nova/Aphrodite) from the site's own bundle,
// audio-track counts from EXT-X-MEDIA lines. Nothing guessed, no fabricated
// sizes (HLS byte totals are not estimable — same policy as cineby Task 40).

'use strict';

const crypto = require('crypto');

const ATLANTIC_ORIGIN = 'https://atlantic.st';
const CDN = 'https://cdn.maybeoneday.ch';
const ARTEMIS = 'https://stellar.maybeoneday.ch/resolve';
const GRANITE_API = 'https://sub.vdrk.site/v1';
const NATSUKI_API = 'https://natsuki.maybeoneday.ch/subs';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const HEADERS = {
  'User-Agent': UA,
  'Origin': ATLANTIC_ORIGIN,
  'Referer': `${ATLANTIC_ORIGIN}/`,
};

const MASTER_TIMEOUT_MS = 9000;
const SUBS_TIMEOUT_MS = 6000;

// Subtitle caps — Stremio renders one selector per stream; the site exposes
// 90-230 files per title (per-release duplicates). Keep every granite language
// once (VTT, direct), then fill remaining slots with natsuki languages the
// granite set lacks (one file per language).
const MAX_SUBS = 48;
const MAX_GRANITE_SUBS = 32;

// ─── Language table — verbatim from the site bundle (name → ISO code) ───
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

// ─── Aphrodite gate (aphrodite.a.v1) ───
const GATE_M = new Uint8Array([152, 159, 215, 12, 139, 229, 103, 92, 79, 156, 87, 240, 161, 70, 97, 40, 218, 79, 171, 72, 9, 177, 171, 147, 62, 249, 164, 146, 201, 90, 184, 204, 237, 159, 162, 35, 55, 32, 234, 114, 164, 188, 27, 63, 151, 213, 4, 92, 117, 56, 136, 58, 252, 220, 222, 69, 186, 144, 227, 223, 214, 102, 114, 251]);
const GATE_X = new Uint8Array([223, 178, 166, 138, 172, 171, 123, 225, 225, 38, 113, 78, 41, 179, 108, 148, 174, 227, 135, 224, 100, 253, 252, 79, 116, 151, 43, 67, 103, 203, 90, 249]);
const GATE_LABEL = 'a';
const GATE_UA_STRING = 'aphrodite.a.v1';

const gateSeed = (() => {
  const out = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) out[i] = GATE_M[1 + i * 2] ^ GATE_X[i];
  return out;
})();
const gateMasterKey = crypto.createHash('sha256')
  .update(Buffer.concat([Buffer.from(GATE_UA_STRING, 'utf8'), gateSeed]))
  .digest();

let gateSession = null;       // { sid, skey:<Buffer>, exp }
let gateInFlight = null;      // single-flight bootstrap

function gateReset() {
  gateSession = null;
}

async function gateBootstrap() {
  const ts = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(8).toString('hex');
  const sig = crypto.createHmac('sha256', gateMasterKey).update(`${GATE_LABEL}|${ts}|${nonce}`).digest('hex');
  const res = await fetch(`${CDN}/content/index`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...HEADERS },
    body: JSON.stringify({ c: GATE_LABEL, ts, n: nonce, s: sig }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`gate bootstrap HTTP ${res.status}`);
  const j = await res.json();
  if (!j || !j.d) throw new Error('gate bootstrap missing payload');
  const blob = Buffer.from(j.d, 'hex');
  if (blob.length < 28) throw new Error('gate payload too short');
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(blob.length - 16);
  const d = crypto.createDecipheriv('aes-256-gcm', gateMasterKey, iv);
  d.setAuthTag(tag);
  const plain = Buffer.concat([d.update(blob.subarray(12, blob.length - 16)), d.final()]);
  const obj = JSON.parse(plain.toString('utf8'));
  if (!obj || !obj.sid || !obj.skey) throw new Error('gate session missing fields');
  return { sid: String(obj.sid), skey: Buffer.from(String(obj.skey), 'hex'), exp: Number(obj.exp) || 0 };
}

async function gateGetSession() {
  const now = Math.floor(Date.now() / 1000);
  if (gateSession && gateSession.exp - now > 60 && gateSession.skey.length === 32) return gateSession;
  if (!gateInFlight) {
    gateInFlight = gateBootstrap()
      .then((s) => { gateSession = s; return s; })
      .finally(() => { gateInFlight = null; });
  }
  return gateInFlight;
}

function gateSignHeaders(sess, path) {
  const ts = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(8).toString('hex');
  const sig = crypto.createHmac('sha256', sess.skey).update(`${sess.sid}|${path}|${ts}|${nonce}`).digest('hex');
  return {
    'X-A-Sid': sess.sid,
    'X-A-Ts': String(ts),
    'X-A-Nonce': nonce,
    'X-A-Sig': sig,
  };
}

// Signed GET — one renew/401/403-triggered session reset + retry (mirrors the
// client's renew flow; the wasm-less sibling of cinejoy's 404→refresh-retry).
async function gateGet(path) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let sess;
    try {
      sess = await gateGetSession();
    } catch {
      return null; // bootstrap down — nothing this source can do
    }
    let res;
    try {
      res = await fetch(`${CDN}${path}`, {
        headers: { ...gateSignHeaders(sess, path), ...HEADERS },
        signal: AbortSignal.timeout(MASTER_TIMEOUT_MS),
      });
    } catch {
      return null;
    }
    if (res.status === 401 || res.status === 403) {
      gateReset();
      continue; // fresh session, retry once
    }
    if (!res.ok) return null; // 404 = not on Aphrodite (curated catalog)
    let j;
    try { j = await res.json(); } catch { return null; }
    if (!j || typeof j !== 'object') return null;
    if (j.renew === true) {
      gateReset();
      if (attempt === 0) continue;
      return null;
    }
    return j;
  }
  return null;
}

// ─── Stream servers ───

async function resolveArtemis(tmdbId, type, season, episode) {
  const q = new URLSearchParams();
  q.set('tmdbId', String(tmdbId));
  q.set('type', type);
  if (type === 'tv') {
    q.set('season', String(season || 1));
    q.set('episode', String(episode || 1));
  }
  try {
    const res = await fetch(`${ARTEMIS}?${q.toString()}`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(MASTER_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const j = await res.json();
    if (!j || j.found !== true || typeof j.url !== 'string' || !/^https?:\/\//.test(j.url)) return null;
    return { url: j.url, server: String(j.source || 'Artemis') };
  } catch {
    return null;
  }
}

async function resolveAphrodite(tmdbId, type, season, episode) {
  const path = type === 'tv'
    ? `/content/tv/${tmdbId}/${season || 1}/${episode || 1}`
    : `/content/movie/${tmdbId}`;
  const j = await gateGet(path);
  if (!j || j.found !== true) return null;
  const url = (typeof j.hls === 'string' && j.hls) || (j.type === 'hls' && typeof j.url === 'string' ? j.url : '');
  if (!url || !/^https?:\/\//.test(url)) return null;
  return { url, server: 'Aphrodite', title: typeof j.title === 'string' ? j.title : '' };
}

// ─── Master playlist parsing ───
// Returns { variants:[{h, bw, codecs, uri}], audioTracks:[names], separateAudio }
function parseMaster(text) {
  const lines = String(text || '').split('\n');
  const variants = [];
  const audioTracks = [];
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (L.startsWith('#EXT-X-MEDIA:')) {
      if (/TYPE=AUDIO/.test(L)) {
        const name = /NAME="([^"]*)"/.exec(L)?.[1];
        if (name) audioTracks.push(name);
      }
      continue;
    }
    if (L.startsWith('#EXT-X-STREAM-INF:')) {
      const res = /RESOLUTION=(\d+)x(\d+)/.exec(L);
      const bw = /BANDWIDTH=(\d+)/.exec(L);
      const codecs = /CODECS="([^"]*)"/.exec(L)?.[1] || '';
      let uri = '';
      for (let k = i + 1; k < lines.length; k++) {
        if (lines[k].trim() && !lines[k].startsWith('#')) { uri = lines[k].trim(); break; }
      }
      if (uri) variants.push({ h: res ? parseInt(res[2], 10) : 0, bw: bw ? parseInt(bw[1], 10) : 0, codecs, uri });
    }
  }
  return {
    variants: variants.sort((a, b) => b.h - a.h || b.bw - a.bw),
    audioTracks,
    separateAudio: audioTracks.length > 0,
  };
}

// Muxed check: every variant declares an audio codec inside CODECS (Nova style:
// "mp4a.40.2,avc1.640028") → children carry their own audio → per-variant
// cards are safe. Separated-audio masters (AUDIO="audio" group, video-only
// children — verified: Orbit init segments carry a video trak only) MUST ship
// as the master so players keep the audio-group context.
function isMuxedVariants(parsed) {
  if (parsed.separateAudio) return false;
  if (parsed.variants.length === 0) return false;
  return parsed.variants.every(v => /mp4a|ac-3|ec-3|opus|vorbis/i.test(v.codecs));
}

// ─── Live validation ("only add if it works") ───
// Upstream serves decoy/stub manifests in some windows (verified live: the
// Aphrodite Dune2 payload returned a 345-byte 8-segment TS stub whose
// root-relative segment URLs 400 — unplayable on the real site too). Cards are
// shipped ONLY when the exact bytes players will need validate.

// A child/variant playlist must be an m3u8 with at least one playable line.
async function validatePlaylistChild(url) {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(MASTER_TIMEOUT_MS) });
    if (!res.ok) return false;
    const body = await res.text();
    if (!body.startsWith('#EXTM3U')) return false;
    return body.split('\n').some(l => l.trim() && !l.startsWith('#'));
  } catch { return false; }
}

// First bytes of a media segment — TS sync byte or fMP4 box magic. Reads at
// most 4KB (Range, with body-cancel fallback for Range-hostile CDNs).
async function probeSegmentMagic(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), MASTER_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { ...HEADERS, Range: 'bytes=0-4095' }, signal: ac.signal });
    if (!res.ok && res.status !== 206) return false;
    const reader = res.body.getReader();
    const { value } = await reader.read();
    try { await reader.cancel(); } catch { /* already closed */ }
    if (!value || value.length < 4) return false;
    if (value[0] === 0x47 && value[188] === 0x47) return true; // MPEG-TS
    const magic = value.subarray(4, 8).toString('latin1');
    return magic === 'ftyp' || magic === 'styp' || magic === 'moov'; // fMP4/MP4
  } catch { return false; } finally { clearTimeout(timer); }
}

function qualityLabel(h) {
  if (h >= 2160) return '2160p';
  if (h >= 1080) return '1080p';
  if (h >= 720) return '720p';
  if (h >= 480) return '480p';
  if (h > 0) return `${h}p`;
  return 'Auto';
}

// ─── Subtitles ───

async function fetchGraniteSubs(tmdbId, type, season, episode) {
  const path = type === 'tv'
    ? `${GRANITE_API}/tv/${tmdbId}/${season || 1}/${episode || 1}`
    : `${GRANITE_API}/movie/${tmdbId}`;
  try {
    const res = await fetch(path, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(SUBS_TIMEOUT_MS) });
    if (!res.ok) return [];
    const arr = await res.json();
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const item of arr) {
      if (!item || typeof item.file !== 'string' || typeof item.label !== 'string') continue;
      // Site convention: "Arabic Hi5" / "English hi" = hearing-impaired track.
      // Trailing digits are distinct site variants ("Arabic2" ≠ "Arabic") —
      // keep them as a display suffix so Stremio shows unique track names.
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
// player can fetch them (hostUrl passed in from the wrapper's ctx).
// Both queries (tmdbId + imdbId) fire in PARALLEL with a 5s cap — the site's
// sequential fallback once burned 12s on a title whose tmdbId path hung.
// Preference: tmdbId result, then imdbId result (site order).
async function fetchNatsukiSubs(tmdbId, imdbId, type, season, episode, hostUrl) {
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
      const res = await fetch(`${NATSUKI_API}?${q.toString()}`, { headers: HEADERS, signal: AbortSignal.timeout(5000) });
      if (!res.ok) return [];
      const j = await res.json();
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
      // (verified live: same-title files answer 200 and 502 alternately). If
      // even the first file fails, drop the whole natsuki set rather than ship
      // dead subtitle tracks; granite (stable, direct VTT) still covers the
      // common languages.
      if (out.length > 0) {
        const sampleUrl = subs.find(s => s && typeof s.url === 'string' && s.url)?.url;
        const ok = sampleUrl ? await probeSubFile(sampleUrl) : false;
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
async function probeSubFile(url) {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(3000) });
    return res.ok;
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

// ─── TMDB fallback (wrapper normally preloads title/year/imdbId) ───
async function getTmdbMeta(tmdbId, mediaType) {
  const type = mediaType === 'tv' ? 'tv' : 'movie';
  const key = process.env.TMDB_API_KEY || '439c478a771f35c05022f9feabcca01c';
  try {
    const res = await fetch(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${key}&append_to_response=external_ids`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return {
      title: (type === 'tv' ? j.name : j.title) || '',
      year: ((type === 'tv' ? j.first_air_date : j.release_date) || '').slice(0, 4),
      imdbId: j.external_ids?.imdb_id || '',
    };
  } catch {
    return null;
  }
}

// ─── Main ───
// getStreams(tmdbId, mediaType, season, episode, preloaded)
// preloaded: { title, year, imdbId, hostUrl } — hostUrl enables natsuki
// proxy-wrapping. Returns nuvio stream objects for buildStreamResults.
async function getStreams(tmdbId, mediaType, season, episode, preloaded) {
  try {
    const type = mediaType === 'tv' ? 'tv' : 'movie';
    const id = parseInt(tmdbId, 10);
    if (!id) return [];

    let imdbId = preloaded?.imdbId || '';
    if (!imdbId) {
      const meta = await getTmdbMeta(id, type);
      if (meta?.imdbId) imdbId = meta.imdbId;
    }

    // Everything in parallel — servers, subs, no serial chains. Each step is
    // independently skippable; a failure never blocks the others.
    const t0 = Date.now();
    const timed = (label, p) => p.then(v => {
      const desc = v === null || v === undefined ? 'null'
        : Array.isArray(v) ? `${v.length} items`
        : (v && v.kind) ? v.kind : 'ok';
      console.log(`[Atlantic] ${label}: ${desc} +${Date.now() - t0}ms`);
      return v;
    });

    const artemisP = resolveArtemis(id, type, season, episode);
    const aphroditeP = resolveAphrodite(id, type, season, episode);
    // Both master fetches depend on their resolve; chain them.
    const artemisMasterP = artemisP.then(async (a) => {
      if (!a) return null;
      try {
        const res = await fetch(a.url, { headers: HEADERS, signal: AbortSignal.timeout(MASTER_TIMEOUT_MS) });
        if (!res.ok) return null;
        const body = await res.text();
        if (!body.startsWith('#EXTM3U')) return null;
        return { ...a, parsed: parseMaster(body) };
      } catch { return null; }
    });
    const aphroditeMasterP = aphroditeP.then(async (a) => {
      if (!a) return null;
      try {
        const res = await fetch(a.url, { headers: HEADERS, signal: AbortSignal.timeout(MASTER_TIMEOUT_MS) });
        if (!res.ok) return null;
        const body = await res.text();
        if (!body.startsWith('#EXTM3U')) return null;
        return { ...a, body, parsed: parseMaster(body) };
      } catch { return null; }
    });
    const graniteP = fetchGraniteSubs(id, type, season, episode);
    const natsukiP = fetchNatsukiSubs(id, imdbId, type, season, episode, preloaded?.hostUrl);

    const [artemisMaster, aphroditeMaster, granite, natsuki] = await Promise.all([
      timed('artemis', artemisMasterP),
      timed('aphrodite', aphroditeMasterP),
      timed('granite', graniteP),
      timed('natsuki', natsukiP),
    ]);
    const subs = mergeSubs(granite, natsuki);

    // Validate + emit. Orbit-style masters: the top child playlist is the
    // bytes the player hits first — verify it. Aphrodite-style flat media
    // playlists (no variants): verify the first segment's magic bytes, else
    // skip (stub manifests ship broken segments). Nova muxed variants: verify
    // each child playlist, ship only validated ones.
    const streams = [];
    const seen = new Set();
    const push = (url, quality, title, subtitles) => {
      if (!url || !/^https?:\/\//.test(url) || seen.has(url)) return;
      seen.add(url);
      streams.push({
        url,
        quality,
        title,
        name: 'Atlantic',
        headers: HEADERS,
        subtitles: subtitles || [],
      });
    };

    // — Artemis (Orbit/Nova) —
    if (artemisMaster && artemisMaster.parsed) {
      const { variants, audioTracks, separateAudio } = artemisMaster.parsed;
      if (variants.length > 0) {
        const maxH = variants[0].h;
        const audioNote = audioTracks.length > 1
          ? `, ${audioTracks.length} audio tracks (player audio menu)`
          : (audioTracks.length === 1 ? ', 1 audio track' : '');
        if (separateAudio || !isMuxedVariants(artemisMaster.parsed)) {
          // Master card — players pick quality (and audio) natively. Children
          // are video-only renditions here; bare variant URLs would be silent.
          const topChildOk = variants[0].uri ? await validatePlaylistChild(variants[0].uri) : false;
          console.log(`[Atlantic] artemis top-child validation: ${topChildOk ? 'ok' : 'FAIL'} +${Date.now() - t0}ms`);
          if (topChildOk) {
            push(artemisMaster.url, qualityLabel(maxH), `${artemisMaster.server} — Auto (up to ${qualityLabel(maxH)})${audioNote}`, subs);
          }
        } else {
          // Muxed children — per-variant cards, each validated
          const perH = new Map();
          for (const v of variants) { if (!perH.has(v.h) || perH.get(v.h).bw < v.bw) perH.set(v.h, v); }
          const top = [...perH.values()].sort((a, b) => b.h - a.h).slice(0, 4);
          const verdicts = await Promise.all(top.map(v => validatePlaylistChild(v.uri)));
          top.forEach((v, i) => {
            if (verdicts[i]) push(v.uri, qualityLabel(v.h), `${artemisMaster.server} — ${qualityLabel(v.h)}`, subs);
          });
        }
      }
    }

    // — Aphrodite —
    if (aphroditeMaster && aphroditeMaster.parsed) {
      const { variants, audioTracks } = aphroditeMaster.parsed;
      if (variants.length > 0) {
        // Real master (probed earlier: single 2160p variant + audio group)
        const topChildOk = variants[0].uri ? await validatePlaylistChild(variants[0].uri) : false;
        if (topChildOk) {
          const audioNote = audioTracks.length > 1 ? `, ${audioTracks.length} audio tracks` : '';
          push(aphroditeMaster.url, qualityLabel(variants[0].h), `Aphrodite — ${qualityLabel(variants[0].h)}${audioNote}`, subs);
        }
      } else if (/#EXTINF/.test(aphroditeMaster.body)) {
        // Flat media playlist — validate first segment before shipping
        const firstSeg = aphroditeMaster.body.split('\n')
          .map(l => l.trim()).find(l => l && !l.startsWith('#'));
        let segUrl = null;
        try { if (firstSeg) segUrl = new URL(firstSeg, aphroditeMaster.url).href; } catch { segUrl = null; }
        const segOk = segUrl ? await probeSegmentMagic(segUrl) : false;
        console.log(`[Atlantic] aphrodite media-playlist validation: ${segOk ? 'ok' : 'FAIL'} +${Date.now() - t0}ms`);
        if (segOk) {
          push(aphroditeMaster.url, 'Auto', 'Aphrodite — Auto', subs);
        }
      }
    }

    // 4K first (Stremio renders cards top-down)
    streams.sort((a, b) => {
      const rank = (q) => { const m = /(\d{3,4})/.exec(String(q)); return m ? parseInt(m[1], 10) : 0; };
      return rank(b.quality) - rank(a.quality);
    });
    return streams;
  } catch (e) {
    console.error('[Atlantic]', e?.message || e);
    return [];
  }
}

module.exports = { getStreams, gateReset };
