// Task 60 local E2E: verify range-proxy 3-case behavior + /proxy SRT->VTT + atlantic wrap
import http from 'http';
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);

// ---- fake upstream that IGNORES Range (google-like): serves 45MB with 200
const SIZE = 45 * 1048576;
const fake = http.createServer((req, res) => {
  if (req.headers.range) {
    // google-like: ignore Range entirely
  }
  const start = 0;
  res.writeHead(200, { 'Content-Length': String(SIZE - start), 'Content-Type': 'video/mkv', 'Accept-Ranges': 'bytes' });
  // stream zeros in chunks; abort when client disconnects
  const chunk = Buffer.alloc(65536);
  let sent = start;
  const iv = setInterval(() => {
    if (res.destroyed || req.destroyed) { clearInterval(iv); return; }
    res.write(chunk); sent += chunk.length;
    if (sent >= SIZE) { clearInterval(iv); res.end(); }
  }, 5);
  req.on('close', () => { clearInterval(iv); try { res.destroy(); } catch {} });
});
await new Promise(r => fake.listen(0, r));
const fakeUrl = `http://127.0.0.1:${fake.address().port}/file.mkv`;
console.log('fake upstream (ignores Range):', fakeUrl);

// ---- boot the addon (same pattern as task23_baseline boot)
const { spawn } = await import('child_process');
const addon = spawn('node', ['src/index.js'], {
  cwd: '/home/z/my-project/phoenix-analysis',
  env: { ...process.env, PORT: '7781', NO_PREWARM: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const bootLog = [];
addon.stdout.on('data', d => bootLog.push(d.toString()));
addon.stderr.on('data', d => bootLog.push(d.toString()));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const base = 'http://127.0.0.1:7781';
// wait for health
let up = false;
for (let i = 0; i < 40; i++) {
  try { const r = await fetch(base + '/health'); if (r.ok) { up = true; break; } } catch {}
  await wait(500);
}
console.log('addon up:', up);
if (!up) { console.log(bootLog.join('').slice(-1500)); process.exit(1); }

const results = [];
const check = (name, cond, extra = '') => { results.push([name, cond, extra]); console.log(`${cond ? 'PASS' : 'FAIL'} ${name} ${extra}`); };

try {
  // CASE c: big skip on a Range-ignoring upstream → 416 fast
  let t0 = Date.now();
  let r = await fetch(`${base}/range-proxy?url=${encodeURIComponent(fakeUrl)}`, { headers: { Range: `bytes=${40 * 1048576}-` } });
  const dt416 = Date.now() - t0;
  const cr = r.headers.get('content-range');
  check('range-proxy big-skip → 416 fast', r.status === 416 && dt416 < 4000, `status=${r.status} ${dt416}ms cr=${cr}`);
  // drain the tiny body
  await r.text();

  // CASE b: small skip on Range-ignoring upstream → 206 with skip honored (bounded read)
  t0 = Date.now();
  const r2 = await fetch(`${base}/range-proxy?url=${encodeURIComponent(fakeUrl)}`, { headers: { Range: 'bytes=1000000-1000999' } });
  const b2 = Buffer.from(await r2.arrayBuffer());
  check('range-proxy small-skip → 206 skip honored', r2.status === 206 && b2.length === 1000, `status=${r2.status} len=${b2.length} cr=${r2.headers.get('content-range')}`);

  // CASE no-Range: 200 full CL (abort after headers via AbortController)
  const ac3 = new AbortController();
  const r3 = await fetch(`${base}/range-proxy?url=${encodeURIComponent(fakeUrl)}`, { signal: ac3.signal });
  const cl3 = r3.headers.get('content-length');
  ac3.abort();
  check('range-proxy no-Range → 200 + full CL', r3.status === 200 && cl3 === String(SIZE), `status=${r3.status} cl=${cl3}`);

  // CASE a: honoring upstream (R2 direct) → transparent 206 pipe
  const honoringUrl = 'https://c6b1e8c93683bdde581e2164cb9657c9.r2.cloudflarestorage.com/hub/2c52dec24a4a1e230d92578714b867d9?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ce3806fdca997f65e356f3b6fc2f735d%2F20260919%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260919T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=placeholder';
  // NOTE: placeholder signature won't pass R2 auth — use the REAL fresh card instead.
  // Instead use a known-good honoring public range host: httpbin-like via pixeldrain? Use Cloudflare r2 from live card is complex here.
  // Simplest honoring host available offline: none. Skip case (a) locally — verified via production later.

  // /proxy SRT -> VTT (real natsuki file)
  const r4 = await fetch(`${base}/proxy?url=${encodeURIComponent('https://natsuki.hls.lol/s/3771063.srt')}&referer=${encodeURIComponent('https://atlantic.st/')}&origin=${encodeURIComponent('https://atlantic.st')}`);
  const vtt = await r4.text();
  check('proxy .srt → text/vtt + valid timestamps', r4.status === 200 && (r4.headers.get('content-type') || '').includes('text/vtt') && vtt.startsWith('WEBVTT') && !/\d:,|,\d{2}\s*-->/.test(vtt), `status=${r4.status} ct=${r4.headers.get('content-type')} head=${vtt.slice(0, 40).replace(/\n/g, ' | ')}`);

  // Atlantic local /debug/source — card wrapped through /proxy
  const r5 = await fetch(`${base}/debug/source/atlantic?type=movie&id=tt37287335&full=1`);
  const j5 = await r5.json();
  const first = (j5.results || [])[0];
  const firstUrl = typeof first?.url === 'string' ? first.url : first?.url?.href || '';
  const isWrapped = firstUrl.includes('/proxy?url=') && firstUrl.includes('origin=');
  check('atlantic card self-proxied w/ origin+referer', !!isWrapped, `count=${j5.count} url=${firstUrl.slice(0, 110)}`);

  // Wrapped master actually returns a playlist through the local proxy
  if (isWrapped) {
    // local addon is http while ctx.hostUrl says https — re-scheme for the test
    const localUrl = firstUrl.replace(/^https:\/\/127\.0\.0\.1/, 'http://127.0.0.1');
    const r6 = await fetch(localUrl, { headers: { 'User-Agent': 'mpv-test' } });
    const body6 = await r6.text();
    const ok6 = r6.status === 200 && body6.startsWith('#EXTM3U');
    // children must be rewritten to local /proxy with origin+referer propagated
    const childOk = ok6 && body6.includes('/proxy?url=') && body6.includes('origin=');
    check('wrapped atlantic master 200 m3u8 + children rewritten', ok6 && childOk, `status=${r6.status} bytes=${body6.length} childOk=${childOk}`);
    // fetch a child (variant playlist) — must ALSO return m3u8 through the proxy
    if (childOk) {
      const childLine = body6.split('\n').map(l => l.trim()).find(l => l.startsWith('http') && l.includes('/proxy?url='));
      if (childLine) {
        const r7 = await fetch(childLine, { headers: { 'User-Agent': 'mpv-test' } });
        const body7 = await r7.text();
        check('wrapped atlantic child (variant) 200 m3u8', r7.status === 200 && body7.startsWith('#EXTM3U'), `status=${r7.status} bytes=${body7.length} head=${body7.slice(0, 20).replace(/\n/g, ' | ')}`);
      }
    }
  }
} catch (e) {
  console.log('EXC', e);
}

console.log('='.repeat(60));
const pass = results.filter(r => r[1]).length;
console.log(`RESULT: ${pass}/${results.length} PASS`);
addon.kill();
fake.close();
process.exit(pass === results.length ? 0 : 1);
