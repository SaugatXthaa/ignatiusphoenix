// Task 16 — probe new28.gdtot.dad file pages (MoviesHunt's remaining upstream)
import { gotScraping } from 'got-scraping';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function fetchGS(url, referer) {
  const res = await gotScraping({
    url, headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*', ...(referer ? { Referer: referer } : {}) },
    timeout: { request: 20000 }, retry: { limit: 0 }, throwHttpErrors: false,
  });
  return { status: res.statusCode, headers: res.headers, body: typeof res.body === 'string' ? res.body : (res.body ? res.body.toString() : '') };
}

const probes = [
  'https://new28.gdtot.dad/file/11648485368',
  'https://new28.gdtot.dad/file/6547021505',
  'https://new28.gdtot.dad/file/41203546638',
];

for (const url of probes) {
  console.log('\n===== ' + url);
  try {
    const { status, headers, body } = await fetchGS(url, 'https://abhilinks.site/');
    console.log('status:', status, '| len:', body.length, '| set-cookie:', (headers['set-cookie'] || []).length);
    if (status !== 200 || body.length < 2000) { console.log('BODY HEAD:', body.slice(0, 400).replace(/\s+/g, ' ')); continue; }
    // interesting links / forms / JS
    const hrefs = [...new Set([...body.matchAll(/(?:href|action)="([^"]+)"/g)].map(m => m[1]))];
    console.log('HREFS/ACTIONS:');
    hrefs.filter(h => !/\.(css|png|ico|js)(\?|$)/.test(h)).slice(0, 20).forEach(h => console.log('  ', h.slice(0, 130)));
    for (const kw of ['drive.google', 'googleusercontent', 'indexserver', 'dl.php', 'token', 'crypt', 'gdrive', 'download', 'formdata', 'ajax', 'fetch(']) {
      const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const n = (body.match(re) || []).length;
      if (n) {
        const i = body.search(re);
        console.log(`KW ${kw}: ${n}x | ctx: ${body.slice(Math.max(0, i - 100), i + 180).replace(/\s+/g, ' ')}`);
      }
    }
    const scripts = [...body.matchAll(/<script[^>]*>([\s\S]{80,}?)<\/script>/g)].map(m => m[1]);
    scripts.slice(0, 4).forEach((s, i) => { console.log(`--- script #${i} (${s.length}): ${s.slice(0, 350).replace(/\s+/g, ' ')}`); });
  } catch (e) { console.log('ERR:', e.message); }
}
