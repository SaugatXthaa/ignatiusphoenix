// Task 60: measure sustained HLS segment throughput through a chain (master->variant->N segments)
import https from 'https';

const url = process.argv[2];
const nSeg = parseInt(process.argv[3] || '5', 10);
if (!url) { console.error('usage: node hls_throughput.mjs <master-url> [nseg]'); process.exit(1); }

const get = (u, redirs = 0) => new Promise((res) => {
  https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36' }, timeout: 40000 }, (r) => {
    if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && redirs < 3) {
      r.resume();
      return get(new URL(r.headers.location, u).href, redirs + 1).then(res);
    }
    const c = []; r.on('data', d => c.push(d)); r.on('end', () => res({ st: r.statusCode, b: Buffer.concat(c) }));
  }).on('error', e => res({ st: 0, b: Buffer.alloc(0), e: String(e) })).on('timeout', function () { this.destroy(new Error('timeout')); });
});

(async () => {
  const t0 = Date.now();
  const m = await get(url);
  console.log('master', m.st, m.b.length + 'B', '+' + (Date.now() - t0) + 'ms', m.e || '');
  if (m.st !== 200) process.exit(1);
  const lines = m.b.toString().split('\n');
  const vi = lines.findIndex(l => l.includes('#EXT-X-STREAM-INF'));
  const vu = new URL(lines[vi + 1].trim(), url).href;
  const t1 = Date.now();
  const v = await get(vu);
  console.log('variant', v.st, v.b.length + 'B', '+' + (Date.now() - t1) + 'ms');
  if (v.st !== 200) process.exit(1);
  const segs = v.b.toString().split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#')).slice(0, nSeg);
  let tot = 0, t2 = Date.now();
  for (let i = 0; i < segs.length; i++) {
    const s0 = Date.now(); const r = await get(new URL(segs[i], vu).href);
    tot += r.b.length;
    console.log(`seg${i}: ${r.st} ${r.b.length}B +${Date.now() - s0}ms ${r.e || ''}`);
  }
  const dt = (Date.now() - t2) / 1000;
  console.log(`THROUGHPUT: ${(tot / dt / 1048576).toFixed(2)} MB/s = ${(tot / dt * 8 / 1048576).toFixed(2)} Mbps over ${dt.toFixed(1)}s`);
})();
