// Task 62 Phase 2: probe the EXACT screenshot cards through the player path.
// MoviesDrive 4K / CineFreak 4K+1080p / uhdmovies cards for Obsession (tt37287335).
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const OUT = '/home/z/my-project/phoenix-analysis/scripts/task62';
const cards = require('/home/z/my-project/phoenix-analysis/scripts/task62/cards_Obsession.json');

function pick(re) { return cards.filter(s => re.test(s.behaviorHints?.bingeGroup || '')); }

const targets = [];
const md4k = pick(/moviesdrivev2/).find(s => /4K/.test(s.name));
if (md4k) targets.push({ label: 'MoviesDrive-4K', s: md4k });
const cf4k = pick(/cinefreak/).find(s => /4K/.test(s.name));
if (cf4k) targets.push({ label: 'CineFreak-4K', s: cf4k });
const cf1080 = pick(/cinefreak/).find(s => /1080p/.test(s.name));
if (cf1080) targets.push({ label: 'CineFreak-1080p', s: cf1080 });
const uhd4kworker = pick(/uhdmovies/).find(s => /4K/.test(s.name) && /workers\.dev/.test(s.url));
if (uhd4kworker) targets.push({ label: 'UHD-4K-worker', s: uhd4kworker });
const uhd4kgoogle = pick(/uhdmovies/).find(s => /4K/.test(s.name) && /range-proxy/.test(s.url));
if (uhd4kgoogle) targets.push({ label: 'UHD-4K-google-rp', s: uhd4kgoogle });
const uhd1080worker = pick(/uhdmovies/).find(s => /1080p/.test(s.name) && /workers\.dev/.test(s.url));
if (uhd1080worker) targets.push({ label: 'UHD-1080-worker', s: uhd1080worker });

function hdrsFor(s) {
  const h = s.behaviorHints?.proxyHeaders;
  if (h && typeof h === 'object') return h.request || h;
  return {};
}

async function probeRange(label, url, headers, range, maxMs, maxBytes) {
  const t0 = Date.now();
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), maxMs);
  try {
    const res = await fetch(url, { headers: { ...headers, Range: range }, signal: ac.signal, redirect: 'follow' });
    const ttfb = Date.now() - t0;
    const clen = res.headers.get('content-length');
    const crange = res.headers.get('content-range');
    const ctype = res.headers.get('content-type');
    const reader = res.body.getReader();
    let bytes = 0; let chunks = 0; const tRead0 = Date.now();
    while (bytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length; chunks++;
      if (Date.now() - t0 > maxMs) { reader.cancel().catch(()=>{}); break; }
    }
    const total = Date.now() - t0;
    clearTimeout(to);
    const speed = chunks ? Math.round(bytes / 1024 / ((total - ttfb || 1) / 1000)) : 0;
    return { label, range, status: res.status, ttfb, totalMs: total, ctype, clen, crange, bytes, chunks, kbps: speed };
  } catch (e) {
    clearTimeout(to);
    return { label, range, error: String(e).slice(0, 100), afterMs: Date.now() - t0 };
  }
}

console.log(`probing ${targets.length} cards...`);
const results = [];
for (const t of targets) {
  const url = t.s.url;
  const h = hdrsFor(t.s);
  console.log(`\n=== ${t.label} ===`);
  console.log('url:', url.slice(0, 120));
  if (Object.keys(h).length) console.log('hdrs:', JSON.stringify(h).slice(0, 120));
  const r0 = await probeRange(t.label, url, h, 'bytes=0-', 20000, 2 * 1024 * 1024);
  console.log('open:', JSON.stringify(r0));
  results.push(r0);
  // cue-seek probe (what mpv does for Matroska Cues)
  const rCue = await probeRange(t.label, url, h, 'bytes=1900000000-', 12000, 64 * 1024);
  console.log('cue :', JSON.stringify(rCue));
  results.push(rCue);
  // small seek
  const rMid = await probeRange(t.label, url, h, 'bytes=1000000-', 12000, 512 * 1024);
  console.log('mid :', JSON.stringify(rMid));
  results.push(rMid);
}
fs.writeFileSync(`${OUT}/probe_cards_results.json`, JSON.stringify(results, null, 1));
console.log('\nsaved probe_cards_results.json');
