// Task 42: diff failing (videasy/cineby) vs passing (watchseries) peakstorm cards
import { spawn } from 'node:child_process';

const PORT = 4596;
const BASE = `http://127.0.0.1:${PORT}`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

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

function norm(u) { return (u || '').replace(/^https:\/\/127\.0\.0\.1:4596/, BASE); }

async function get(url, headers = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, ...headers }, signal: ctrl.signal, redirect: 'follow' });
    const body = await res.text();
    return { status: res.status, ct: res.headers.get('content-type') || '', body };
  } catch (e) { return { status: 0, ct: '', body: '', err: String(e.message || e).slice(0, 60) }; }
  finally { clearTimeout(t); }
}

try {
  await waitReady();
  const r = await fetch(`${BASE}/stream/series/tmdb:209867:1:1.json`, { signal: AbortSignal.timeout(120000) });
  const all = (await r.json()).streams || [];

  const picks = {};
  for (const s of all) {
    const bg = s.behaviorHints?.bingeGroup || '';
    const m = /phoenix-([a-z0-9_]+)-/.exec(bg);
    if (!m) continue;
    const sid = m[1];
    if (!['videasy', 'cineby', 'watchseries', 'videasyto'].includes(sid)) continue;
    if (!(s.url || '').includes('peakstorm')) continue;
    if (!picks[sid]) picks[sid] = norm(s.url);
  }
  for (const [sid, url] of Object.entries(picks)) console.log(`\n[${sid}] ${decodeURIComponent(url).slice(0, 400)}`);

  // Walk the videasy tree
  const vurl = picks.videasy || picks.videasyto;
  if (vurl) {
    console.log('\n--- WALK videasy card as-is ---');
    const m0 = await get(vurl);
    console.log('master:', m0.status, m0.ct, (m0.err || ''));
    const child = m0.body.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))[0];
    console.log('child line:', (child || 'NONE').slice(0, 200));
    if (child) {
      const cu = new URL(child, vurl).href;
      console.log('child url:', decodeURIComponent(cu).slice(0, 300));
      const c1 = await get(cu);
      console.log('child:', c1.status, c1.ct, (c1.err || ''), '| head:', c1.body.slice(0, 50).replace(/\n/g, ' '));
    }
  }
  // Also compare: cineby card vs watchseries card with SAME inner path
  const wurl = picks.watchseries;
  const curl_ = picks.cineby;
  if (wurl && curl_) {
    const wInner = new URL(wurl).searchParams.get('url');
    const cInner = new URL(curl_).searchParams.get('url');
    console.log('\nwatch inner :', wInner.slice(0, 120));
    console.log('cineb inner :', cInner.slice(0, 120));
    console.log('same inner path?', wInner === cInner);
    console.log('watch params:', [...new URL(wurl).searchParams.keys()].join(','));
    console.log('cineb params:', [...new URL(curl_).searchParams.keys()].join(','));
  }
} finally {
  proc.kill('SIGKILL');
}
