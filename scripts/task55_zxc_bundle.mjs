// zxcstream: dump player page + referenced chunks, find current token API
const BASE = 'https://player.zxcstream.xyz';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
import fs from 'fs';

const page = await (await fetch(`${BASE}/embed/movie/265712`, { headers: { 'User-Agent': UA } })).text();
fs.writeFileSync('/tmp/zxc_page.html', page);
// collect script srcs
const srcs = [...page.matchAll(/src="([^"]+\.js[^"]*)"/g)].map(m => m[1]);
console.log('scripts:', srcs);

const chunks = [];
for (const s of srcs) {
  const url = s.startsWith('http') ? s : `${BASE}${s.startsWith('/') ? '' : '/'}${s}`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    const body = await r.text();
    chunks.push({ url, body });
    console.log('fetched', url.slice(0, 90), r.status, body.length);
  } catch (e) { console.log('fail', url.slice(0, 60), e.message); }
}
// search chunks for backend/token/stream endpoints
for (const c of chunks) {
  const hits = c.body.match(/["'`][^"'`]*(?:backend|\/api\/|token|stream|m3u8|embed)[^"'`]*["'`]/gi) || [];
  const interesting = hits.filter(h => /backend|api|token|m3u8/i.test(h)).slice(0, 30);
  if (interesting.length) {
    console.log('\n== chunk', c.url.slice(-40), '==');
    console.log([...new Set(interesting)].join('\n'));
  }
}
fs.writeFileSync('/tmp/zxc_chunks.json', JSON.stringify(chunks));
