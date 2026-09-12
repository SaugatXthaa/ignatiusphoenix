// CinePro full API test: token → movies + tv → source m3u8 playability
const BASE = 'https://api.anicine-embed.workers.dev';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const tok = await (await fetch(`${BASE}/v1/token`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) })).json();
console.log('token:', JSON.stringify(tok).slice(0, 80));
const auth = { 'User-Agent': UA, Authorization: `Bearer ${tok.token}` };

for (const [tag, apiPath] of [['MOVIE', '/v1/movies/299534'], ['TV', '/v1/tv/1396/seasons/1/episodes/1']]) {
  try {
    const r = await fetch(`${BASE}${apiPath}`, { headers: auth, signal: AbortSignal.timeout(15000) });
    const d = await r.json();
    const sources = d?.sources || [];
    console.log(`\n===== ${tag}: ${r.status}, ${sources.length} source(s) =====`);
    for (const [i, s] of sources.slice(0, 4).entries()) {
      console.log(`  [${i}] quality=${s.quality || '?'} lang=${s.language || '?'} label=${s.label || s.server || '?'}`);
      const url = String(s.url || '');
      console.log(`      url: ${url.slice(0, 130)}`);
      // decode data param if it's their proxy
      const m = url.match(/[?&]data=([^&]+)/);
      if (m) {
        try {
          const blob = JSON.parse(decodeURIComponent(m[1]));
          console.log(`      data.url: ${String(blob.url).slice(0, 110)}`);
          console.log(`      data.headers: ${JSON.stringify(blob.headers || {}).slice(0, 140)}`);
          // fetch the real upstream m3u8
          const r2 = await fetch(blob.url, { headers: { 'User-Agent': (blob.headers?.['User-Agent'] || UA), ...(blob.headers?.Referer ? { Referer: blob.headers.Referer } : {}) }, redirect: 'follow', signal: AbortSignal.timeout(12000) });
          const t2 = await r2.text();
          const abs = /^https?:\/\//m.test(t2);
          const rel = /^\s*[^\s#].*\.m3u8|^\s*\/[^\s#]/m.test(t2);
          console.log(`      upstream: ${r2.status} ct=${r2.headers.get('content-type')} EXTM3U=${t2.includes('#EXTM3U')} lines=${t2.split('\n').length} absURLs=${abs} relURLs=${rel}`);
          console.log(`      sample: ${t2.split('\n').filter(l => l && !l.startsWith('#'))[0]?.slice(0, 110)}`);
        } catch (e) { console.log('      decode FAIL:', e.message?.slice(0, 60)); }
      } else {
        // direct source URL — probe it
        try {
          const r2 = await fetch(url, { headers: { 'User-Agent': UA, Referer: `${BASE}/` }, redirect: 'follow', signal: AbortSignal.timeout(12000) });
          const t2 = await r2.text();
          console.log(`      direct probe: ${r2.status} ct=${r2.headers.get('content-type')} EXTM3U=${t2.includes('#EXTM3U')} head=${t2.slice(0, 60).replace(/\s+/g, ' ')}`);
        } catch (e) { console.log('      direct probe FAIL:', e.message?.slice(0, 60)); }
      }
    }
  } catch (e) { console.log(`${tag} FAIL:`, e.message?.slice(0, 80)); }
}
