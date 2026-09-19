// Task 61 final: probe fresh cards (from the new deploy) through the player
// path — http+https, headers honored, HLS chain depth 1, retries x2.
import https from 'https';
import http from 'http';
import fs from 'fs';

const probes = JSON.parse(fs.readFileSync('/tmp/final_probe.json', 'utf8'));
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const get = (u, headers = {}, timeout = 18000, onHeaders = null) => new Promise((resolve) => {
  let req;
  try {
    const mod = u.startsWith('http://') ? http : https;
    req = mod.get(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36', ...headers }, timeout }, (res) => {
      if (onHeaders) { onHeaders(res); req.destroy(); return resolve({ status: res.statusCode, headers: res.headers, body: Buffer.alloc(0) }); }
      const c = []; let n = 0;
      res.on('data', d => { if (n < 300000) { c.push(d); n += d.length; } else req.destroy(); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c) }));
      res.on('error', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c) }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ status: 0, headers: {}, body: Buffer.alloc(0), err: String(e && e.message || e) }));
  } catch (e) { resolve({ status: -1, headers: {}, body: Buffer.alloc(0), err: String(e).slice(0, 100) }); }
});

const sniffHtml = (b) => /^\s*<(!doctype|html|\?xml)/i.test(b.slice(0, 100).toString());

function flatHeaders(h) {
  // proxyHeaders may be {request:{...}} (Nuvio convention) — flatten for the probe
  if (h && h.request && typeof h.request === 'object') return { ...h.request };
  return { ...(h || {}) };
}

async function probeCard(p) {
  const url = p.url;
  const hdrs = flatHeaders(p.hdrs);
  if (url.includes('/proxy?')) {
    const r = await get(url, {}, 18000);
    const head = r.body.toString('utf8', 0, 7);
    const isHls = head === '#EXTM3U';
    if (isHls) {
      const lines = r.body.toString().split('\n').map(s => s.trim());
      const vi = lines.findIndex(l => l.startsWith('#EXT-X-STREAM-INF'));
      if (vi >= 0 && lines[vi + 1]) {
        const rv = await get(lines[vi + 1], {}, 18000);
        const vhead = rv.body.toString('utf8', 0, 7);
        if (vhead === '#EXTM3U') {
          const seg = rv.body.toString().split('\n').map(s => s.trim()).find(l => l && !l.startsWith('#'));
          if (seg) {
            const rs = await get(seg, { Range: 'bytes=0-262143' }, 18000);
            return rs.status === 200 || rs.status === 206 ? `chain-ok seg=${rs.status}` : `chain-seg=${rs.status}`;
          }
          return 'chain-ok (no seg)';
        }
        return `variant=${rv.status}/${vhead.replace(/\n/g, '|')}`;
      }
      return 'master-media-ok';
    }
    const ct = r.headers['content-type'] || '';
    const ok = r.status === 200 && (head === 'WEBVTT' || /^video\/|^audio\//.test(ct)) && !sniffHtml(r.body);
    return ok ? `ok status=${r.status} ct=${ct}` : `status=${r.status} head=${head.replace(/\n/g, '|')} ct=${ct}`;
  }
  if (url.includes('/range-proxy?')) {
    const r = await get(url, { Range: 'bytes=0-65535', ...hdrs }, 18000);
    const ok = (r.status === 206 || r.status === 200) && !sniffHtml(r.body) && !/text\/html/i.test(r.headers['content-type'] || '');
    return ok ? `ok status=${r.status} ct=${r.headers['content-type']}` : `status=${r.status} ct=${r.headers['content-type']}`;
  }
  const r = await get(url, { Range: 'bytes=0-65535', ...hdrs }, 18000);
  const ok = (r.status === 206 || r.status === 200) && !sniffHtml(r.body) && !/text\/html/i.test(r.headers['content-type'] || '');
  return ok ? `ok status=${r.status} ct=${r.headers['content-type']}` : `status=${r.status} ct=${r.headers['content-type']} ${r.err || ''}`;
}

const results = [];
const bySrc = new Map();
for (const p of probes) { if (!bySrc.has(p.src)) bySrc.set(p.src, []); bySrc.get(p.src).push(p); }

let pass = 0, total = 0;
const srcPass = new Set(), srcFail = new Set();
for (const [src, cards] of [...bySrc.entries()].sort()) {
  for (const c of cards) {
    total++;
    let detail = '';
    for (let a = 0; a < 1; a++) {
      detail = await probeCard(c);
      if (/^ok|^chain-ok|^master-media-ok/.test(detail)) break;
      await wait(800);
    }
    const ok = /^ok|^chain-ok|^master-media-ok/.test(detail);
    if (ok) { pass++; srcPass.add(src); } else srcFail.add(src);
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${src.padEnd(16)} ${detail.slice(0, 90)}`);
    results.push({ src, url: c.url.slice(0, 100), ok, detail });
    fs.writeFileSync('/home/z/my-project/phoenix-analysis/scripts/task61/final_probe_results.json', JSON.stringify(results, null, 1));
  }
}
fs.writeFileSync('/home/z/my-project/phoenix-analysis/scripts/task61/final_probe_results.json', JSON.stringify(results, null, 1));
console.log('='.repeat(70));
console.log(`FINAL PLAYABILITY: ${pass}/${total} cards OK | sources with >=1 playable: ${srcPass.size}/${bySrc.size}`);
console.log('all-fail sources:', [...srcFail].filter(s => !srcPass.has(s)).join(', ') || 'NONE');
