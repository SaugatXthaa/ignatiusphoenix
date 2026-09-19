// Task 63: local verify — boots addon, then play-tests the vidstorm /proxy card
// through the EXACT player path (master→variant→segment) against the LIVE server.
import { spawn } from 'child_process';
import { pathToFileURL } from 'url';
import path from 'path';

const REPO = '/home/z/my-project/phoenix-analysis';
const PORT = 4697;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const child = spawn('node', ['src/index.js'], {
  cwd: REPO,
  env: { ...process.env, PORT: String(PORT), STREAM_CLIENT_BUDGET_MS: '40000', NODE_ENV: 'development' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', d => { const s = String(d); if (/raflix/i.test(s)) process.stdout.write('[srv] ' + s); });

async function j(url, ms = 50000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { signal: c.signal }); return await r.json(); }
  finally { clearTimeout(t); }
}

let up = false;
for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/manifest.json`); up = true; break; } catch { await wait(500); } }
if (!up) { console.log('SERVER FAILED TO BOOT'); child.kill(); process.exit(1); }

// decrypt vidstorm tokens locally to build the exact proxy URL the source ships
const { vidstormDecrypt } = await import(pathToFileURL(path.join(REPO, 'src/utils/vidstorm-decrypt.cjs')).href);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function playTest(label, url) {
  console.log(`\n=== PLAY-TEST ${label} ===`);
  const m = await fetch(url, { headers: { 'User-Agent': UA } });
  const mt = await m.text();
  console.log(`master: ${m.status} ${m.headers.get('content-type')} | ${mt.slice(0, 60).replace(/\n/g, ' ')}`);
  if (!m.ok || !mt.includes('#EXTM3U')) return false;
  const lines = mt.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const vUrl = lines[0].startsWith('http') ? lines[0] : new URL(lines[0], url).href;
  const r2 = await fetch(vUrl, { headers: { 'User-Agent': UA } });
  const t2 = await r2.text();
  console.log(`variant: ${r2.status} | ${t2.slice(0, 80).replace(/\n/g, ' ')}`);
  if (!r2.ok) return false;
  const segLines = t2.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const sUrl = segLines[0].startsWith('http') ? segLines[0] : new URL(segLines[0], vUrl).href;
  const r3 = await fetch(sUrl, { headers: { 'User-Agent': UA, Range: 'bytes=0-99999' } });
  const buf = await r3.arrayBuffer();
  console.log(`segment: ${r3.status} bytes=${buf.byteLength}`);
  return r3.ok && buf.byteLength > 1000;
}

for (const [type, id, label, apiUrl] of [
  ['movie', 'tt1375666', 'Inception', 'https://vidstorm.ru/api/movie/27205'],
  ['series', 'tmdb:1399:1:1', 'GoT S1E1', 'https://vidstorm.ru/api/tv/1399/1/1'],
]) {
  const r = await j(`${BASE}/debug/source/raflix?type=${type}&id=${id}`);
  const vs = (r.logs || []).find(l => /VidStorm/.test(l));
  console.log(`\n${label}: count=${r.count} | ${vs || 'no vidstorm log'}`);

  // build the card's exact /proxy URL from a fresh API resolve
  const api = await (await fetch(apiUrl, { headers: { 'User-Agent': UA } })).json();
  const srv = Object.entries(api).find(([, s]) => s?.url && /hls/i.test(String(s.type)));
  if (!srv) { console.log('  no hls server in api'); continue; }
  const real = vidstormDecrypt(srv[1].url);
  const proxyUrl = `${BASE}/proxy?url=${encodeURIComponent(real)}&origin=${encodeURIComponent('https://vidstorm.ru')}&referer=${encodeURIComponent('https://vidstorm.ru/')}&hls=1`;
  const ok = await playTest(label, proxyUrl);
  console.log(`  → ${ok ? 'PLAYABLE ✅' : 'FAILED ❌'}`);
}

child.kill();
process.exit(0);
