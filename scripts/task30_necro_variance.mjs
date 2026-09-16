// Task 30 — variance + playback depth test: 3 rounds movie+tv, then variant/segment fetch
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const H = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' };

async function j(url) {
  const res = await fetch(url, { headers: { ...H, accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  return res.ok ? res.json() : null;
}
async function decryptStreamUrls(payload) {
  const enc = Buffer.from(payload.data.stream_urls, 'base64');
  const wasmBytes = Buffer.from(await (await fetch(payload.vs.wasm_url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) })).arrayBuffer());
  const inst = await WebAssembly.instantiate(await WebAssembly.compile(wasmBytes), {});
  const ex = inst.exports;
  const ptr = ex.alloc(enc.length);
  new Uint8Array(ex.memory.buffer, ptr, enc.length).set(enc);
  const outLen = ex.decrypt(ptr, enc.length);
  return new TextDecoder().decode(new Uint8Array(ex.memory.buffer, ptr + 12, outLen)).split('\n').filter(Boolean);
}
async function tokenFor(origin) {
  const r = await fetch(origin + '/generate.php', { headers: { ...H, Referer: 'https://cloudorchestranova.com/' }, signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!r || !r.ok) return '';
  const t = await r.text();
  try { const p = JSON.parse(t); return p.token || p.data || ''; } catch { return t.trim(); }
}

(async () => {
  for (let round = 1; round <= 3; round++) {
    for (const [label, q] of [['movie', 'type=movie&tmdb=299534'], ['tv', 'type=tv&tmdb=1429&season=1&episode=1']]) {
      const data = await j(`https://data.vidsrcme.ru/api.php?${q}&stream_urls`);
      if (!data?.data?.stream_urls) { console.log(`R${round} ${label}: api fail`); continue; }
      const urls = typeof data.data.stream_urls === 'string' ? await decryptStreamUrls(data) : data.data.stream_urls;
      if (!urls.length) { console.log(`R${round} ${label}: 0 urls`); continue; }
      const u = urls[0];
      const origin = new URL(u).origin;
      const tok = await tokenFor(origin);
      const sep = u.includes('?') ? '&' : '?';
      const r = await fetch(u + sep + 'token=' + encodeURIComponent(tok), { headers: H, redirect: 'manual', signal: AbortSignal.timeout(15000) }).catch(e => ({ status: 'THREW' }));
      const body = r.status === 200 ? (await r.text()).slice(0, 80) : '';
      console.log(`R${round} ${label}: host=${origin.replace('https://', '').slice(0, 28)} token=${tok ? 'yes' : 'NO'} -> ${r.status} ${body.startsWith('#EXTM3U') ? 'M3U8-OK' : String(body).slice(0, 40)}`);
      if (round === 1 && label === 'movie' && body.startsWith('#EXTM3U')) {
        // depth test: master already fetched; refetch full, take best variant, fetch it, then one segment
        const full = await (await fetch(u + sep + 'token=' + encodeURIComponent(tok), { headers: H, signal: AbortSignal.timeout(15000) })).text();
        const variants = [...full.matchAll(/#EXT-X-STREAM-INF:.*?\n([^#\n]+)/g)].map(m => m[1].trim());
        console.log('   variants:', variants.length);
        if (variants.length) {
          const vUrl = new URL(variants[variants.length - 1], u + sep + 'token=' + encodeURIComponent(tok)).href;
          const vr = await fetch(vUrl, { headers: H, signal: AbortSignal.timeout(15000) });
          const vb = await vr.text();
          console.log('   variant ->', vr.status, vb.startsWith('#EXTM3U') ? 'MEDIA-M3U8-OK' : vb.slice(0, 40));
          const seg = [...vb.matchAll(/([^#\n]+\.ts|[^#\n]+\.mp4)/g)].map(m => m[1].trim())[0];
          if (seg) {
            const sUrl = new URL(seg, vUrl).href;
            const sr = await fetch(sUrl, { headers: { ...H, Range: 'bytes=0-2047' }, signal: AbortSignal.timeout(15000) });
            const sb = Buffer.from(await sr.arrayBuffer());
            console.log('   segment ->', sr.status, 'ct=', sr.headers.get('content-type'), 'first4=', sb.slice(0, 4).toString('hex'));
          }
        }
      }
    }
    if (round < 3) await new Promise(r => setTimeout(r, 3000));
  }
})();
