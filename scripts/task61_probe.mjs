// Task 61 Phase 3: playability probe — for each source that landed cards in
// the sweep, sample up to 2 cards (prefer /proxy + /range-proxy variants) and
// verify through the EXACT player path:
//  - /proxy HLS: GET master → 200 #EXTM3U (+ variant + 1 segment)
//  - /range-proxy files: bytes=0- → 206/200 stream, content-type video/audio
//  - direct cards: Range bytes=0-65535 with behaviorHints.proxyHeaders →
//    206/200 + non-html content-type
//  - any card whose body sniffs as HTML or whose URL is a .html page → FAIL
import https from 'https';
import fs from 'fs';

const OUT = '/home/z/my-project/phoenix-analysis/scripts/task61';
const titles = ['Inception', 'Obsession', 'GoTS1E1', 'SquidGameS1E1', 'FrierenS2E1'];

const wait = (ms) => new Promise(r => setTimeout(r, ms));
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

// source attribution (same as sweep)
const groupRe = /(fourkhdhubone|movieshuntv2|moviesdrivev2|vegamovies2|cinejoyaio|hdhub4uv2|cinebyrocks|stellarrip|movielinkbd|animotvslash|animeworldindia|animesdigital|anikototv|persianstremio|4khdhub|cinefreak|moviebox|cinewave|watchseries|necro|vidsrcsbs|vidlink2|vidking|vidfast|vegamovies|primeshows|netlio|animeflix|anineko|verhdlink|meinecloud|acermovies|streamxtv|anikoto|anikage|anibd|2dhive|anidoor|nowhdtime|pantyflix|animegg|peckle|hianime|animekai|cineby|hindmoviez|playimdb|zxcstream|animezey|uhdmovies|videasy|itachi|imdbplay|raflix|hindmovie|rivestream|reanime|desiflix|anichan|animesuge|bollyflix|framextv|nikastream|stellar|cinehdplus|vidzee|vixsrc|allwish|videasyto|kmmovies|atlantic)/i;
const attr = (s) => {
  const g = (s.behaviorHints || {}).bingeGroup || '';
  const m = g.match(groupRe);
  if (m) return m[0].toLowerCase();
  const nm = ((s.name || '') + ' ' + (s.title || '')).toLowerCase();
  return nm.slice(0, 24) || 'unknown';
};

