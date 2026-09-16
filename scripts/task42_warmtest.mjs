// Task 42: verify warm-pass gated-dead drop (2 passes, vimeos/nexabloom must vanish on pass 2)
import { spawn } from 'node:child_process';

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
  for (const [path, label] of [['/stream/movie/tt1375666.json', 'Inception'], ['/stream/series/tmdb:209867:1:1.json', 'Frieren']]) {
    for (let pass = 1; pass <= 2; pass++) {
      const t0 = Date.now();
      const r = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(120000) });
      const all = (await r.json()).streams || [];
      const bad = {};
      for (const s of all) {
        const u = s.url || '';
        for (const h of ['vimeos.zip', 'vimeos.net', 'nexabloom', 'nhdapi.com']) if (u.includes(h)) bad[h] = (bad[h] || 0) + 1;
      }
      console.log(`${label} pass${pass}: ${all.length} cards in ${Date.now() - t0}ms | gated-host cards: ${JSON.stringify(bad)}`);
    }
  }
} finally {
  proc.kill('SIGKILL');
}
