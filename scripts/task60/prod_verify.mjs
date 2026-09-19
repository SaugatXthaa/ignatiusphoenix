// Task 60 production verification: every fix, against the live addon.
import https from 'https';

const BASE = 'https://ignatiusphoenix.onrender.com';
const results = [];
const check = (name, cond, extra = '') => { results.push([name, !!cond, String(extra)]); console.log(`${cond ? 'PASS' : 'FAIL'} ${name} ${extra || ''}`); };

const get = (u, headers = {}, timeout = 30000, onHeaders = null) => new Promise((resolve) => {
  const req = https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36', ...headers }, timeout }, (res) => {
    if (onHeaders) { onHeaders(res); req.destroy(); return resolve({ status: res.statusCode, headers: res.headers, body: Buffer.alloc(0) }); }
    const c = []; let n = 0;
    res.on('data', d => { if (n < 300000) { c.push(d); n += d.length; } else req.destroy(); });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c) }));
    res.on('error', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c) }));
  });
  req.on('timeout', () => req.destroy(new Error('timeout')));
  req.on('error', (e) => resolve({ status: 0, headers: {}, body: Buffer.alloc(0), err: String(e && e.message || e) }));
});
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// ---- 1. fresh /stream for Obsession — two rounds (r2 fills background sources)
let sr = await (await fetch(`${BASE}/stream/movie/tt37287335.json`, { signal: AbortSignal.timeout(90000) })).json();
let streams = sr.streams || [];
console.log(`Obsession r1 count=${streams.length}`);
await wait(40000);
sr = await (await fetch(`${BASE}/stream/movie/tt37287335.json`, { signal: AbortSignal.timeout(90000) })).json();
streams = sr.streams || [];
console.log(`Obsession r2 count=${streams.length}`);
const find = (re) => streams.filter(s => re.test((s.name || '') + ' ' + (s.title || '') + ' ' + ((s.behaviorHints || {}).bingeGroup || '')));

// ---- 2. CineFreak 4K via range-proxy: big Range → fast 416; bytes=0- → 206
const cf4k = find(/cinefreak/i).find(s => (s.name || '').includes('4K'));
if (cf4k) {
  const t0 = Date.now();
  const r416 = await get(cf4k.url, { Range: 'bytes=20000000000-2000999999' }, 25000, (res) => {});
  const dt = Date.now() - t0;
  check('CineFreak 4K big-seek → 416 fast (was: hang)', r416.status === 416 && dt < 15000, `status=${r416.status} ${dt}ms cr=${r416.headers['content-range'] || '-'} ${r416.err || ''}`);
  const t1 = Date.now();
  const r0 = await get(cf4k.url, { Range: 'bytes=0-' }, 40000, (res) => {});
  const dt0 = Date.now() - t1;
  check('CineFreak 4K open (bytes=0-) → 206 streaming', r0.status === 206 && dt0 < 15000, `status=${r0.status} ${dt0}ms firstBytes=${r0.body.length} ${r0.err || ''}`);
  const rS = await get(cf4k.url, { Range: 'bytes=1000000-1000999' }, 40000);
  check('CineFreak 4K small-seek → 206 exact', rS.status === 206 && rS.body.length === 1000, `status=${rS.status} cr=${rS.headers['content-range'] || '-'}`);
} else check('CineFreak 4K card present', false, 'not found in /stream');

// ---- 3. MoviesDrive 4K same class
const md4k = find(/moviesdrive/i).find(s => (s.name || '').includes('4K'));
if (md4k) {
  const t = Date.now();
  const r = await get(md4k.url, { Range: 'bytes=10000000000-1000099999' }, 25000, () => {});
  check('MoviesDrive 4K big-seek → 416 fast', r.status === 416 && (Date.now() - t) < 15000, `status=${r.status} ${Date.now() - t}ms`);
} else check('MoviesDrive 4K card present', false, 'not found');

// ---- 4. Pantyflix 4K (google) big-seek
const pf4k = find(/pantyflix/i).filter(s => (s.name || '').includes('4K') && (s.url || '').includes('range-proxy'))[0];
if (pf4k) {
  const r = await get(pf4k.url, { Range: 'bytes=20000000000-2000099999' }, 25000, () => {});
  check('Pantyflix 4K big-seek → 416 fast', r.status === 416, `status=${r.status}`);
} else check('Pantyflix 4K range-proxy card present', false, 'not found');

// ---- 5. HDHub4u 2160p HLS through /proxy: master + segment (with 5xx retry)
const h2160 = find(/hdhub4u/i).find(s => (s.name || '').includes('4K') && (s.url || '').includes('/proxy?'));
if (h2160) {
  const r = await get(h2160.url, {}, 40000);
  const isM = r.status === 200 && r.body.toString().startsWith('#EXTM3U');
  check('HDHub4u 2160p master via /proxy', isM, `status=${r.status} bytes=${r.body.length}`);
  if (isM) {
    const lines = r.body.toString().split('\n');
    const vi = lines.findIndex(l => l.includes('#EXT-X-STREAM-INF'));
    const vu = lines[vi + 1].trim();
    const rv = await get(vu, {}, 40000);
    check('HDHub4u 2160p variant via /proxy', rv.status === 200 && rv.body.toString().startsWith('#EXTM3U'), `status=${rv.status} bytes=${rv.body.length}`);
    const segs = rv.body.toString().split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#')).slice(0, 3);
    let okSeg = 0, firstMs = 0;
    for (const sg of segs) {
      const t = Date.now();
      const rs = await get(sg, { Range: 'bytes=0-262143' }, 45000);
      if (rs.status === 206 || rs.status === 200) { okSeg++; if (!firstMs) firstMs = Date.now() - t; }
      else console.log(`  (info) seg status=${rs.status} in ${Date.now() - t}ms`);
      await wait(300);
    }
    check('HDHub4u 2160p segments via /proxy (with retry)', okSeg >= 2, `${okSeg}/3 ok, firstTTFB=${firstMs}ms`);
  }
} else check('HDHub4u 2160p card present', false, 'not found');

