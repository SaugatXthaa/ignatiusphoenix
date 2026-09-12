// task14_reverify.mjs — 2nd-pass verification of audit offenders with retries
const BASE = 'http://127.0.0.1:4595';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const OFFENDERS = ['4KHDHub', 'Cineby', 'DahmerMovies 4K', 'DahmerMovies', 'DesiFlix', 'HindMoviez', 'KMMovies', 'MovieBlast', 'VerHdLink', 'VidEasy', 'VidLink'];

function labelOf(s) {
  const name = (s.name || '').split('\n').map(t => t.trim()).filter(Boolean);
  const line = name.find(l => /PhoeniX/i.test(l)) || name[0] || '';
  const seg = line.split('·').map(t => t.trim());
  return seg.length >= 3 ? seg[2] : (seg[1] || line || 'unknown');
}

const res = await fetch(`${BASE}/stream/movie/tt4154796.json`, { signal: AbortSignal.timeout(90000) });
const { streams = [] } = await res.json();
const bySrc = new Map();
for (const s of streams) {
  const l = labelOf(s);
  if (!bySrc.has(l)) bySrc.set(l, []);
  bySrc.get(l).push(s);
}

function classify(buf, ct, status) {
  const head = buf.toString('utf8', 0, Math.min(buf.length, 300));
  if (status === 403 && /Just a moment|challenge/i.test(head)) return 'CF-CHALLENGE';
  if (status >= 400) return `HTTP-${status}`;
  if (/#EXTM3U/.test(head)) return 'HLS';
  const hex = buf.toString('hex', 0, 4);
  if (hex.startsWith('47') || hex.startsWith('1a45') || buf.toString('hex', 4, 8) === '66747970' || /^(matroska|video\/|audio\/|application\/octet|binary)/i.test(ct || '')) return 'VIDEO';
  if (/^\s*(<!DOCTYPE|<html|<\?xml)/i.test(head) || /text\/html/i.test(ct || '')) return 'HTML';
  if (/^\s*[{\[]/.test(head) || /application\/json/i.test(ct || '')) return 'JSON';
  return 'OTHER';
}

async function probeDeep(url, tag) {
  const u = url.replace('https://127.0.0.1:4595', 'http://127.0.0.1:4595');
  const attempts = [];
  for (const range of ['bytes=0-2047', null]) {
    for (let i = 0; i < 2; i++) {
      try {
        const headers = { 'User-Agent': UA };
        if (range) headers.Range = range;
        const r = await fetch(u, { headers, redirect: 'follow', signal: AbortSignal.timeout(25000) });
        const buf = Buffer.from((await r.arrayBuffer()).slice(0, 2048));
        const v = classify(buf, r.headers.get('content-type'), r.status);
        attempts.push(v);
        if (v === 'HLS' || v === 'VIDEO') break;
      } catch (e) { attempts.push(/abort|timeout/i.test(e.message) ? 'TIMEOUT' : 'ERR'); }
    }
    if (attempts.some(a => a === 'HLS' || a === 'VIDEO')) break;
  }
  const good = attempts.filter(a => a === 'HLS' || a === 'VIDEO').length;
  console.log(`  ${good > 0 ? '✅ RECOVERS' : '❌ CONFIRMED-BAD'} [${tag}] ${attempts.join(' → ')} | ${url.replace(/^https?:\/\/[^/]+/, '').slice(0, 72)}`);
  return good > 0;
}

console.log(`re-verifying ${OFFENDERS.length} offenders against ${streams.length} streams...\n`);
for (const label of OFFENDERS) {
  const list = bySrc.get(label) || [];
  if (!list.length) { console.log(`  ⚪ ${label}: not in current response`); continue; }
  console.log(`${label} (${list.length} streams):`);
  for (const s of list.slice(0, 2)) {
    const u = s.url || s.externalUrl;
    if (!u) { console.log('  ❌ NO-URL'); continue; }
    await probeDeep(u, (s.name || '').includes('4K') ? '4K' : '1080p');
  }
}
