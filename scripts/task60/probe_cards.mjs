// Task 60: probe the exact cards the user circled as "stuck on loading"
// Player-path semantics: master -> variant -> first segment for HLS;
// Range 0-/mid-file for MP4. No source-code changes here.
import https from 'https';
import http from 'http';
import { URL } from 'url';
import { fileURLToPath } from 'url';
import path from 'path';

const F = (u, opts = {}, timeout = 25000) => new Promise((resolve) => {
  const url = new URL(u);
  const mod = url.protocol === 'http:' ? http : https;
  const req = mod.request(url, { method: 'GET', ...opts, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', ...(opts.headers || {}) }, timeout }, (res) => {
    const chunks = [];
    let len = 0;
    res.on('data', (c) => { if (len < 262144) { chunks.push(c); len += c.length; } else req.destroy(); });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    res.on('error', (e) => resolve({ status: res.statusCode || 0, headers: res.headers || {}, body: Buffer.concat(chunks), err: String(e) }));
  });
  req.on('timeout', () => { req.destroy(new Error('timeout')); });
  req.on('error', (e) => resolve({ status: 0, headers: {}, body: Buffer.alloc(0), err: String(e && e.message || e) }));
  req.end();
});

const ms = (t0) => Date.now() - t0;

async function probeHls(label, url, depth = 0) {
  const t0 = Date.now();
  const r = await F(url);
  const ct = r.headers['content-type'] || '';
  const body = r.body.toString('utf8', 0, 4000);
  const isM3u8 = /#EXTM3U/.test(body);
  console.log(`[${label}] +${ms(t0)}ms GET ${url.slice(0, 130)}`);
  console.log(`   status=${r.status} ct=${ct} bytes=${r.body.length} m3u8=${isM3u8}${r.err ? ' err=' + r.err : ''}`);
  if (r.status !== 200 || !isM3u8) {
    if (r.body.length < 800) console.log('   body:', body.slice(0, 300).replace(/\n/g, ' | '));
    return;
  }
  // master? pick highest-bandwidth / highest-resolution variant
  const lines = r.body.toString('utf8').split('\n');
  const variants = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('#EXT-X-STREAM-INF')) {
      const res = /RESOLUTION=(\d+)x(\d+)/.exec(lines[i]);
      const bw = /BANDWIDTH=(\d+)/.exec(lines[i]);
      const uri = (lines[i + 1] || '').trim();
      variants.push({ w: res ? +res[1] : 0, bw: bw ? +bw[1] : 0, uri });
    }
  }
  if (variants.length) {
    variants.sort((a, b) => b.w - a.w || b.bw - a.bw);
    const v = variants[0];
    const abs = new URL(v.uri, url).href;
    console.log(`   master: ${variants.length} variants, best=${v.w}p bw=${v.bw} -> ${abs.slice(0, 140)}`);
    if (depth < 2) await probeHls(label + '/variant', abs, depth + 1);
  } else {
    // media playlist: first segment
    const seg = lines.map(l => l.trim()).filter(l => l && !l.startsWith('#'))[0];
    if (seg) {
      const abs = new URL(seg, url).href;
      const t1 = Date.now();
      const s = await F(abs, {}, 30000);
      console.log(`   segment: +${ms(t1)}ms status=${s.status} ct=${s.headers['content-type']} bytes=${s.body.length} cr=${s.headers['content-range'] || '-'}${s.err ? ' err=' + s.err : ''}`);
    }
    const keys = lines.filter(l => l.includes('#EXT-X-KEY')).slice(0, 2);
    if (keys.length) console.log('   key-line:', keys[0].trim().slice(0, 160));
  }
}

async function probeFile(label, url, range = 'bytes=0-1048575') {
  const t0 = Date.now();
  const r = await F(url, { headers: { Range: range } }, 35000);
  console.log(`[${label}] +${ms(t0)}ms GET ${url.slice(0, 110)}`);
  console.log(`   status=${r.status} ct=${r.headers['content-type']} bytes=${r.body.length} cr=${r.headers['content-range'] || '-'} cl=${r.headers['content-length'] || '-'} ar=${r.headers['accept-ranges'] || '-'}${r.err ? ' err=' + r.err : ''}`);
  if (r.status >= 400 && r.body.length < 500) console.log('   body:', r.body.toString('utf8', 0, 300).replace(/\n/g, ' | '));
}

const cards = JSON.parse((await import('fs')).readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'cards.json'), 'utf8'));
const which = process.argv[2] || 'all';
for (const c of cards) {
  if (which !== 'all' && !c.label.includes(which)) continue;
  console.log('='.repeat(100));
  try {
    if (c.type === 'hls') await probeHls(c.label, c.url);
    else await probeFile(c.label, c.url, c.range);
  } catch (e) { console.log(`[${c.label}] EXC ${e}`); }
}
