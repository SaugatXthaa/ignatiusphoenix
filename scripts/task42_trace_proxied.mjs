// Trace proxied peakstorm chain: master via /proxy → rewritten child → fetch child via /proxy
import { spawn } from 'node:child_process';

const PORT = 4596;
const BASE = `http://127.0.0.1:${PORT}`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const proc = spawn('node', ['src/index.js'], {
  cwd: '/home/z/my-project/phoenix-analysis',
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'ignore', 'pipe'],
});
proc.stderr.on('data', d => { const s = d.toString(); if (/proxy|peakstorm|wisehive/i.test(s)) process.stderr.write('[srv] ' + s.slice(0, 250)); });

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/manifest.json`, { signal: AbortSignal.timeout(1500) }); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('not ready');
}
try {
  await waitReady();
  const r = await fetch(`${BASE}/debug/source/videasy?type=series&id=tmdb:209867:1:1&full=1`, { signal: AbortSignal.timeout(60000) });
  const data = await r.json();
  const card = (data.results || []).find(x => (x.url || '').includes('peakstorm'));
  if (!card) { console.log('no peakstorm card this run:', JSON.stringify((data.results || []).map(x => x.url?.slice(0, 100)))); process.exit(0); }

  // Build the FINAL card exactly like NuvioExtractor/StreamResolver would: /proxy + referer
  const ref = card.meta?.headers?.Referer || card.meta?.nuvioReferer || '';
  const pu = new URL(`${BASE}/proxy`);
  pu.searchParams.set('url', card.url);
  if (ref) pu.searchParams.set('referer', ref);
  console.log('PROXIED MASTER:', pu.href.slice(0, 160), '\n');

  const r1 = await fetch(pu.href, { signal: AbortSignal.timeout(15000), headers: { 'user-agent': UA } });
  const t1 = await r1.text();
  console.log('MASTER via /proxy status', r1.status, 'ct:', r1.headers.get('content-type'));
  const lines = t1.split('\n').map(l => l.trim()).filter(Boolean);
  console.log(t1.slice(0, 400));
  const child = lines.filter(l => !l.startsWith('#'))[0];
  if (!child) { console.log('NO CHILD LINE'); process.exit(0); }
  console.log('\nCHILD LINE (rewritten):', child.slice(0, 260), '\n');
  const cu = new URL(child, pu.href).href;
  const r2 = await fetch(cu, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': UA } });
  console.log('CHILD via /proxy status', r2.status, 'ct:', r2.headers.get('content-type'));
  const reader = r2.body.getReader();
  const chunks = []; let got = 0;
  while (got < 4096) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; }
  const buf = Buffer.concat(chunks);
  console.log('first 32 hex:', buf.subarray(0, 32).toString('hex'));
  console.log('TS magic:', buf[0] === 0x47 && buf[188] === 0x47, '| starts-with-<:', buf[0] === 0x3c, '| ascii head:', JSON.stringify(buf.subarray(0, 80).toString('latin1')));
} finally { proc.kill('SIGKILL'); }
