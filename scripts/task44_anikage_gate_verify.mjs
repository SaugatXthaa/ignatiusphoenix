// Task 44: live anikage gate verification — boot addon, scrape fresh anikage
// cards for Frieren S1E1, then run streamGate.probe on the EXACT card URL the
// player fetches (/proxy + origin param) and print the verdict.
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
  throw new Error('server not ready');
}

try {
  await waitReady();
  console.log('ready; isolated anikage run for Frieren S1E1...');
  const r = await fetch(`${BASE}/debug/source/anikage?type=series&id=tmdb:209867:1:1`, { signal: AbortSignal.timeout(90000) });
  const d = await r.json();
  const cards = d.streams || [];
  console.log(`anikage cards: ${cards.length}`);
  const local = 'http://127.0.0.1:4596';
  let n = 0;
  for (const s of cards.slice(0, 6)) {
    n++;
    // rewrite https://127.0.0.1:4596 → http (local plain-HTTP artifact)
    const url = (s.url || '').replace(/^https:\/\/127\.0\.0\.1:4596/, local).replace(/^https:\/\//, m => s.url.includes('127.0.0.1') ? 'http://' : m);
    const host = gate.gateHostOf(url);
    const t0 = Date.now();
    const v = await gate.probe(url);
    console.log(`card#${n} host=${host} gated=${gate.isGatedHost(host)} verdict=${v} (${Date.now() - t0}ms) url=${url.slice(0, 110)}`);
  }
} finally {
  proc.kill('SIGKILL');
}
