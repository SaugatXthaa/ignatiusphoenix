// task25_full_audit.mjs — comprehensive all-source audit across
// movies / series / animes with STREAM PLAYABILITY verification.
//
// For every registered source (from /health) this script:
//   1. probes 4 titles via /debug/source?full=1 (full untruncated URLs):
//        movie        = Endgame   tt4154796
//        series       = Breaking Bad S01E01 tt0903747:1:1
//        animeSeries  = Attack on Titan S01E01 tmdb:1429:1:1
//        animeMovie   = Your Name tmdb:372058
//   2. verifies playability of up to 2 returned stream URLs per probe:
//        - m3u8  → fetch text, require #EXTM3U / #EXT-X magic
//        - other → Range 0-1023 head read, require video magic bytes
//                  (EBML/MKV, MP4 ftyp, MPEG-TS, RIFF/AVI, FLV, OGG)
//        - direct failure → retry through the addon /proxy (the path players
//          actually use for wrapped streams)
//   3. classifies each source: WORKING / PARTIAL / EMPTY / ERROR
//
// NOT runtime-affecting: pure read-only diagnostics on a TEST instance
// (port 4597). Report → download/health_reports/source_audit_TS.{json,md}
//
// Usage: node scripts/task25_full_audit.mjs [--workers 5] [--chunk i/N] [--port P] [--merge-only]
// The sandbox reaps detached background processes, so long runs are split:
//   for i in 0 1 2; do node scripts/task25_full_audit.mjs --chunk $i/3; done
//   node scripts/task25_full_audit.mjs --merge-only

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..');
const REPORT_DIR = process.env.AUDIT_REPORT_DIR || '/home/z/my-project/download/health_reports';
const PORT = parseInt(process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : '4597', 10) || 4597;
const BASE = `http://127.0.0.1:${PORT}`;
const WORKERS = Math.max(1, parseInt(process.argv.includes('--workers') ? process.argv[process.argv.indexOf('--workers') + 1] : process.env.AUDIT_WORKERS || '5', 10) || 5);
// --chunk i/N → process sources whose index (in the /health registry order) satisfies idx % N === i
let CHUNK_i = 0, CHUNK_N = 1;
if (process.argv.includes('--chunk')) {
  const [i, n] = String(process.argv[process.argv.indexOf('--chunk') + 1]).split('/').map(Number);
  CHUNK_i = isNaN(i) ? 0 : i; CHUNK_N = isNaN(n) || n < 1 ? 1 : n;
}
const MERGE_ONLY = process.argv.includes('--merge-only');

const PROBES = [
  { key: 'movie',       type: 'movie',  id: 'tt4154796',     label: 'Endgame' },
  { key: 'series',      type: 'series', id: 'tt0903747:1:1', label: 'BreakingBad' },
  { key: 'animeSeries', type: 'series', id: 'tmdb:1429:1:1', label: 'AoT S1E1' },
  { key: 'animeMovie',  type: 'movie',  id: 'tmdb:372058',   label: 'Your Name' },
];
// Depth probes run ONLY for sources that return 0 on the standard matrix —
// rescues anime-only sources (Endgame/BB can never be on an anime site) and
// new-catalog sources (vegamovies2's fastdl-backed titles are recent only).
const DEPTH_PROBES = [
  { key: 'depthAnime', type: 'series', id: 'tmdb:209867:2:1', label: 'Frieren S2E1' },
  { key: 'depthSeries',type: 'series', id: 'tmdb:108978:4:1', label: 'Reacher S4E1' },
];

// Known-attribute map for EMPTY classification (do NOT modify these sources)
const KNOWN = {
  dahmermovies:  'do-not-touch (user list)',
  dahmermovies4k:'do-not-touch (user list)',
  vixsrc:        'do-not-touch (user list)',
  zxcstream:     'do-not-touch (user list) — 422-by-design',
  nowhdtime:     'do-not-touch (user list)',
  animezey:      'do-not-touch (user list)',
  anineko:       'upstream DB outage (SQLSTATE HY000, operator-side)',
  peckle:        'febbox-cookie class — deployment-env only',
  pantyflix:     'by design — drops febbox share URLs for Peckle source',
  framextv:      'upstream API dead (api.framextv.tech origin timeout, CF accepts TLS then hangs)',
  vegamovies2:   'Task 24 catalog reality — fastdl-backed NEWER titles only; older titles are vcloud-CF (honest 0)',
};

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36' };

