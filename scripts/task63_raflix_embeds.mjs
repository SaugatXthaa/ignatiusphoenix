// Probe raflix's raw embed sources + extractor behavior
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
async function probe(url, headers = {}) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 15000);
  try {
    const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': UA, ...headers }, redirect: 'follow' });
    const body = await r.text();
    const ct = r.headers.get('content-type') || '';
    let info = `ct=${ct} len=${body.length}`;
    if (/m3u8/.test(body.slice(0, 2000))) info += ' [M3U8]';
    const m3u8 = body.match(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/);
    if (m3u8) info += ` m3u8=${m3u8[0].slice(0, 100)}`;
    const src = body.match(/(?:file|source|src)\s*[:=]\s*["'](https?:\/\/[^"']+)["']/);
    if (src) info += ` src=${src[1].slice(0, 100)}`;
    return `${r.status} ${info}`;
  } catch (e) { return `ERR ${String(e).slice(0, 80)}`; }
  finally { clearTimeout(t); }
}

console.log('=== raflixx API itself ===');
console.log('api:', await probe('https://raflixx.vercel.app/api/media/sources?type=movie&tmdbId=27205'));

console.log('\n=== the 7 embed sources (Inception) ===');
const urls = [
  'https://play.xpass.top/e/movie/27205?autostart=true',
  'https://moviesapi.to/movie/27205',
  // fetch the full list from the API to see all 8
];
const apiText = await (await fetch('https://raflixx.vercel.app/api/media/sources?type=movie&tmdbId=27205', { headers: { 'User-Agent': UA, Accept: 'application/json' } })).text();
console.log('api body head:', apiText.slice(0, 1200));
let list = [];
try { const d = JSON.parse(apiText); list = (d.sources || []).map(s => ({ label: s.label, url: s.url })); } catch { }
console.log(`\nparsed sources: ${list.length}`);
for (const s of list) {
  console.log(`\n[${s.label}] ${s.url}`);
  console.log('  →', await probe(s.url));
}
