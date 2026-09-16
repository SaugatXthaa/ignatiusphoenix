// Task 42: reproduce the moon.peakstorm.top dead-child m3u8 issue
import { spawn } from 'node:child_process';

const PORT = 4596;
const BASE = `http://127.0.0.1:${PORT}`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const proc = spawn('node', ['src/index.js'], {
  cwd: '/home/z/my-project/phoenix-analysis',
  env: { ...process.env, PORT: String(PORT), STREAM_CLIENT_BUDGET_MS: '40000' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
proc.stderr.on('data', d => process.stderr.write('[srv] ' + d.toString().slice(0, 300)));

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/manifest.json`, { signal: AbortSignal.timeout(1500) }); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('not ready');
}

try {
  await waitReady();
  console.log('ready, fetching Frieren streams...');
  const r = await fetch(`${BASE}/stream/series/tmdb:209867:1:1.json`, { signal: AbortSignal.timeout(120000) });
  const data = await r.json();
  const all = data.streams || [];
  console.log('total streams:', all.length);
  const masters = all.filter(s => (s.url || '').includes('master.m3u8'));
  console.log('master.m3u8 cards:', masters.length);
  for (const s of masters.slice(0, 8)) console.log('  cand:', (s.behaviorHints?.bingeGroup || ''), '|', (s.url || '').slice(0, 140));
  const m = masters.find(s => (s.url || '').includes('peakstorm')) || masters[0];
  if (!m) { console.log('NO master found'); process.exit(0); }
  const masterUrl = m.url.replace('https://127.0.0.1:4596', BASE);
  console.log('MASTER:', masterUrl.slice(0, 180));

  const r1 = await fetch(masterUrl, { signal: AbortSignal.timeout(15000) });
  const t1 = await r1.text();
  console.log('\n--- MASTER response status', r1.status, 'ct:', r1.headers.get('content-type'));
  console.log(t1.slice(0, 1200));

  // find first child line
  const child = t1.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))[0];
  console.log('\n--- CHILD line:', child);
  const childUrl = new URL(child, masterUrl).href;
  console.log('CHILD resolved:', childUrl.slice(0, 200));

  const r2 = await fetch(childUrl, { signal: AbortSignal.timeout(15000) });
  const t2 = await r2.text();
  console.log('\n--- CHILD response status', r2.status, 'ct:', r2.headers.get('content-type'));
  console.log(t2.slice(0, 800));
} finally {
  proc.kill('SIGKILL');
}
