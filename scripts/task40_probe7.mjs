// Task 40b — fresh-token referer check for vimeos.net (Omen) + salsa436jam (Vyse)
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { getStreams } = require_('../src/nuvio/cineby.cjs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const VK = { 'User-Agent': UA, 'Origin': 'https://www.vidking.net', 'Referer': 'https://www.vidking.net/' };

async function probe(label, url, headers) {
  try {
    const r = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(12000), redirect: 'follow' });
    const t = r.headers.get('content-type') || '';
    let head = '';
    if (t.includes('mpegurl') || t.includes('text')) {
      const txt = await r.text();
      head = txt.slice(0, 40).replace(/\n/g, '|');
    }
    console.log(`[${label}] HTTP ${r.status} ct=${t.slice(0, 36)} head="${head}"`);
  } catch (e) {
    console.log(`[${label}] ERR ${e.message?.slice(0, 60)}`);
  }
}

const streams = await getStreams(27205, 'movie', null, null, { title: 'Inception', year: '2010', imdbId: 'tt1375666' });
for (const s of streams) {
  const host = new URL(s.url).hostname;
  if (host.includes('vimeos') || host.includes('salsa')) {
    console.log(`\n== ${s.title} (${host}) ==`);
    await probe('  +vk-referer', s.url, VK);
    await probe('  no-referer ', s.url, { 'User-Agent': UA });
  }
}
console.log('DONE');
