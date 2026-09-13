// audit17_streamxtv.mjs — why do StreamXTV cards 403 while other peakstorm cards play?
const BASE = 'http://127.0.0.1:4598';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const res = await fetch(`${BASE}/stream/movie/tt4154796.json`, { signal: AbortSignal.timeout(90000) });
const { streams = [] } = await res.json();

function labelOf(s) {
  const name = (s.name || '').split('\n').map(t => t.trim()).filter(Boolean);
  const line = name.find(l => /PhoeniX/i.test(l)) || name[0] || '';
  const seg = line.split('·').map(t => t.trim());
  return seg.length >= 3 ? seg[2] : (seg[1] || line || 'unknown');
}

const st = streams.filter(s => /streamxtv/i.test(labelOf(s)) || /StreamXTV/i.test(s.name || ''));
console.log(`StreamXTV cards in merged Endgame: ${st.length}`);
const s0 = st[0];
if (!s0) process.exit(0);
const url = s0.url?.href || s0.url;
console.log('URL head:', url.slice(0, 130));
console.log('behaviorHints:', JSON.stringify(s0.behaviorHints || {}).slice(0, 200));

const variants = [
  ['plain-UA', { 'User-Agent': UA }],
  ['UA+peakstorm-referer', { 'User-Agent': UA, Referer: 'https://moon.peakstorm.top/' }],
  ['UA+streamxtv-referer', { 'User-Agent': UA, Referer: 'https://streamxtv.com/' }],
  ['no-headers', {}],
];
for (const [label, headers] of variants) {
  try {
    const r = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    const body = await r.arrayBuffer();
    const head = Buffer.from(body.slice(0, 120)).toString('utf8', 0, 60).replace(/\s+/g, ' ');
    console.log(`${label}: HTTP ${r.status} ct=${r.headers.get('content-type')} head=${head.slice(0, 50)}`);
  } catch (e) {
    console.log(`${label}: ERR ${String(e?.message || e).slice(0, 60)}`);
  }
}
