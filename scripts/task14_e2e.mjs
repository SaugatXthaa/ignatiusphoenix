// Task 14 E2E: full HLS tree through the addon /proxy (local http fix)
const BASE = 'http://127.0.0.1:4595';
const res = await fetch(`${BASE}/stream/movie/tt4154796.json`);
const { streams = [] } = await res.json();
const raf = streams.filter(s => /CinePro/.test(s.name || ''));
console.log(`CinePro streams: ${raf.length}`);
if (!raf.length) process.exit(1);

let idx = 0;
for (const s of raf.slice(0, 1)) {
  const proxyUrl = String(s.url).replace('https://127.0.0.1:4595', 'http://127.0.0.1:4595');
  console.log(`\n[${++idx}] ${(s.name || '').replace(/\n/g, ' ')} @1080p label-ok`);
  const r1 = await fetch(proxyUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30000) });
  const master = await r1.text();
  console.log(`  master: ${r1.status} ct=${r1.headers.get('content-type')} EXTM3U=${master.includes('#EXTM3U')} len=${master.length}`);
  const variantLine = master.split('\n').find(l => l && !l.startsWith('#'));
  console.log(`  variant line: ${variantLine?.slice(0, 100)}`);
  if (variantLine) {
    const vUrl = variantLine.startsWith('http') ? variantLine : new URL(variantLine, proxyUrl).href;
    const r2 = await fetch(vUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30000) });
    const variant = await r2.text();
    const segLine = variant.split('\n').find(l => l && !l.startsWith('#'));
    console.log(`  variant: ${r2.status} EXTM3U=${variant.includes('#EXTM3U')} | seg: ${segLine?.slice(0, 90)}`);
    if (segLine) {
      const sUrl = segLine.startsWith('http') ? segLine : new URL(segLine, vUrl).href;
      const r3 = await fetch(sUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30000) });
      const seg = Buffer.from(await r3.arrayBuffer());
      const magic = seg.toString('hex', 0, 4);
      console.log(`  segment: ${r3.status} len=${seg.length} magic=${magic} ${magic.startsWith('47') || magic.startsWith('08') || seg[0] === 0x47 ? '✅ MPEG-TS' : magic.startsWith('1a45') ? '✅ webm' : magic.startsWith('fff') ? '✅ mp3/aac' : '⚠️ unknown'}`);
    }
  }
}
console.log('\nE2E DONE');
