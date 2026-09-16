// Task 40 — verify referer behavior of the CDN hosts the new provider returns
// (determines /proxy vs direct routing correctness in buildStreamResults)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const VK = { 'User-Agent': UA, 'Origin': 'https://www.vidking.net', 'Referer': 'https://www.vidking.net/' };

async function probe(label, url, headers) {
  try {
    const r = await fetch(url, { method: 'GET', headers: { ...headers, Range: 'bytes=0-127' }, signal: AbortSignal.timeout(12000), redirect: 'follow' });
    const buf = new Uint8Array(await r.arrayBuffer());
    const magic = Array.from(buf.slice(0, 7)).map(b => String.fromCharCode(b)).join('').replace(/[^\x20-\x7e]/g, '.');
    console.log(`[${label}] HTTP ${r.status} ct=${(r.headers.get('content-type') || '').slice(0, 40)} head="${magic}"`);
  } catch (e) {
    console.log(`[${label}] ERR ${e.message?.slice(0, 60)}`);
  }
}

// 1. s8.vimeos.net (Omen) — with and without vidking referer
const vimeos = 'https://s8.vimeos.net/hls2/02/00003/uog0l1cy08dd_,n,h,.urlset/master.m3u8?t=pZs2UKDYjTv-vE07fNOX2Q6O';
await probe('vimeos.net +vk-referer', vimeos, VK);
await probe('vimeos.net no-referer', vimeos, { 'User-Agent': UA });

// 2. salsa436jam (hdmovie/Vyse) — with and without
const salsa = 'https://i-arch-400.salsa436jam.com/stream2/i-arch-400/a9506cf13f0727cc12c37a38acf94aac/MJTMsp1RshGTygnMNRUR2N2';
await probe('salsa436jam +vk-referer', salsa, VK);
await probe('salsa436jam no-referer', salsa, { 'User-Agent': UA });

// 3. lizer123.site (Fade Hindi) — with and without
const lizer = 'https://lizer123.site/getm3u8/VL532K9R';
await probe('lizer123 +vk-referer', lizer, VK);
await probe('lizer123 no-referer', lizer, { 'User-Agent': UA });

// 4. moon.peakstorm.top (Yoru) — with vidking referer (expected 200) and without (expected 403?)
const moon = 'https://moon.peakstorm.top/vd/czN4MEdZVFNJbldWTmlURTVPcmZmZzpRY0Q3OHVOMWl4NlBTVnc4bDFuWEhB/master.m3u8';
await probe('moon.peakstorm +vk-referer', moon, VK);
await probe('moon.peakstorm no-referer', moon, { 'User-Agent': UA });
await probe('moon.peakstorm +cineby.at-referer', moon, { 'User-Agent': UA, Origin: 'https://www.cineby.at', Referer: 'https://www.cineby.at/' });

console.log('DONE');
