// Task 62: understand google's REAL Range behavior (direct, no proxy in the middle).
import fs from 'fs';
const url = fs.readFileSync('/tmp/md4k_target.txt','utf8');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function t(label, range) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Range: range }, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    console.log(`${label}: status=${res.status} loc=${(res.headers.get('location') || '-').slice(0, 60)} crange=${res.headers.get('content-range')} ctype=${res.headers.get('content-type')}`);
    if (res.status >= 300 && res.status < 400) { res.body?.cancel?.(); return; }
    const reader = res.body.getReader();
    let bytes = 0;
    while (bytes < 512 * 1024) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; }
    reader.cancel().catch(() => {});
    console.log(`  read ${bytes}B in ${Date.now() - t0}ms`);
  } catch (e) { console.log(`${label}: ERROR ${String(e).slice(0, 90)}`); }
}

await t('no-range      ', null);
await t('bytes=0-      ', 'bytes=0-');
await t('bytes=1M-     ', 'bytes=1000000-');
await t('bytes=24M+1-  ', 'bytes=25165825-');
await t('bytes=1.9G-   ', 'bytes=1900000000-');
await t('bytes=10.8G-1M', 'bytes=10800000000-');