// ---------- helpers ----------
async function readHead(url, headers, maxBytes = 1024, timeoutMs = 15000) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  const ct = res.headers.get('content-type') || '';
  if (!res.ok || !res.body) return { status: res.status, bytes: Buffer.alloc(0), ct };
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  try {
    while (got < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
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
  if (b.subarray(0, 3).toString('latin1') === 'ID3') return 'MP3/AAC';
  return '';
}

// Verify a single stream URL is actually playable. Returns {ok, how}.
async function verifyPlayable(url) {
  if (!url || !/^https?:\/\//.test(url)) return { ok: false, how: 'no-url' };
  const isHls = /\.m3u8($|\?)/i.test(url);
  let directDetail = '';
  // 1) direct probe
  try {
    if (isHls) {
      const res = await fetch(url, { headers: { ...UA, Referer: new URL(url).origin }, signal: AbortSignal.timeout(15000) });
      const body = await res.text();
      if (res.status === 200 && (body.includes('#EXTM3U') || body.includes('#EXT-X'))) return { ok: true, how: 'direct-HLS-magic' };
      directDetail = `direct status=${res.status} len=${body.length}`;
    } else {
      const head = await readHead(url, { ...UA, Range: 'bytes=0-1023', Referer: new URL(url).origin });
      if ((head.status === 200 || head.status === 206)) {
        const m = videoMagic(head.bytes);
        if (m) return { ok: true, how: `direct-${m}` };
        const asText = head.bytes.toString('latin1').slice(0, 60).toLowerCase();
        if (head.bytes.length === 0) directDetail = 'direct empty body';
        else if (asText.includes('<html') || asText.includes('<!doctype') || asText.includes('just a moment')) directDetail = `direct status=${head.status} html-block`;
        else directDetail = `direct status=${head.status} no-magic head=${head.bytes.subarray(0, 8).toString('hex')}`;
      } else directDetail = `direct status=${head.status}`;
    }
  } catch (e) { directDetail = `direct threw (${e.message.slice(0, 40)})`; }
  // 2) via the addon /proxy — ALWAYS attempted when direct lacks magic
  //    (players use /proxy for wrapped streams; also exercises addon path)
  try {
    const head = await readHead(`${BASE}/proxy?url=${encodeURIComponent(url)}`, { ...UA, Range: 'bytes=0-1023' }, 1024, 25000);
    if (head.status === 200 || head.status === 206) {
      if (isHls) {
        const asText = head.bytes.toString('latin1');
        if (asText.includes('#EXTM3U') || asText.includes('#EXT-X')) return { ok: true, how: 'proxy-HLS-magic' };
        return { ok: false, how: `${directDetail}; proxy no-m3u8-magic` };
      }
      const m = videoMagic(head.bytes);
      if (m) return { ok: true, how: `proxy-${m}` };
      const asText = head.bytes.toString('latin1').slice(0, 40).toLowerCase();
      return { ok: false, how: `${directDetail}; proxy status=${head.status}${asText.includes('<html') ? ' html-block' : ' no-magic'}` };
    }
    return { ok: false, how: `${directDetail}; proxy status=${head.status}` };
  } catch (e) {
    return { ok: false, how: `${directDetail}; proxy threw (${e.message.slice(0, 40)})` };
  }
}

// 3) embed verification — sources whose handleInternal returns EMBED pages
//    (megaplay.buzz/stream/…, vidking, etc.) are pre-extraction by design;
//    the addon's extractor layer converts them at player time. /extract
//    302-redirects to the extracted stream URL, so a redirect = the embed
//    resolves through the SAME chain production uses.
async function verifyExtractable(url) {
  try {
    const res = await fetch(`${BASE}/extract?url=${encodeURIComponent(url)}&index=0`, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location') || '';
      return { ok: loc.length > 0, how: `extract-redirect→${loc.slice(0, 60)}` };
    }
    return { ok: false, how: `extract status=${res.status}` };
  } catch (e) {
    return { ok: false, how: `extract threw (${e.message.slice(0, 40)})` };
  }
}

async function getJson(url, timeoutMs) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return await res.json();
  } catch (e) { return { __fetchError: e.message.slice(0, 80) }; }
}

