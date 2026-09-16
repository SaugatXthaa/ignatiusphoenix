// Task 42: trace moon.peakstorm.top master → child chain end-to-end
import { spawn } from 'node:child_process';

const PORT = 4596;
const BASE = `http://127.0.0.1:${PORT}`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const proc = spawn('node', ['src/index.js'], {
  cwd: '/home/z/my-project/phoenix-analysis',
  env: { ...process.env, PORT: String(PORT), STREAM_CLIENT_BUDGET_MS: '40000' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
proc.stderr.on('data', d => { const s = d.toString(); if (/peakstorm|proxy/i.test(s)) process.stderr.write('[srv] ' + s.slice(0, 200)); });

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/manifest.json`, { signal: AbortSignal.timeout(1500) }); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('not ready');
}
const fix = u => (u || '').replace(/^https:\/\/127\.0\.0\.1:4596/, BASE);

try {
  await waitReady();
  console.log('ready, isolating streamxtv on Frieren S1E1 ...');
  const r = await fetch(`${BASE}/debug/source/videasy?type=series&id=tmdb:209867:1:1&full=1`, { signal: AbortSignal.timeout(60000) });
  const data = await r.json();
  console.log('count:', data.count, 'durationMs:', data.durationMs);
  const peak = (data.results || []).filter(x => (x.url || '').includes('peakstorm'));
  console.log('peakstorm cards:', peak.length);
  for (const p of peak) {
    console.log('\n=== CARD ===');
    console.log('url:', fix(p.url));
    console.log('format:', p.format, '| meta.headers:', JSON.stringify(p.meta?.headers || p.meta?.nuvioReferer || null));
    // fetch via local server (referer is baked into query by resolver for final cards;
    // raw handleInternal results keep headers in meta — emulate both)
    const u = new URL(fix(p.url), BASE);
    if (!u.searchParams.has('referer') && p.meta?.nuvioReferer) u.searchParams.set('referer', p.meta.nuvioReferer);
    if (!u.searchParams.has('referer')) {
      const ref = p.meta?.headers?.Referer || p.meta?.headers?.referer;
      if (ref) u.searchParams.set('referer', ref);
    }
    console.log('FETCH:', u.href.slice(0, 220));
    const r1 = await fetch(u.href, { signal: AbortSignal.timeout(15000), headers: { 'user-agent': UA } });
    const t1 = await r1.text();
    console.log('MASTER status', r1.status, 'ct:', r1.headers.get('content-type'));
    console.log(t1.slice(0, 700));
    const child = t1.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))[0];
    if (child) {
      const cu = new URL(child, u.href).href;
      console.log('CHILD:', cu.slice(0, 240));
      const r2 = await fetch(cu, { signal: AbortSignal.timeout(15000), headers: { 'user-agent': UA } });
      const t2 = await r2.text();
      console.log('CHILD status', r2.status, 'ct:', r2.headers.get('content-type'), 'len:', t2.length);
      console.log(t2.slice(0, 500));
    }
  }
  if (!peak.length) {
    // dump what we did get
    for (const p of (data.results || []).slice(0, 6)) console.log('card:', (p.url || '').slice(0, 160));
  }
} finally { proc.kill('SIGKILL'); }
