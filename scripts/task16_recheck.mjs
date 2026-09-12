// Task 16 — recheck flagged offenders: NowHDTime(JSON), CineHDPlus(403), Pantyflix(OTHER)
const BASE = 'http://127.0.0.1:4598';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function labelOf(s) {
  const name = (s.name || '').split('\n').map(t => t.trim()).filter(Boolean);
  const line = name.find(l => /PhoeniX/i.test(l)) || name[0] || '';
  const seg = line.split('·').map(t => t.trim());
  return seg.length >= 3 ? seg[2] : (seg[1] || line || 'unknown');
}

async function probe(url) {
  const u = url.replace('https://127.0.0.1:4598', 'http://127.0.0.1:4598');
  try {
    const res = await fetch(u, { headers: { 'User-Agent': UA, Range: 'bytes=0-2047' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab.slice(0, 2048));
    const head = buf.toString('utf8', 0, Math.min(buf.length, 300));
    let cls;
    if (/#EXTM3U/.test(head)) cls = 'HLS';
    else if (/text\/html/i.test(res.headers.get('content-type') || '') || /^\s*(<!DOCTYPE|<html)/i.test(head)) cls = 'HTML';
    else if (/^\s*[{\[]/.test(head) || /application\/json/i.test(res.headers.get('content-type') || '')) cls = 'JSON';
    else cls = `status=${res.status} ct=${res.headers.get('content-type')} bytes=${buf.length} head=${head.slice(0, 60).replace(/\s+/g, ' ')}`;
    return cls;
  } catch (e) { return 'ERR ' + (e?.message || e).slice(0, 50); }
}

const targets = [
  { label: 'NowHDTime', path: 'movie/tt4154796' },
  { label: 'CineHDPlus', path: 'series/tt0903747:1:1' },
  { label: 'Pantyflix', path: 'series/tt0903747:1:1' },
  { label: 'PersianStremio', path: 'movie/tt4154796' },
];

for (const t of targets) {
  let streams = [];
  try {
    const res = await fetch(`${BASE}/stream/${t.path}.json`, { signal: AbortSignal.timeout(90000) });
    ({ streams = [] } = await res.json());
  } catch (e) { console.log(t.label, 'endpoint FAIL:', e.message); continue; }
  const urls = streams.filter(s => labelOf(s) === t.label).map(s => s.url || s.externalUrl).filter(Boolean);
  console.log(`\n=== ${t.label} on ${t.path}: ${urls.length} stream(s) ===`);
  for (const u of urls.slice(0, 3)) {
    console.log('  ', await probe(u), '|', u.slice(0, 95));
  }
}
