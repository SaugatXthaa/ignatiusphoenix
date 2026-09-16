// Task 42: full playability sweep — boot addon, fetch real /stream responses,
// probe EVERY card URL: must return real video (magic bytes / #EXTM3U), not HTML.
// Usage: node scripts/task42_sweep.mjs movie|series|anime  [--sources=id1,id2]
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const MODE = process.argv[2] || 'movie';
const ONLY = (process.argv.find(a => a.startsWith('--sources=')) || '').split('=')[1] || '';

const TITLES = {
  movie:  { path: '/stream/movie/tt1375666.json', label: 'Inception (movie)' },
  series: { path: '/stream/series/tt0903747:1:1.json', label: 'Breaking Bad S1E1' },
  anime:  { path: '/stream/series/tmdb:209867:1:1.json', label: 'Frieren S1E1' },
};
const title = TITLES[MODE];

const PORT = 4596;
const BASE = `http://127.0.0.1:${PORT}`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const results = []; // {sourceId, url, status, kind, ok}
const report = { mode: MODE, label: title.label, startedAt: new Date().toISOString(), sources: {} };

function sniff(buf) {
  const head = buf.subarray(0, 2048);
  const ascii = head.toString('latin1').trimStart().toLowerCase();
  if (ascii.startsWith('#extm3u')) return 'm3u8';
  if (ascii.startsWith('<!doctype') || ascii.startsWith('<html') || ascii.includes('<title>') && !ascii.startsWith('#')) return 'html';
  if (head.length > 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'mkv';
  if (head.length > 11 && ascii.slice(4, 8) === 'ftyp') return 'mp4';
  if (head[0] === 0x47 && head.length > 188 && head[188] === 0x47) return 'ts';
  if (ascii.startsWith('riff') && ascii.slice(8, 12) === 'avi ') return 'avi';
  if (ascii.startsWith('flv')) return 'flv';
  if (ascii.startsWith('http-response') || ascii.startsWith('icy')) return 'stream';
  // binary evidence required (Task 42): NUL byte / TS sync doublet / ftyp / EBML.
  // Plain-text error bodies without html markers must NOT classify as binary.
  if (head.includes(0) || (head[0] === 0x47 && head.length > 188 && head[188] === 0x47) || ascii.slice(4, 8) === 'ftyp' || (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3)) return 'binary';
  return 'unknown';
}

async function probe(url, headers = {}, depth = 0) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, ...headers }, signal: ctrl.signal, redirect: 'follow' });
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    while (got < 4096) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
    }
    try { ctrl.abort(); } catch {}
    const buf = Buffer.concat(chunks);
    const kind = sniff(buf);
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    let ok = false;
    if (['mkv', 'mp4', 'ts', 'avi', 'flv', 'binary', 'stream'].includes(kind)) ok = true;
    if (kind === 'm3u8' || ct.includes('mpegurl') || ct.includes('vnd.apple')) {
      // fetch first variant child to make sure the tree is real
      if (depth === 0) {
        const text = buf.toString('utf8');
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        let child = null;
        for (const l of lines) {
          if (l.startsWith('#')) continue;
          child = l; break;
        }
        if (child) {
          try {
            const cu = new URL(child, res.url || url);
            const v = await probe(cu.href, headers, 1);
            return { status: res.status, kind: v.ok ? 'm3u8tree' : 'm3u8deadchild', ok: v.ok, childKind: v.kind, childStatus: v.status, childErr: v.err, ct };
          } catch (e) {
            return { status: res.status, kind: 'm3u8childerr', ok: false, err: String(e.message || e).slice(0, 80), ct };
          }
        }
        return { status: res.status, kind: 'm3u8empty', ok: false, ct };
      }
      // depth >= 1: BODY TRUTH (Task 42) — vidking-family mirrors lie about
      // Content-Type (200 text/html + real TS body). The sniffed kind decides.
      return { status: res.status, kind, ok: ['mkv', 'mp4', 'ts', 'avi', 'flv', 'binary', 'stream', 'm3u8'].includes(kind), ct };
    }
    if (kind === 'html') return { status: res.status, kind, ok: false, ct };
    // unknown/undecided: rely on content-type + status, but never clobber a
    // body-sniffed verdict (mirrors lie about ct — Task 42)
    if ((res.status === 200 || res.status === 206) && !ok) ok = ct.includes('video') || ct.includes('octet-stream') || ct.includes('audio') || ct === '';
    return { status: res.status, kind, ok, ct };
  } catch (e) {
    const msg = String(e?.cause?.code || e.message || e);
    return { status: 0, kind: 'error', ok: false, err: msg.slice(0, 90) };
  } finally { clearTimeout(t); }
}

