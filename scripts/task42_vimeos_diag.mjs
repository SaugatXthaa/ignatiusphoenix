// Task 42: diagnose vimeos card — bare fetch vs proxyHeaders fetch vs gate verdict
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const gate = require('/home/z/my-project/phoenix-analysis/src/utils/streamGate.cjs');

const PORT = 4596;
const BASE = `http://127.0.0.1:${PORT}`;
const proc = spawn('node', ['src/index.js'], {
  cwd: '/home/z/my-project/phoenix-analysis',
  env: { ...process.env, PORT: String(PORT), STREAM_CLIENT_BUDGET_MS: '40000' },
  stdio: ['ignore', 'ignore', 'pipe'],
});

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/manifest.json`, { signal: AbortSignal.timeout(1500) }); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('not ready');
}

try {
  await waitReady();
  const r = await fetch(`${BASE}/stream/movie/tt1375666.json`, { signal: AbortSignal.timeout(120000) });
  const all = (await r.json()).streams || [];
  const vm = all.filter(s => (s.url || '').includes('vimeos'));
  console.log('vimeos cards:', vm.length);
  const card = vm[0];
  if (!card) { console.log('none'); process.exit(0); }
  const url = card.url.replace(/^https:\/\/127\.0\.0\.1:4596/, BASE);
  console.log('card url head:', decodeURIComponent(url).slice(0, 220));
  console.log('card params:', [...new URL(url).searchParams.keys()].join(','));
  console.log('proxyHeaders:', JSON.stringify(card.behaviorHints?.proxyHeaders || null));

  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
  // 1) bare fetch (what the gate does)
  const b = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(10000) });
  const bBody = (await b.text()).slice(0, 60).replace(/\n/g, ' ');
  console.log('BARE    :', b.status, b.headers.get('content-type'), '|', bBody);
  // 2) with card proxyHeaders (what the sweep/player-ish does)
  const ph = card.behaviorHints?.proxyHeaders?.request || {};
  const w = await fetch(url, { headers: { 'user-agent': UA, ...ph }, signal: AbortSignal.timeout(10000) });
  const wBody = (await w.text()).slice(0, 60).replace(/\n/g, ' ');
  console.log('WITH-HDR:', w.status, w.headers.get('content-type'), '|', wBody);
  // 3) gate verdict
  const v = await gate.probe(url);
  console.log('GATE verdict:', v);
} finally {
  proc.kill('SIGKILL');
}
