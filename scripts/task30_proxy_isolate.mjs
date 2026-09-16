// Task 30 — isolate /proxy-side fetch behavior for vidsrcme masters
import { gotScraping } from 'got-scraping';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const r = await fetch('https://data.vidsrcme.ru/api.php?type=movie&tmdb=299534&stream_urls', { headers: { 'User-Agent': UA, accept: 'application/json' } });
const d = await r.json();
const enc = Buffer.from(d.data.stream_urls, 'base64');
const w = Buffer.from(await (await fetch(d.vs.wasm_url, { headers: { 'User-Agent': UA } })).arrayBuffer());
const inst = await WebAssembly.instantiate(await WebAssembly.compile(w), {});
const ex = inst.exports;
const p = ex.alloc(enc.length);
new Uint8Array(ex.memory.buffer, p, enc.length).set(enc);
const n = ex.decrypt(p, enc.length);
const urls = new TextDecoder().decode(new Uint8Array(ex.memory.buffer, p + 12, n)).split('\n').filter(Boolean);
const u = urls[0];
const origin = new URL(u).origin;
console.log('master host:', origin);
const t = await (await fetch(origin + '/generate.php', { headers: { 'User-Agent': UA, Referer: 'https://cloudorchestranova.com/' } })).text();
let tok = t.trim();
try { const j = JSON.parse(t); tok = j.token || j.data || tok; } catch {}
const master = u + '?token=' + encodeURIComponent(tok);

const t0 = Date.now();
const pf = await fetch(master, { headers: { 'User-Agent': UA } });
const pt = await pf.text();
console.log('plain fetch:', pf.status, pt.startsWith('#EXTM3U') ? 'M3U8-OK' : 'BAD', (Date.now() - t0) + 'ms');

try {
  const t1 = Date.now();
  const g1 = await gotScraping(master, { headers: { 'User-Agent': UA, Accept: '*/*' }, timeout: { request: 15000 }, throwHttpErrors: false });
  console.log('got-scrape no-Range:', g1.statusCode, String(g1.body).startsWith('#EXTM3U') ? 'M3U8-OK' : 'BAD', (Date.now() - t1) + 'ms');
} catch (e) { console.log('got-scrape no-Range THREW:', e.message.slice(0, 90)); }

try {
  const t2 = Date.now();
  const g2 = await gotScraping(master, { headers: { 'User-Agent': UA, Accept: '*/*', Range: 'bytes=0-' }, timeout: { request: 15000 }, throwHttpErrors: false });
  console.log('got-scrape Range:', g2.statusCode, String(g2.body).startsWith('#EXTM3U') ? 'M3U8-OK' : String(g2.body).slice(0, 40), (Date.now() - t2) + 'ms');
} catch (e) { console.log('got-scrape Range THREW:', e.message.slice(0, 90)); }
