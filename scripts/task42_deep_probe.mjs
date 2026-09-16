// Task 42 deep probe: verify dead-card classes live (fresh tokens) before gating
import { spawn } from 'node:child_process';

const PORT = 4596;
const BASE = `http://127.0.0.1:${PORT}`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const proc = spawn('node', ['src/index.js'], {
  cwd: '/home/z/my-project/phoenix-analysis',
  env: { ...process.env, PORT: String(PORT), STREAM_CLIENT_BUDGET_MS: '40000' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
proc.stderr.on('data', d => { const s = d.toString(); if (s.includes('error') || s.includes('Error')) process.stderr.write('[srv] ' + s.slice(0, 200)); });

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/manifest.json`, { signal: AbortSignal.timeout(1500) }); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('server not ready');
}

function inner(url) {
  try { const u = new URL(url); if (u.pathname === '/proxy' || u.pathname === '/range-proxy') return u.searchParams.get('url') || ''; } catch {}
  return url;
}

async function fetchCard(url, extraHeaders = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, ...extraHeaders }, signal: ctrl.signal, redirect: 'follow' });
    const ct = res.headers.get('content-type') || '';
    const body = await res.text();
    return { status: res.status, ct, body };
  } catch (e) {
    return { status: 0, ct: '', body: '', err: e.message };
  } finally { clearTimeout(t); }
}

// Walk an m3u8 tree: master -> first child -> first segment
async function walkM3u8(url, depth = 0, out = []) {
  const r = await fetchCard(url);
  out.push({ depth, url: url.slice(0, 130), status: r.status, ct: r.ct.slice(0, 40), head: r.body.slice(0, 60).replace(/\n/g, ' | ') });
  if (r.err || depth >= 2) return out;
  const isM3u8 = r.ct.includes('mpegurl') || r.body.trimStart().startsWith('#EXTM3U');
  if (!isM3u8) return out;
  const lines = r.body.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const child = lines[0];
  if (!child) { out.push({ depth: depth + 1, note: 'NO CHILD LINES (empty playlist)' }); return out; }
  const childUrl = new URL(child, url).href;
  return walkM3u8(childUrl, depth + 1, out);
}

try {
  await waitReady();
  console.log('server ready, fetching Frieren S1E1 streams...');
  const r = await fetch(`${BASE}/stream/series/tmdb:209867:1:1.json`, { signal: AbortSignal.timeout(120000) });
  const data = await r.json();
  const all = data.streams || [];
  console.log('total cards:', all.length);

  const WATCH = ['streamxtv', 'itachi', 'anikoto', 'anidoor', 'animeflix', 'raflix', 'nikastream', 'anibd', 'cinewave', 'cineby', 'watchseries', 'vidking'];
  const seen = new Set();
  for (const s of all) {
    const name = s.name || '';
    const srcId = WATCH.find(w => (s.behaviorHints?.bingeGroup || '').toLowerCase().includes(w) || name.toLowerCase().includes(w));
    if (!srcId) continue;
    const url = s.url || '';
    const innerUrl = inner(url);
    // dedupe by inner origin+path prefix
    let key; try { const u = new URL(innerUrl); key = u.host + u.pathname.slice(0, 30); } catch { key = innerUrl.slice(0, 40); }
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`\n### ${srcId} :: ${key}`);
    const direct = url === innerUrl;
    if (direct) {
      // nexabloom / nhdapi / other direct: test no-referer + with-referer + dump headers
      const noRef = await fetchCard(url);
      console.log(`  direct no-ref : ${noRef.status} ${noRef.ct.slice(0, 40)} ${noRef.err || ''} | ${noRef.body.slice(0, 80).replace(/\n/g, ' ')}`);
      if (noRef.status === 403 || noRef.ct.includes('html')) {
        const h = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' }).catch(e => null);
        if (h) {
          const hd = {};
          h.headers.forEach((v, k) => { hd[k] = v; });
          console.log('  headers:', JSON.stringify({ server: hd.server, cfRay: hd['cf-ray'] ? 'yes' : undefined, cfMjt: hd['cf-mitigated'], via: hd.via, cLength: hd['content-length'] }));
          try { await h.body.cancel(); } catch {}
        }
        for (const ref of ['https://itachi.su/', 'https://animekoto.xyz/', 'https://self.strem.io/']) {
          const w = await fetchCard(url, { referer: ref });
          console.log(`  direct ref=${ref.slice(8, 20)}: ${w.status} ${w.ct.slice(0, 40)} | ${w.body.slice(0, 50).replace(/\n/g, ' ')}`);
        }
      }
    } else {
      // proxied: walk the tree as the player would (normalize dev https→http)
      const proxiedUrl = url.replace('https://127.0.0.1:4596', `http://127.0.0.1:${PORT}`);
      const tree = await walkM3u8(proxiedUrl);
      for (const step of tree) console.log(`  d${step.depth} ${step.status} ${step.ct || ''} ${step.head || step.note || ''} ${step.url ? ':: ' + step.url.slice(0, 110) : ''}`);
    }
  }
} finally {
  proc.kill('SIGKILL');
}