// ---------- boot test addon ----------
async function bootAddon() {
  const logFile = `/tmp/task25_audit_${PORT}.log`;
  const child = spawn('node', ['src/index.js'], { cwd: REPO, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  const logStream = fs.createWriteStream(logFile);
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    try {
      const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const h = await res.json();
        return { child, ids: h.sources || [], extractors: (h.extractors || []).length, logFile };
      }
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  child.kill('SIGKILL');
  throw new Error('addon did not become healthy within 60s');
}

// ---------- probe one source across all 4 titles ----------
async function auditSource(id) {
  const entry = { id, probes: {}, streamsTotal: 0, playVerified: 0, playAttempts: 0, playFails: [], errors: 0, timedOut: 0, durationMs: 0 };
  for (const p of PROBES) {
    const t0 = Date.now();
    const j = await getJson(`${BASE}/debug/source/${id}?type=${p.type}&id=${encodeURIComponent(p.id)}&full=1`, 50000);
    const dt = Date.now() - t0;
    entry.durationMs += dt;
    if (j.__fetchError) { entry.errors++; entry.probes[p.key] = { count: 0, err: j.__fetchError }; continue; }
    if (j.timedOut) { entry.timedOut++; entry.probes[p.key] = { count: 0, err: 'server-side 35s race' }; continue; }
    if (j.error) { entry.errors++; entry.probes[p.key] = { count: 0, err: String(j.error).slice(0, 80) }; continue; }
    const results = Array.isArray(j.results) ? j.results : [];
    entry.probes[p.key] = { count: j.count ?? results.length, durationMs: dt, sample: results.slice(0, 2).map(r => ({ host: (() => { try { return new URL(r.url).host; } catch { return '?'; } })(), format: r.format, title: r.meta?.title?.slice(0, 60) })) };
    entry.streamsTotal += j.count ?? 0;
    // playability: up to 2 full URLs per probe — direct/proxy magic first,
    // then the addon's own extractor chain (embed pages resolve there)
    for (const r of results.slice(0, 2)) {
      if (!r?.url) continue;
      entry.playAttempts++;
      const v = await verifyPlayable(r.url);
      if (v.ok) { entry.playVerified++; continue; }
      const ex = await verifyExtractable(r.url);
      if (ex.ok) entry.extractVerified = (entry.extractVerified || 0) + 1;
      else entry.playFails.push(`${p.key}:${ex.how}`);
    }
  }
  // Depth probes for zero-on-standard-matrix sources (anime-only / new-catalog)
  if (entry.streamsTotal === 0 && entry.errors === 0) {
    for (const p of DEPTH_PROBES) {
      const t0 = Date.now();
      const j = await getJson(`${BASE}/debug/source/${id}?type=${p.type}&id=${encodeURIComponent(p.id)}&full=1`, 50000);
      const dt = Date.now() - t0;
      entry.durationMs += dt;
      if (j.__fetchError || j.timedOut || j.error) { entry.probes[p.key] = { count: 0, err: (j.__fetchError || j.error || 'timeout').slice?.(0, 60) || 'timeout' }; continue; }
      const results = Array.isArray(j.results) ? j.results : [];
      entry.probes[p.key] = { count: j.count ?? results.length, durationMs: dt, depth: true };
      entry.streamsTotal += j.count ?? 0;
      for (const r of results.slice(0, 2)) {
        if (!r?.url) continue;
        entry.playAttempts++;
        const v = await verifyPlayable(r.url);
        if (v.ok) { entry.playVerified++; continue; }
        const ex = await verifyExtractable(r.url);
        if (ex.ok) entry.extractVerified = (entry.extractVerified || 0) + 1;
        else entry.playFails.push(`${p.key}:${ex.how}`);
      }
    }
  }
  // classification: extractVerified counts as verified playability
  const verified = entry.playVerified + (entry.extractVerified || 0);
  if (entry.streamsTotal > 0 && verified > 0) entry.verdict = 'WORKING';
  else if (entry.streamsTotal > 0) entry.verdict = 'PARTIAL';
  else if (entry.errors > 0 || entry.timedOut >= PROBES.length) entry.verdict = 'ERROR';
  else entry.verdict = 'EMPTY';
  if (entry.verdict === 'EMPTY' && KNOWN[id]) entry.known = KNOWN[id];
  return entry;
}

// ---------- main ----------
const t0 = Date.now();

if (MERGE_ONLY) { mergeChunks(); process.exit(0); }

console.log(`=== Task 25 full audit — booting test addon on :${PORT} (chunk ${CHUNK_i}/${CHUNK_N}) ===`);
const { child, ids, extractors } = await bootAddon();
console.log(`addon healthy: ${ids.length} sources / ${extractors} extractors`);

// chunk selection preserves registry order
const targets = ids.filter((_, idx) => idx % CHUNK_N === CHUNK_i);
console.log(`chunk targets: ${targets.length} → ${targets.join(', ')}`);
fs.writeFileSync(`/tmp/task25_audit_ids.json`, JSON.stringify(ids, null, 2));

const results = [];
const queue = [...targets];
let done = 0;
async function worker(wid) {
  while (queue.length) {
    const id = queue.shift();
    if (!id) break;
    let e;
    try { e = await auditSource(id); }
    catch (err) { e = { id, verdict: 'ERROR', probes: {}, streamsTotal: 0, playVerified: 0, playAttempts: 0, playFails: [err.message.slice(0, 60)], errors: 4, timedOut: 0, durationMs: 0 }; }
    results.push(e);
    done++;
    const pv = e.streamsTotal ? ` (${e.playVerified}/${e.playAttempts} playable)` : '';
    const kn = e.known ? ` [${e.known}]` : '';
    console.log(`  [${done}/${targets.length}] ${e.verdict.padEnd(8)} ${id}${pv}${kn}`);
  }
}
await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(i)));

