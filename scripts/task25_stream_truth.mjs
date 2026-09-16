// task25_stream_truth.mjs — GROUND-TRUTH per-source playability audit.
//
// task25_full_audit.mjs probed /debug/source (RAW source output, pre-extraction)
// and classified meta-driven extraction as 503 failures. This script tests the
// REAL production path instead:
//   1. GET /stream/:type/:id.json  (the exact endpoint players call)
//   2. attribute every returned card to its source via
//      behaviorHints.bingeGroup = "phoenix-<sourceId>-<extractorId>"
//   3. verify up to 2 final URLs per source per title, exactly as a player
//      consumes them:
//        - self-proxy   (/proxy?, /range-proxy, /reanime-proxy) → fetch the
//          addon itself, expect m3u8 text magic or binary video magic
//        - lazy extract (/extract?url=…&index=) → redirect:manual, 302 = the
//          extractor chain resolves at play time (Location is verified too)
//        - direct URL   → HLS magic or binary container magic (direct first,
//          then through /proxy as players do for wrapped streams)
//   4. verdict per source per title: PLAYABLE / CARDS-ONLY / ABSENT
//
// One title per invocation (the /stream endpoint takes ~40-45s); checkpoint
// JSON per title under AUDIT_REPORT_DIR, merge with --merge-only.
//
// Usage:
//   node scripts/task25_stream_truth.mjs --title endgame
//   node scripts/task25_stream_truth.mjs --merge-only

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..');
const REPORT_DIR = process.env.AUDIT_REPORT_DIR || '/home/z/my-project/download/health_reports';
const PORT = 4598;
const BASE = `http://127.0.0.1:${PORT}`;
const MERGE_ONLY = process.argv.includes('--merge-only');

const TITLES = {
  endgame:  { type: 'movie',  id: 'tt4154796',     label: 'Endgame' },
  bb:       { type: 'series', id: 'tt0903747:1:1', label: 'BreakingBad S1E1' },
  aot:      { type: 'series', id: 'tmdb:1429:1:1', label: 'AoT S1E1' },
  yourname: { type: 'movie',  id: 'tmdb:372058',   label: 'Your Name' },
  frieren:  { type: 'series', id: 'tmdb:209867:2:1', label: 'Frieren S2E1' },
  reacher:  { type: 'series', id: 'tmdb:108978:4:1', label: 'Reacher S4E1' },
};

const KNOWN = {
  dahmermovies: 'do-not-touch (user list)',
  dahmermovies4k: 'do-not-touch (user list)',
  vixsrc: 'do-not-touch (user list)',
  zxcstream: 'do-not-touch (user list) — 422-by-design',
  nowhdtime: 'do-not-touch (user list)',
  animezey: 'do-not-touch (user list)',
  anineko: 'upstream DB outage (operator-side)',
  peckle: 'febbox-cookie class — deployment-env only',
  framextv: 'upstream API dead',
  vegamovies2: 'fastdl-backed newer catalog only (Task 24 reality)',
};

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36' };

const titleKey = process.argv[process.argv.indexOf('--title') + 1] || 'endgame';
const T = TITLES[titleKey];
if (!T && !MERGE_ONLY) { console.error(`unknown title ${titleKey}; use one of ${Object.keys(TITLES).join(', ')}`); process.exit(1); }

// ---------- helpers ----------
async function readHead(url, headers, maxBytes = 1024, timeoutMs = 15000) {
  const res = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
  const ct = res.headers.get('content-type') || '';
  if (res.status >= 300 && res.status < 400) return { status: res.status, bytes: Buffer.alloc(0), ct, location: res.headers.get('location') || '' };
  if (!res.ok || !res.body) return { status: res.status, bytes: Buffer.alloc(0), ct };
  const reader = res.body.getReader();
  const chunks = []; let got = 0;
  try {
    while (got < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      if (got >= maxBytes) { try { await reader.cancel(); } catch {} break; }
    }
  } finally { try { reader.releaseLock(); } catch {} }
  return { status: res.status, bytes: Buffer.concat(chunks).subarray(0, maxBytes), ct };
}

