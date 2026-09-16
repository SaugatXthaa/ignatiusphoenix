// Task 44: hindmoviez anime-card diagnosis — full URLs, no truncation.
// Are the Frieren cards real files or directory listings? Do they consistently fail?
import { spawn } from 'node:child_process';

const PORT = 4596;
const BASE = `http://127.0.0.1:${PORT}`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const proc = spawn('node', ['src/index.js'], {
  cwd: '/home/z/my-project/phoenix-analysis',
  env: { ...process.env, PORT: String(PORT), STREAM_CLIENT_BUDGET_MS: '40000' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
proc.stderr.on('data', d => { const s = d.toString(); if (s.includes('liveness') || s.toLowerCase().includes('error')) process.stderr.write('[srv] ' + s.trim().slice(0, 180) + '\n'); });

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/manifest.json`, { signal: AbortSignal.timeout(1500) }); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('server not ready');
}

try {
  await waitReady();
  console.log('ready; fetching Frieren S1E1...');
  const r = await fetch(`${BASE}/stream/series/tmdb:209867:1:1.json`, { signal: AbortSignal.timeout(120000) });
  const data = await r.json();
  const cards = (data.streams || []).filter(s => /phoenix-hindmoviez-/.test(s.behaviorHints?.bingeGroup || ''));
  console.log(`hindmoviez cards: ${cards.length}`);
  for (const s of cards) {
    const inner = new URL(s.url).searchParams.get('url') || s.url;
    console.log('\nCARD name:', (s.description || s.title || '').replace(/\n/g, ' | ').slice(0, 100));
    console.log('INNER URL:', inner);
    // probe inner directly (what /proxy would fetch, minus proxy wrapper)
    const t0 = Date.now();
    try {
      const res = await fetch(inner, { headers: { 'user-agent': UA, Range: 'bytes=0-1023' }, redirect: 'follow', signal: AbortSignal.timeout(12000) });
      const buf = Buffer.from(await res.arrayBuffer()).subarray(0, 300);
      const ct = res.headers.get('content-type') || '';
      const head = buf.toString('latin1').replace(/[^\x20-\x7e]/g, '.').slice(0, 80);
      console.log(`PROBE: status=${res.status} ct=${ct} ms=${Date.now() - t0} head=${JSON.stringify(head)}`);
    } catch (e) {
      console.log(`PROBE: error ms=${Date.now() - t0} ${String(e?.cause?.code || e.message).slice(0, 80)}`);
    }
  }
} finally {
  proc.kill('SIGKILL');
}