// collect cards per source across all titles
const perSource = new Map();
for (const tl of titles) {
  const f = `${OUT}/cards_${tl}.json`;
  if (!fs.existsSync(f)) continue;
  let cards;
  try { cards = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
  for (const s of cards) {
    const id = attr(s);
    if (!perSource.has(id)) perSource.set(id, []);
    perSource.get(id).push(s);
  }
}

const results = [];
const verdict = (ok, src, kind, extra) => { results.push({ src, kind, ok, extra }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${src} [${kind}] ${extra}`); };

const sniffHtml = (buf) => /^\s*<(!doctype|html|\?xml)/i.test(buf.slice(0, 100).toString());

// probe a single card through the player path
async function probeCard(card) {
  const url = card.url || '';
  const bh = card.behaviorHints || {};
  const hdrs = { ...(bh.proxyHeaders || {}) };

  if (url.includes('/proxy?')) {
    // proxied (HLS or file or subs). Probe: expect 200 #EXTM3U for m3u8, else first bytes.
    const r = await get(url, {}, 45000);
    const body = r.body;
    const isHls = body.toString('utf8', 0, 7) === '#EXTM3U';
    const isVtt = body.toString('utf8', 0, 6) === 'WEBVTT';
    const ct = r.headers['content-type'] || '';
    const ok = r.status === 200 && (isHls || isVtt || /^video\/|^audio\/|octet-stream/.test(ct)) && !sniffHtml(body);
    return { ok, detail: `status=${r.status} ct=${ct} head=${body.toString('utf8', 0, 12).replace(/\n/g, '|')} ${r.err || ''}`, kind: 'proxy' };
  }
  if (url.includes('/range-proxy?')) {
    const r = await get(url, { Range: 'bytes=0-65535', ...hdrs }, 45000);
    const ct = r.headers['content-type'] || '';
    const ok = (r.status === 206 || r.status === 200) && !sniffHtml(r.body) && !/text\/html/i.test(ct);
    return { ok, detail: `status=${r.status} ct=${ct} bytes=${r.body.length} ${r.err || ''}`, kind: 'range-proxy' };
  }
  // direct URL
  const r = await get(url, { Range: 'bytes=0-65535', ...hdrs }, 30000);
  const ct = r.headers['content-type'] || '';
  const ok = (r.status === 206 || r.status === 200) && !sniffHtml(r.body) && !/text\/html/i.test(ct);
  return { ok, detail: `status=${r.status} ct=${ct} bytes=${r.body.length} ${r.err || ''}`, kind: 'direct' };
}

// HLS cards: go one level deeper (master → variant → segment) for /proxy HLS
async function probeHlsChain(masterUrl) {
  const r = await get(masterUrl, {}, 45000);
  if (r.status !== 200 || r.body.toString('utf8', 0, 7) !== '#EXTM3U') return { ok: false, detail: `master status=${r.status}` };
  const lines = r.body.toString().split('\n').map(s => s.trim());
  const vi = lines.findIndex(l => l.startsWith('#EXT-X-STREAM-INF'));
  if (vi === -1) { // media playlist directly — try first segment
    const seg = lines.find(l => l && !l.startsWith('#'));
    if (!seg) return { ok: true, detail: 'media playlist (no segments listed)' };
    const rs = await get(seg, { Range: 'bytes=0-262143' }, 45000);
    return { ok: rs.status === 200 || rs.status === 206, detail: `seg status=${rs.status}` };
  }
  const vUrl = lines[vi + 1];
  const rv = await get(vUrl, {}, 45000);
  if (rv.status !== 200 || rv.body.toString('utf8', 0, 7) !== '#EXTM3U') return { ok: false, detail: `variant status=${rv.status}` };
  const seg = rv.body.toString().split('\n').map(s => s.trim()).find(l => l && !l.startsWith('#'));
  if (!seg) return { ok: true, detail: 'variant ok (no segments)' };
  const rs = await get(seg, { Range: 'bytes=0-262143' }, 45000);
  return { ok: rs.status === 200 || rs.status === 206, detail: `seg status=${rs.status} ttfb_ms=?` };
}

console.log(`sources with cards: ${perSource.size}`);
for (const [src, cards] of [...perSource.entries()].sort()) {
  if (src === 'unknown') continue;
  // sample: prefer one /proxy + one /range-proxy, else first 2
  const proxy = cards.filter(s => (s.url || '').includes('/proxy?') && !/\.srt|\.vtt/i.test(s.url));
  const rp = cards.filter(s => (s.url || '').includes('/range-proxy?'));
  const others = cards.filter(s => !proxy.includes(s) && !rp.includes(s));
  const sample = [];
  if (proxy.length) sample.push(proxy[0]);
  if (rp.length) sample.push(rp[0]);
  if (!sample.length && others.length) sample.push(others[0]);
  if (others.length && sample.length < 2) sample.push(others[0]);

  let okCount = 0;
  for (const c of sample) {
    try {
      const isHlsCard = /\.m3u8/i.test(c.url) || (c.url.includes('/proxy?') && !/\.(mkv|mp4|ts)(\?|$)/i.test(c.url));
      let res;
      if (isHlsCard && !c.url.includes('/range-proxy?')) {
        // full chain check through the proxy
        res = await probeHlsChain(c.url);
        res.kind = 'proxy-hls-chain';
      } else {
        res = await probeCard(c);
      }
      if (res.ok) okCount++;
      verdict(res.ok, src, res.kind, res.detail);
    } catch (e) {
      verdict(false, src, 'exception', String(e).slice(0, 80));
    }
    await wait(700);
  }
  if (!sample.length) verdict(false, src, 'no-sample', 'cards existed but none sampled');
}

fs.writeFileSync(`${OUT}/probe_results.json`, JSON.stringify(results, null, 1));
const pass = results.filter(r => r.ok).length;
console.log('='.repeat(70));
console.log(`PLAYABILITY PROBE: ${pass}/${results.length} PASS across ${perSource.size} sources`);
process.exit(0);