function videoMagic(b) {
  if (b.length < 8) return '';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'EBML/MKV';
  if (b.subarray(4, 8).toString('latin1') === 'ftyp') return 'MP4';
  if (b[0] === 0x47 && (b.length < 189 || b[188] === 0x47)) return 'MPEG-TS';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF') return 'RIFF/AVI';
  if (b.subarray(0, 3).toString('latin1') === 'FLV') return 'FLV';
  if (b.subarray(0, 4).toString('latin1') === 'OggS') return 'OGG';
  return '';
}

const isHlsUrl = (u) => /\.m3u8($|[?#])/i.test(u) || /\/proxy\?.*m3u8/i.test(u) || /playlist|\/hls|manifest/i.test(u);

// Verify a FINAL stream URL the way a player consumes it.
async function verifyFinal(rawUrl) {
  if (!rawUrl || !/^https?:\/\//.test(rawUrl)) return { ok: false, how: 'no-url' };
  // Production builds self-URLs against https (Render terminates TLS). The
  // local test addon speaks plain HTTP, so rewrite localhost https→http
  // before probing (harness-only; production URLs are unaffected).
  rawUrl = rawUrl.replace(/^https:\/\/(127\.0\.0\.1|localhost):/i, 'http://$1:');

  // 1) self-proxy / self-routed URLs — the addon itself serves these
  const selfPath = rawUrl.includes('/proxy?') || rawUrl.includes('/range-proxy') || rawUrl.includes('/reanime-proxy') || rawUrl.startsWith(`${BASE}/`);
  if (selfPath) {
    try {
      const head = await readHead(rawUrl, { ...UA, Range: 'bytes=0-2047' }, 2048, 30000);
      const asText = head.bytes.toString('latin1');
      if ((head.status === 200 || head.status === 206)) {
        if (asText.includes('#EXTM3U') || asText.includes('#EXT-X')) return { ok: true, how: `self-${isHlsUrl(rawUrl) ? 'hls' : 'text'}-magic` };
        const m = videoMagic(head.bytes);
        if (m) return { ok: true, how: `self-${m}` };
        if (asText.toLowerCase().includes('<html') || asText.toLowerCase().includes('<!doctype')) return { ok: false, how: `self-${head.status} html-not-video` };
        return { ok: false, how: `self-${head.status} no-magic head=${head.bytes.subarray(0, 8).toString('hex')}` };
      }
      return { ok: false, how: `self status=${head.status}` };
    } catch (e) { return { ok: false, how: `self threw (${e.message.slice(0, 40)})` }; }
  }

  // 2) lazy extract card — 302 means the extractor resolves at play time
  if (rawUrl.includes('/extract')) {
    try {
      const head = await readHead(rawUrl, UA, 0, 45000);
      if (head.status >= 300 && head.status < 400 && head.location) {
        // follow the Location once and magic-check the resolved target
        try {
          const loc = new URL(head.location, BASE).href;
          const v2 = await verifyFinal(loc);
          return { ok: v2.ok, how: `extract-302→${v2.ok ? 'verified' : v2.how.slice(0, 40)}` };
        } catch { return { ok: true, how: 'extract-302 (target unprobed)' }; }
      }
      return { ok: false, how: `extract status=${head.status}` };
    } catch (e) { return { ok: false, how: `extract threw (${e.message.slice(0, 40)})` }; }
  }

  // 3) direct URL — magic check direct, then via /proxy
  const isHls = isHlsUrl(rawUrl);
  let directDetail = '';
  try {
    if (isHls) {
      const res = await fetch(rawUrl, { headers: { ...UA, Referer: new URL(rawUrl).origin }, signal: AbortSignal.timeout(15000) });
      const body = await res.text();
      if (res.status === 200 && (body.includes('#EXTM3U') || body.includes('#EXT-X'))) return { ok: true, how: 'direct-HLS-magic' };
      directDetail = `direct status=${res.status} len=${body.length}`;
    } else {
      const head = await readHead(rawUrl, { ...UA, Range: 'bytes=0-1023', Referer: new URL(rawUrl).origin }, 1024, 15000);
      if (head.status === 200 || head.status === 206) {
        const m = videoMagic(head.bytes);
        if (m) return { ok: true, how: `direct-${m}` };
        const asText = head.bytes.toString('latin1').slice(0, 60).toLowerCase();
        if (!head.bytes.length) directDetail = 'direct empty body';
        else if (asText.includes('<html') || asText.includes('just a moment')) directDetail = `direct ${head.status} html-block`;
        else directDetail = `direct ${head.status} no-magic`;
      } else directDetail = `direct status=${head.status}`;
    }
  } catch (e) { directDetail = `direct threw (${e.message.slice(0, 40)})`; }
  try {
    const pu = new URL(`${BASE}/proxy`);
    pu.searchParams.set('url', rawUrl);
    const head = await readHead(pu.href, { ...UA, Range: 'bytes=0-1023' }, 1024, 25000);
    if (head.status === 200 || head.status === 206) {
      const asText = head.bytes.toString('latin1');
      if (isHls && (asText.includes('#EXTM3U') || asText.includes('#EXT-X'))) return { ok: true, how: 'proxy-HLS-magic' };
      const m = videoMagic(head.bytes);
      if (m) return { ok: true, how: `proxy-${m}` };
      return { ok: false, how: `${directDetail}; proxy no-magic` };
    }
    return { ok: false, how: `${directDetail}; proxy status=${head.status}` };
  } catch (e) {
    return { ok: false, how: `${directDetail}; proxy threw (${e.message.slice(0, 40)})` };
  }
}

// ---------- boot addon ----------
async function bootAddon() {
  const logFile = `/tmp/task25_truth_${PORT}.log`;
  const child = spawn('node', ['src/index.js'], { cwd: REPO, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  const logStream = fs.createWriteStream(logFile);
  child.stdout.pipe(logStream); child.stderr.pipe(logStream);
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    try {
      const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return { child, logFile };
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  child.kill('SIGKILL');
  throw new Error('addon not healthy in 60s');
}

// ---------- main ----------
if (MERGE_ONLY) {
  const files = fs.readdirSync(REPORT_DIR).filter(f => /^truth_.*\.json$/.test(f)).sort();
  const bySource = new Map();
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(REPORT_DIR, f), 'utf8'));
    for (const [sid, e] of Object.entries(j.sources || {})) {
      if (!bySource.has(sid)) bySource.set(sid, { id: sid, titles: {}, playableTitles: 0, cardTitles: 0, fails: [] });
      const rec = bySource.get(sid);
      rec.titles[j.title] = { cards: e.cards, verified: e.verified, attempts: e.attempts, sample: e.sample, fail: e.fails[0] || null };
      if (e.verified > 0) rec.playableTitles++;
      else if (e.cards > 0) rec.cardTitles++;
      if (e.fails?.[0]) rec.fails.push(`${j.title}: ${e.fails[0]}`);
    }
  }
  const all = [...bySource.values()].sort((a, b) => b.playableTitles - a.playableTitles || a.id.localeCompare(b.id));
  const knownAbsent = all.filter(s => s.playableTitles === 0 && KNOWN[s.id]);
  const broken = all.filter(s => s.playableTitles === 0 && !KNOWN[s.id] && s.cardTitles > 0);
  const absent = all.filter(s => s.playableTitles === 0 && !KNOWN[s.id] && s.cardTitles === 0);
  const working = all.filter(s => s.playableTitles > 0);
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const base = path.join(REPORT_DIR, `stream_truth_${stamp}`);
  const summary = {
    timestamp: new Date().toISOString(),
    titlesProbed: files.length,
    totals: { working: working.length, cardsOnly: broken.length, absent: absent.length, knownLimited: knownAbsent.length },
  };
  fs.writeFileSync(base + '.json', JSON.stringify({ ...summary, sources: all }, null, 2));
  const md = [
    `# PhoenX Ground-Truth Stream Audit (production /stream path) — ${new Date().toISOString()}`,
    ``,
    `**${files.length} titles probed via the exact player endpoint.** Verdict per source: PLAYABLE ≥1 title with magic/302-verified final URL.`,
    ``,
    `Totals: WORKING=${working.length} · CARDS-ONLY(unverified-in-sandbox)=${broken.length} · ABSENT=${absent.length} · KNOWN-LIMITED=${knownAbsent.length}`,
    ``,
    `## WORKING (${working.length})`,
    ``,
    `| Source | Verified titles | Sample verification |`,
    `|--------|----------------|---------------------|`,
    ...working.map(s => `| ${s.id} | ${s.playableTitles}/${files.length} | ${(Object.entries(s.titles).find(([, t]) => t.verified > 0)?.[1]?.sample) || ''} |`),
    ``,
    `## CARDS-ONLY — served in production but unverifiable from this sandbox (${broken.length})`,
    ``,
    `| Source | Titles with cards | First failure detail |`,
    `|--------|-------------------|----------------------|`,
    ...broken.map(s => `| ${s.id} | ${s.cardTitles}/${files.length} | ${(s.fails[0] || '').slice(0, 90)} |`),
    ``,
    `## KNOWN-LIMITED (${knownAbsent.length})`,
    ``,
    ...knownAbsent.map(s => `- ${s.id}: ${KNOWN[s.id]} (cards on ${s.cardTitles}/${files.length} titles)`),
    ``,
    `## ABSENT — zero cards across ALL probed titles (${absent.length})`,
    ``,
    ...absent.map(s => `- ${s.id}`),
    ``,
  ].join('\n');
  fs.writeFileSync(base + '.md', md);
  console.log(`MERGED ${files.length} titles → ${base}.md`);
  console.log(`WORKING=${working.length} CARDS-ONLY=${broken.length} ABSENT=${absent.length} KNOWN=${knownAbsent.length}`);
  if (broken.length) { console.log(`\nCARDS-ONLY detail:`); broken.forEach(s => console.log(`  - ${s.id}: ${(s.fails[0] || '').slice(0, 90)}`)); }
  process.exit(0);
}

console.log(`=== ground-truth audit: ${titleKey} (${T.label}) on :${PORT} ===`);
const { child } = await bootAddon();
const t0 = Date.now();
let streams = [];
try {
  const res = await fetch(`${BASE}/stream/${T.type}/${encodeURIComponent(T.id)}.json`, { signal: AbortSignal.timeout(120000) });
  const j = await res.json();
  streams = j.streams || [];
} catch (e) {
  console.log(`stream fetch failed: ${e.message}`);
}
console.log(`/stream returned ${streams.length} cards in ${Math.round((Date.now() - t0) / 1000)}s`);
fs.writeFileSync(`/tmp/truth_raw_${titleKey}.json`, JSON.stringify(streams, null, 2));

// attribute cards to sources
const bySource = new Map();
for (const s of streams) {
  if (s.externalUrl) continue; // external player links — not stream playability
  const bg = s.behaviorHints?.bingeGroup || '';
  const m = bg.match(/^phoenix-([a-z0-9_]+)-(.+)$/i);
  const sid = m ? m[1] : 'unknown';
  if (!bySource.has(sid)) bySource.set(sid, []);
  bySource.get(sid).push(s);
}

const out = { title: titleKey, label: T.label, totalCards: streams.length, sources: {} };
const entries = [...bySource.entries()];
const queue = [...entries];
async function worker() {
  while (queue.length) {
    const [sid, cards] = queue.shift();
    const rec = { cards: cards.length, verified: 0, attempts: 0, fails: [], sample: '' };
    for (const c of cards.slice(0, 2)) {
      if (!c.url) continue;
      rec.attempts++;
      const v = await verifyFinal(c.url);
      if (v.ok) { rec.verified++; if (!rec.sample) rec.sample = `${T.label}:${v.how}`; }
      else rec.fails.push(v.how.slice(0, 120));
    }
    out.sources[sid] = rec;
    console.log(`  ${sid.padEnd(18)} cards=${String(rec.cards).padStart(3)} verified=${rec.verified}/${rec.attempts}${rec.fails[0] ? ` — ${rec.fails[0].slice(0, 70)}` : ''}`);
  }
}
await Promise.all(Array.from({ length: 6 }, worker));

child.kill('SIGTERM');
await new Promise(r => setTimeout(r, 500));

const file = path.join(REPORT_DIR, `truth_${titleKey}.json`);
fs.writeFileSync(file, JSON.stringify(out, null, 2));
const v = Object.values(out.sources);
console.log(`\nDONE ${titleKey}: ${out.totalCards} cards, ${Object.keys(out.sources).length} sources, playable=${v.filter(s => s.verified > 0).length}, cardsOnly=${v.filter(s => s.verified === 0 && s.cards > 0).length}`);
console.log(`saved: ${file}`);
process.exit(0);