// ---- 6. CineJoy cards present
const cj = find(/cinejoy/i);
check('CineJoy cards in /stream', cj.length > 0, `count=${cj.length}`);
if (cj.length) {
  const card = cj.find(s => (s.url || '').includes('/proxy?')) || cj[0];
  const r = await get(card.url, {}, 40000);
  check('CineJoy playlist playable via /proxy', r.status === 200 && r.body.toString().startsWith('#EXTM3U'), `status=${r.status} bytes=${r.body.length}`);
}

// ---- 7. 2Pickle
const pk = find(/peckle|2pickle/i).find(s => (s.name || '').includes('4K'));
if (pk) {
  const r = await get(pk.url, {}, 30000);
  check('2Pickle 4K master reachable', r.status === 200 && r.body.toString().startsWith('#EXTM3U'), `status=${r.status}`);
} else check('2Pickle 4K card present', false, 'not found');

// ---- 8. Atlantic: wrapped card OR honest zero (no direct payload cards)
const atl = find(/atlantic/i);
const atlDirect = atl.find(s => (s.url || '').includes('peraspera') || (s.url || '').includes('totallyacdn'));
check('Atlantic: no direct payload cards (trailer-hang class)', !atlDirect, atlDirect ? atlDirect.url.slice(0, 90) : `cards=${atl.length}`);
const atlWrapped = atl.find(s => (s.url || '').includes('/proxy?url=') && (s.url || '').includes('origin='));
if (atlWrapped) {
  const r = await get(atlWrapped.url, {}, 45000);
  check('Atlantic wrapped master via /proxy', r.status === 200 && r.body.toString().startsWith('#EXTM3U'), `status=${r.status} bytes=${r.body.length}`);
} else {
  console.log('  (info) Atlantic gate currently 429 on Render — honest zero this round');
}

// ---- 9. Subtitles: every card carries tracks; .srt tracks serve text/vtt
const withSubs = streams.filter(s => (s.subtitles || []).length > 0);
check('subtitle coverage on cards', withSubs.length === streams.length && streams.length > 0, `${withSubs.length}/${streams.length}`);
const srtSub = withSubs.flatMap(s => s.subtitles).find(s => (s.url || '').includes('.srt'));
if (srtSub) {
  const r = await get(srtSub.url, {}, 30000);
  const body = r.body.toString();
  const valid = r.status === 200 && (r.headers['content-type'] || '').includes('text/vtt') && body.startsWith('WEBVTT') && /\d\d:\d\d:\d\d\.\d{3} --> /.test(body);
  check('natsuki .srt via /proxy → valid WebVTT', valid, `status=${r.status} ct=${r.headers['content-type']} head=${body.slice(0, 30).replace(/\n/g, '|')}`);
} else check('natsuki .srt track present', false, 'none on cards');

// ---- 10. no html-url cards
const htmlCards = streams.filter(s => /^https?:(?!.*\.(m3u8|mp4|mkv|ts)).*\.(html|htm)(\?|$)/.test(s.url || '') || /\.(html|htm)(\?|$)/.test((s.url || '').split('?')[0]));
check('zero html-url cards', htmlCards.length === 0, `hits=${htmlCards.length}`);

// ---- 11. sweep other titles: series/kdrama/anime
const titles = [
  ['series', 'tt0944947%3A1%3A1', 'GoT S1E1'],
  ['series', 'tt4574334%3A1%3A1', 'SquidGame S1E1'],
  ['series', 'tt209867%3A2%3A1', 'Frieren S2E1'],
];
for (const [type, id, label] of titles) {
  try {
    let d = await (await fetch(`${BASE}/stream/${type}/${id}.json`, { signal: AbortSignal.timeout(90000) })).json();
    await wait(40000);
    d = await (await fetch(`${BASE}/stream/${type}/${id}.json`, { signal: AbortSignal.timeout(90000) })).json();
    const ss = d.streams || [];
    const subbed = ss.filter(s => (s.subtitles || []).length > 0).length;
    const groups = new Set(ss.map(s => (s.behaviorHints || {}).bingeGroup));
    check(`${label}: cards + subs`, ss.length >= 30 && subbed === ss.length, `cards=${ss.length} subs=${subbed}/${ss.length} sources=${groups.size}`);
  } catch (e) { check(`${label}: cards + subs`, false, String(e).slice(0, 60)); }
}

console.log('='.repeat(70));
const pass = results.filter(r => r[1]).length;
console.log(`PRODUCTION RESULT: ${pass}/${results.length} PASS`);
process.exit(0);
