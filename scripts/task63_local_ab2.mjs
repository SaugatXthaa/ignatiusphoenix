// Task 63: local A/B for acermovies + verhdlink + hindmoviez (prod zeros)
import { spawn } from 'child_process';
const REPO = '/home/z/my-project/phoenix-analysis';
const PORT = 4698;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const child = spawn('node', ['src/index.js'], {
  cwd: REPO,
  env: { ...process.env, PORT: String(PORT), NODE_ENV: 'development' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', d => { const s = String(d); if (/acermovies|verhdlink|hindmovie|Acer|VerHd|Hind/i.test(s)) process.stdout.write('[srv] ' + s.slice(0, 220) + '\n'); });
async function j(url, ms = 50000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { signal: c.signal }); return await r.json(); }
  finally { clearTimeout(t); }
}
let up = false;
for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/manifest.json`); up = true; break; } catch { await wait(500); } }
if (!up) { console.log('BOOT FAIL'); child.kill(); process.exit(1); }

for (const [sid, type, id] of [
  ['acermovies', 'movie', 'tmdb:27205'],
  ['verhdlink', 'movie', 'tmdb:27205'],
  ['hindmoviez', 'movie', 'tmdb:27205'],
]) {
  const r = await j(`${BASE}/debug/source/${sid}?type=${type}&id=${id}`);
  console.log(`\n${sid} ${type}: count=${r.count} dt=${r.durationMs}ms ${r.error ? 'ERR=' + r.error.slice(0, 120) : ''} ${r.timedOut ? 'TO' : ''}`);
  (r.logs || []).slice(0, 8).forEach(l => console.log('  log:', l.slice(0, 180)));
  for (const s of (r.results || []).slice(0, 3)) console.log(`  card: ${s.format} ${String(s.url).slice(0, 90)}`);
}
child.kill(); process.exit(0);