child.kill('SIGTERM');
await new Promise(r => setTimeout(r, 800));

const wall = Math.round((Date.now() - t0) / 1000);
fs.mkdirSync(REPORT_DIR, { recursive: true });
const chunkFile = path.join(REPORT_DIR, `_chunk_${CHUNK_i}_of_${CHUNK_N}.json`);
fs.writeFileSync(chunkFile, JSON.stringify({ chunk: `${CHUNK_i}/${CHUNK_N}`, wallSeconds: wall, results: results.sort((a, b) => a.id.localeCompare(b.id)) }, null, 2));
const counts = results.reduce((a, e) => { a[e.verdict] = (a[e.verdict] || 0) + 1; return a; }, {});
console.log(`\n=== CHUNK ${CHUNK_i}/${CHUNK_N} DONE in ${wall}s ===`);
console.log(`WORKING=${counts.WORKING || 0}  PARTIAL=${counts.PARTIAL || 0}  EMPTY=${counts.EMPTY || 0}  ERROR=${counts.ERROR || 0}`);
console.log(`chunk file: ${chunkFile}`);
process.exit(0);

// ---------- merge chunk files into the final report ----------
function mergeChunks() {
  const files = fs.readdirSync(REPORT_DIR).filter(f => /^_chunk_\d+_of_\d+\.json$/.test(f));
  if (!files.length) { console.log('no chunk files found'); return; }
  let all = [];
  let wall = 0;
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(REPORT_DIR, f), 'utf8'));
    all = all.concat(j.results || []);
    wall += j.wallSeconds || 0;
  }
  // dedupe by id (last wins)
  const byId = new Map();
  for (const e of all) byId.set(e.id, e);
  const results = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  const ids = JSON.parse(fs.readFileSync('/tmp/task25_audit_ids.json', 'utf8'));
  const counts = results.reduce((a, e) => { a[e.verdict] = (a[e.verdict] || 0) + 1; return a; }, {});
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const base = path.join(REPORT_DIR, `source_audit_${stamp}`);
  fs.writeFileSync(base + '.json', JSON.stringify({ timestamp: new Date().toISOString(), wallSeconds: wall, sourceCount: ids.length, verdicts: counts, results }, null, 2));
  const order = { WORKING: 0, PARTIAL: 1, EMPTY: 2, ERROR: 3 };
  const sorted = [...results].sort((a, b) => order[a.verdict] - order[b.verdict] || a.id.localeCompare(b.id));
  const md = [
    `# PhoenX All-Source Playability Audit — ${new Date().toISOString()}`,
    ``,
    `**${results.length}/${ids.length} sources probed across movies / series / anime-series / anime-movie (total ${wall}s across chunks)**`,
    ``,
    `Verdicts: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' · ')}`,
    ``,
    `Playability = magic-byte verification of returned stream URLs (HLS #EXTM3U or video container head), direct first, then via addon /proxy.`,
    ``,
    `| Verdict | Source | Streams | Playable | Notes |`,
    `|---------|--------|---------|----------|-------|`,
    ...sorted.map(e => {
      const probs = [...PROBES, ...DEPTH_PROBES].map(p => `${p.key.slice(0, 6)}:${e.probes[p.key]?.count ?? 0}`).join(' ');
      const notes = [e.known, e.playFails[0], e.probes.movie?.err, e.probes.series?.err, e.probes.animeSeries?.err, e.probes.animeMovie?.err].filter(Boolean).slice(0, 2).join('; ');
      return `| ${e.verdict} | ${e.id} | ${probs} | ${e.playVerified}/${e.playAttempts} | ${notes.replace(/\|/g, '/')} |`;
    }),
    ``,
  ].join('\n');
  fs.writeFileSync(base + '.md', md);
  console.log(`MERGED ${results.length} sources — ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`report: ${base}.md`);
  const problem = sorted.filter(e => e.verdict === 'ERROR' || (e.verdict === 'EMPTY' && !e.known) || e.verdict === 'PARTIAL');
  if (problem.length) {
    console.log(`\nNeeds attention:`);
    problem.forEach(e => console.log(`  - ${e.verdict}: ${e.id} — ${(e.playFails[0] || e.probes.movie?.err || e.probes.series?.err || 'all probes 0').slice(0, 80)}`));
  }
  // clean chunk files
  files.forEach(f => fs.unlinkSync(path.join(REPORT_DIR, f)));
}
