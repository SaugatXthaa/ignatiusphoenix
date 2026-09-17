// Task 51: local E2E for the funnel fixes — boots the addon, probes
// hdhub4uv2 + full /stream merge + real playability of an hblinks-derived card.
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..');
const PORT = 4671;
const BASE = `http://127.0.0.1:${PORT}`;

const child = spawn('node', ['src/index.js'], {
  cwd: REPO,
  env: { ...process.env, PORT: String(PORT), STREAM_CLIENT_BUDGET_MS: '40000' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', d => { if (String(d).includes('server started')) console.log('[boot] server started'); });
child.stderr.on('data', d => process.stderr.write(d));

async function jget(url, timeoutMs = 70000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  return res.json();
}

// wait for boot
for (let i = 0; i < 40; i++) {
  try { await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1000) }); break; }
  catch { await new Promise(r => setTimeout(r, 500)); }
}

const tmdb = process.argv[2] || 'tmdb:324857';
console.log(`\n=== isolated hdhub4uv2 (${tmdb}) ===`);
const d = await jget(`${BASE}/debug/source/hdhub4uv2?type=movie&id=${tmdb}`);
console.log(`count=${d.count} @${(d.durationMs / 1000).toFixed(1)}s`);
for (const r of (d.results || []).slice(0, 3)) console.log(`  ${(r.meta?.title || '').slice(0, 70)} | ${(r.url || '').slice(0, 90)}`);

console.log('\n=== playability probe of first card ===');
if (d.results?.length) {
  const card = d.results[0];
  // resolve through the extractor chain: simulate by calling /stream merge? simpler: check the URL host class
  console.log('card url:', card.url?.slice(0, 110));
  const res = await fetch(card.url, { headers: { Range: 'bytes=0-63' }, signal: AbortSignal.timeout(20000) }).catch(e => ({ error: e.message }));
  if (res.error) console.log('direct probe (expected for page URL):', res.error);
  else console.log('direct probe status:', res.status, (res.headers.get('content-type') || '').slice(0, 30));
}

console.log('\n=== full merged /stream — hub family present? ===');
const st = await jget(`${BASE}/stream/movie/${tmdb}.json`);
const streams = st.streams || [];
console.log(`total ${streams.length} cards`);
const pick = (re) => streams.filter(s => re.test(s.name || ''));
console.log(`HDHub4u: ${pick(/HDHub4u/).length}, 4KHDHub: ${pick(/4KHDHub/).length}, CineWave: ${pick(/CineWave/).length}, BollyFlix: ${pick(/BollyFlix/).length}`);

// probe an actual HDHub4u card's URL for playability (first one)
const h4 = pick(/HDHub4u/)[0];
if (h4) {
  const url = h4.url || h4.externalUrl;
  const abs = url?.startsWith('http') ? url : BASE + url;
  const res = await fetch(abs, { headers: { Range: 'bytes=0-63' }, signal: AbortSignal.timeout(25000) }).catch(e => ({ error: e.message }));
  if (res.error) console.log('h4 card probe FAIL:', res.error);
  else {
    const buf = new Uint8Array(await res.arrayBuffer());
    const isMKV = buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
    const isTS = buf[0] === 0x47;
    console.log(`h4 card probe: HTTP ${res.status} ct=${(res.headers.get('content-type') || '?').slice(0, 30)} magic=${isMKV ? 'MKV' : isTS ? 'TS' : 'other'}`);
  }
}

child.kill('SIGTERM');
process.exit(0);
