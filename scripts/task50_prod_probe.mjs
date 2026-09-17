// task50_prod_probe.mjs — boot addon, probe the three fixed hub sources
// end-to-end through /debug/source (wrapper → scraper → cards).
import { spawn } from 'child_process';
import fs from 'fs';

const REPO = '/home/z/my-project/phoenix-analysis';
const PORT = 4599;
const child = spawn('node', ['src/index.js'], {
  cwd: REPO, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'],
});
let boot = '';
child.stdout.on('data', d => { boot += d; });
child.stderr.on('data', d => { boot += d; });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitHealthy() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(3000) }); if (r.ok) return; } catch {}
    await sleep(1000);
  }
  throw new Error('never healthy');
}

(async () => {
  await waitHealthy();
  const probes = [
    ['4khdhub', 'movie', 'tmdb:27205'],
    ['fourkhdhubone', 'movie', 'tmdb:27205'],
    ['hdhub4uv2', 'movie', 'tmdb:27205'],
    ['hdhub4uv2', 'series', 'tmdb:1396:1:1'],  // Breaking Bad S1E1
  ];
  for (const [id, type, tmdb] of probes) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/debug/source/${id}?type=${type}&id=${tmdb}`, { signal: AbortSignal.timeout(90000) });
      const d = await r.json();
      console.log(`[${id}] ${tmdb}: count=${d?.count} in ${d?.durationMs}ms`);
      for (const s of (d?.streams || []).slice(0, 3)) {
        console.log(`   card: ${(s.title || '').slice(0, 60)} | url=${(s.url || '').slice(0, 60)}`);
      }
    } catch (e) { console.log(`[${id}] ${tmdb}: PROBE ERROR ${e.message.slice(0, 60)}`); }
  }
  child.kill('SIGTERM');
  await sleep(400);
  process.exit(0);
})().catch(e => { console.error(e.message); child.kill('SIGTERM'); process.exit(1); });
