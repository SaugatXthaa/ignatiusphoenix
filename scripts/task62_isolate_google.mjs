// Task 62: isolate google-vs-Render behavior for a fresh card.
import fs from 'fs';

const BASE = 'https://ignatiusphoenix.onrender.com';
const d = await (await fetch(`${BASE}/stream/movie/tt37287335.json`, { signal: AbortSignal.timeout(150000) })).json();
const cards = d.streams || [];
const google = cards.filter(s => /range-proxy/.test(s.url || '') && /googleusercontent/.test(s.url || ''));
const card = google.find(s => /cinefreak/.test(s.behaviorHints?.bingeGroup || '') && /1080p/.test(s.name)) || google[0];
const target = new URL(card.url).searchParams.get('url');
console.log('card:', card.name, '| target len', target.length);
fs.writeFileSync('/tmp/t62/target3.txt', target);
fs.writeFileSync('/tmp/t62/produrl3.txt', card.url);

// 1) DIRECT from sandbox (google sees sandbox IP)
const t0 = Date.now();
try {
  const r = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', Range: 'bytes=0-1048575' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
  const ab = await r.arrayBuffer();
  console.log(`direct sandbox: status=${r.status} bytes=${ab.byteLength} in ${Date.now() - t0}ms ctype=${r.headers.get('content-type')}`);
} catch (e) { console.log(`direct sandbox: ERR ${String(e).slice(0, 120)} after ${Date.now() - t0}ms`); }

// 2) through production range-proxy (google sees Render IP)
const t1 = Date.now();
try {
  const r = await fetch(card.url, { headers: { Range: 'bytes=0-1048575' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
  const ab = await r.arrayBuffer();
  console.log(`via prod proxy: status=${r.status} bytes=${ab.byteLength} in ${Date.now() - t1}ms ctype=${r.headers.get('content-type')} crange=${r.headers.get('content-range')}`);
  if (r.status >= 400) console.log('   body:', Buffer.from(ab).toString().slice(0, 200));
} catch (e) { console.log(`via prod proxy: ERR ${String(e).slice(0, 120)} after ${Date.now() - t1}ms`); }