async function waitReady(proc) {
  for (let i = 0; i < 60; i++) {
    if (proc.exitCode !== null) throw new Error('server exited early: ' + proc.exitCode);
    try {
      const r = await fetch(`${BASE}/manifest.json`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('server not ready in 30s');
}

console.log(`[task42] booting addon for ${MODE} (${title.label}) ...`);
const proc = spawn('node', ['src/index.js'], {
  cwd: '/home/z/my-project/phoenix-analysis',
  env: { ...process.env, PORT: String(PORT), STREAM_CLIENT_BUDGET_MS: '40000' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
proc.stdout.on('data', d => { const s = d.toString(); if (s.includes('error') || s.includes('Error')) console.error('[srv]', s.trim().slice(0, 200)); });
proc.stderr.on('data', d => console.error('[srv!]', d.toString().trim().slice(0, 200)));

try {
  await waitReady(proc);
  console.log('[task42] server ready, fetching', title.path);
  const t0 = Date.now();
  const r = await fetch(`${BASE}${title.path}`, { signal: AbortSignal.timeout(120000) });
  const data = await r.json();
  console.log(`[task42] got ${data.streams?.length || 0} streams in ${Date.now() - t0}ms`);

  // group by sourceId from bingeGroup phoenix-<sourceId>-<extractorId>
  const bySource = new Map();
  for (const s of data.streams || []) {
    if (s.externalUrl) continue; // player-page cards (zxcstream exception) — not probeable
    if ((s.url || '').includes('player.zxcstream.xyz')) continue; // sanctioned web-player exception (Task 35)
    const m = /phoenix-([a-z0-9_]+)-/.exec(s.behaviorHints?.bingeGroup || '');
    const sid = m ? m[1] : 'unknown';
    if (ONLY && !ONLY.split(',').includes(sid)) continue;
    if (!bySource.has(sid)) bySource.set(sid, []);
    bySource.get(sid).push(s);
  }

  console.log(`[task42] probing ${[...bySource.values()].flat().length} cards across ${bySource.size} sources (concurrency 16) ...`);
  const queue = [];
  for (const [sid, streams] of bySource) {
    for (const s of streams) {
      const hdrs = { ...(s.behaviorHints?.proxyHeaders?.request || {}) };
      // local-server artifact: addon hardcodes https:// for hostUrl (Render TLS edge);
      // locally the server is plain HTTP, so rewrite ONLY the local host scheme.
      const url = s.url.replace(/^https:\/\/127\.0\.0\.1:4596/, 'http://127.0.0.1:4596');
      queue.push({ sid, url, hdrs, name: (s.name || '').slice(0, 60) });
    }
  }
  let done = 0;
  const CONC = 6; // 16-way concurrency false-flags busy HLS trees via child timeouts (0.1-CPU sandbox)
  async function worker() {
    while (queue.length) {
      const item = queue.shift();
      const res = await probe(item.url, item.hdrs);
      results.push({ sourceId: item.sid, url: item.url.slice(0, 160), ...res });
      done++;
      if (done % 25 === 0) console.log(`[task42] probed ${done}/${results.length + queue.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));

  // aggregate
  for (const r of results) {
    const key = r.sourceId;
    if (!report.sources[key]) report.sources[key] = { total: 0, ok: 0, html: 0, err: 0, bad: 0, kinds: {}, sampleBad: [], sampleOk: [] };
    const s = report.sources[key];
    s.total++;
    if (r.ok) { s.ok++; if (s.sampleOk.length < 2) s.sampleOk.push({ url: r.url, kind: r.kind, status: r.status }); }
    else {
      if (r.kind === 'html') s.html++;
      else if (r.kind === 'error') s.err++;
      else s.bad++;
      s.kinds[r.kind] = (s.kinds[r.kind] || 0) + 1;
      if (s.sampleBad.length < 3) s.sampleBad.push({ url: r.url, kind: r.kind, status: r.status, err: r.err, ct: r.ct, childKind: r.childKind, childStatus: r.childStatus, childErr: r.childErr });
    }
  }

  const rows = Object.entries(report.sources).map(([id, s]) => ({ id, ...s, badpct: Math.round(100 * (s.total - s.ok) / s.total) })).sort((a, b) => b.badpct - a.badpct);
  console.log('\n=== PLAYABILITY REPORT ===');
  for (const r of rows) {
    const flag = r.ok === r.total ? 'OK ' : (r.ok === 0 ? 'DEAD' : 'PART');
    console.log(`${flag} ${r.id.padEnd(20)} total=${String(r.total).padStart(3)} ok=${String(r.ok).padStart(3)} html=${r.html} err=${r.err} bad=${r.bad} ${JSON.stringify(r.kinds)}`);
    if (r.ok !== r.total) for (const b of r.sampleBad) console.log(`      BAD: [${b.kind}/${b.status}${b.err ? ' ' + b.err : ''}] ${b.url.slice(0, 130)}`);
  }
  const totals = rows.reduce((a, r) => ({ total: a.total + r.total, ok: a.ok + r.ok }), { total: 0, ok: 0 });
  console.log(`\nTOTAL: ${totals.ok}/${totals.total} cards playable (${rows.filter(r => r.ok === 0 && r.total > 0).length} fully-dead sources, ${rows.filter(r => r.ok !== r.total).length} with any bad card)`);

  fs.writeFileSync(`/home/z/my-project/phoenix-analysis/scripts/task42_report_${MODE}.json`, JSON.stringify(report, null, 1));
} finally {
  proc.kill('SIGKILL');
}
