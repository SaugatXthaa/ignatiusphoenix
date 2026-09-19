// Task 63 E2E: fresh tt id on a fresh boot — the exact user path that died
// (TMDB /find burst → all-0). Expect cards to land in-request now.
import { spawn } from 'child_process';
const REPO = '/home/z/my-project/phoenix-analysis';
const PORT = 4699;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const child = spawn('node', ['src/index.js'], {
  cwd: REPO,
  env: { ...process.env, PORT: String(PORT), STREAM_CLIENT_BUDGET_MS: '40000', NODE_ENV: 'development' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stderr.on('data', d => { const s = String(d); if (/NotFoundError|unhandled/i.test(s)) console.log('[FATAL?]', s.slice(0, 200)); });
child.on('exit', (c) => { if (c !== 0 && c !== null) console.log(`!!! SERVER EXITED code=${c}`); });
async function j(url, ms = 70000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { signal: c.signal }); return await r.json(); }
  finally { clearTimeout(t); }
}
let up = false;
for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/manifest.json`); up = true; break; } catch { await wait(500); } }
if (!up) { console.log('BOOT FAIL'); child.kill(); process.exit(1); }

// Fresh tt never resolved by this instance: Squid Game S1E1
const t0 = Date.now();
const r = await j(`${BASE}/stream/series/tt10919420:1:1.json`);
const streams = Array.isArray(r?.streams) ? r.streams : [];
const subbed = streams.filter(s => s.subtitles?.length);
console.log(`SquidGame tt10919420 (fresh boot, fresh tt): cards=${streams.length} subbed=${subbed.length} @${Date.now() - t0}ms`);

// anime fresh tt: Frieren S1E1 (tt13616990)
const t1 = Date.now();
const r2 = await j(`${BASE}/stream/series/tt13616990:1:1.json`);
const s2 = Array.isArray(r2?.streams) ? r2.streams : [];
console.log(`Frieren tt13616990: cards=${s2.length} subbed=${s2.filter(x => x.subtitles?.length).length} @${Date.now() - t1}ms`);

// movie fresh tt: Inception
const t2 = Date.now();
const r3 = await j(`${BASE}/stream/movie/tt1375666.json`);
const s3 = Array.isArray(r3?.streams) ? r3.streams : [];
console.log(`Inception tt1375666: cards=${s3.length} subbed=${s3.filter(x => x.subtitles?.length).length} @${Date.now() - t2}ms`);

// raflix vidstorm landing in merged resolve
const vs = s3.filter(s => /VidStorm/i.test(s.name || s.title || ''));
console.log(`Inception VidStorm cards in merged: ${vs.length}${vs.length ? ' e.g. ' + String(vs[0].url).slice(0, 90) : ''}`);

// second round (warm) — should be fast and fuller
const t3 = Date.now();
const r4 = await j(`${BASE}/stream/series/tt10919420:1:1.json`);
const s4 = Array.isArray(r4?.streams) ? r4.streams : [];
console.log(`SquidGame r2 (warm): cards=${s4.length} @${Date.now() - t3}ms`);

child.kill(); process.exit(0);
