// Deep-dive the Raflix anicine chain: full URL + direct fetch + proxy fetch
const BASE = 'http://127.0.0.1:4595';
const res = await fetch(`${BASE}/stream/movie/tt4154796.json`);
const { streams = [] } = await res.json();
const raf = streams.filter(s => /Raflix/i.test(s.name || ''));
if (!raf.length) { console.log('no raflix stream in response'); process.exit(0); }
const u = raf[0].url;
console.log('shipped URL:', decodeURIComponent(u).slice(0, 220));
console.log('format:', raf[0].format, '| behaviorHints:', JSON.stringify(raf[0].behaviorHints || {}));
// direct fetch of underlying URL
const m = String(u).match(/url=([^&]+)/);
if (m) {
  const underlying = decodeURIComponent(m[1]);
  console.log('\nunderlying:', underlying.slice(0, 200));
  try {
    const r2 = await fetch(underlying, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36', 'Referer': 'https://raflixx.vercel.app/' }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    const txt = await r2.text();
    console.log(`direct: ${r2.status} ct=${r2.headers.get('content-type')} len=${txt.length}`);
    console.log('head:', txt.slice(0, 180).replace(/\s+/g, ' '));
  } catch (e) { console.log('direct fetch FAIL:', e.message, e.cause?.message || ''); }
}
// proxy fetch with verbose error
console.log('\nvia addon /proxy:');
try {
  const r3 = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) });
  const t3 = await r3.text();
  console.log(`proxy: ${r3.status} ct=${r3.headers.get('content-type')} len=${t3.length} | head: ${t3.slice(0, 120).replace(/\s+/g, ' ')}`);
} catch (e) { console.log('proxy fetch FAIL:', e.message, e.cause?.message || ''); }
