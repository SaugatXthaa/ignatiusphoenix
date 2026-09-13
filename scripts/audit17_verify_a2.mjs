// audit17_verify_a2.mjs — verify StreamXTV fallback embeds now resolve (or drop) in merged view
const BASE = process.env.TEST_BASE || 'http://127.0.0.1:4599';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function labelOf(s) {
  const name = (s.name || '').split('\n').map(t => t.trim()).filter(Boolean);
  const line = name.find(l => /PhoeniX/i.test(l)) || name[0] || '';
  const seg = line.split('·').map(t => t.trim());
  return seg.length >= 3 ? seg[2] : (seg[1] || line || 'unknown');
}

async function probe(url) {
  const u = url.replace('https://127.0.0.1:4599', 'http://127.0.0.1:4599').replace('https://127.0.0.1:4598', 'http://127.0.0.1:4598');
  try {
    const res = await fetch(u, { headers: { 'User-Agent': UA, Range: 'bytes=0-2047' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab.slice(0, 2048));
    const head = buf.toString('utf8', 0, Math.min(buf.length, 300));
    if (/#EXTM3U/.test(head)) return 'HLS';
    if (/text\/html/i.test(res.headers.get('content-type') || '') || /^\s*(<!DOCTYPE|<html)/i.test(head)) return `HTML(${res.status})`;
    if (/^\s*[{\[]/.test(head)) return `JSON(${res.status})`;
    const hex = buf.toString('hex', 0, 4);
    if (hex.startsWith('1a45') || head.startsWith('ftyp') || /video|octet|matroska/i.test(res.headers.get('content-type') || '')) return 'VIDEO';
    return `status=${res.status} ct=${res.headers.get('content-type')}`;
  } catch (e) { return 'ERR ' + String(e?.message || e).slice(0, 40); }
}

const path = process.argv[2] || 'series/tt0903747:1:1';
const res = await fetch(`${BASE}/stream/${path}.json`, { signal: AbortSignal.timeout(90000) });
const { streams = [] } = await res.json();
const st = streams.filter(s => /streamxtv/i.test(labelOf(s)) || /StreamXTV/i.test(s.name || ''));
console.log(`\n[${path}] total streams: ${streams.length} | StreamXTV cards: ${st.length}`);
for (const s of st.slice(0, 6)) {
  const url = s.url || s.externalUrl || '';
  const cls = await probe(url);
  console.log(`  ${cls.padEnd(12)} ${(url || '').slice(0, 95)}`);
}
// Also show what extractor ids landed for streamxtv
const log = await fetch(`${BASE}/debug/stream`, { signal: AbortSignal.timeout(15000) }).then(r => r.json()).catch(() => null);
if (log) {
  const sx = (log.timings || log.sources || []).find(t => t.id === 'streamxtv');
  console.log('streamxtv timing:', JSON.stringify(sx));
}
