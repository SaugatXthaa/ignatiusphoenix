// task12_gamerxyt_repro.cjs — replicate addon's exact gamerxyt fetch + regex
import { gotScraping } from 'got-scraping';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const gamerUrl = 'https://gamerxyt.com/hubcloud.php?host=hubcloud&id=j7l_cvgcthc_cax&token=dzNvbG5CZkJLN0FzV2NBdXRuV0lKQnVBcC8wbHRIUm1RWHl2ekdMUEYrWT0=';

const res = await gotScraping(gamerUrl, {
  headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.5', Referer: 'https://hubcloud.cx/' },
  timeout: { request: 15000 }, throwHttpErrors: false, followRedirect: true, http2: true,
});
const body = typeof res.body === 'string' ? res.body : res.body.toString();
console.log('status:', res.statusCode, 'len:', body.length);

const pixelMatch = body.match(/https:\/\/pixel\.hubcloud\.cx\/\?id=[A-Za-z0-9:_-]+/i);
console.log('pixelMatch:', pixelMatch ? pixelMatch[0].slice(0, 90) + '...' : 'NULL');
const workerMatch = body.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev\/[A-Za-z0-9:_/-]+\/\d+\/[^"'\s<>]+/i);
console.log('workerMatch:', workerMatch ? workerMatch[0].slice(0, 90) : 'NULL');
const pdMatch2 = body.match(/https:\/\/pixeldrain\.[a-z]+\/u\/([A-Za-z0-9]+)/i);
console.log('pixeldrainMatch:', pdMatch2 ? pdMatch2[1] : 'NULL');
const gpdlMatch2 = body.match(/https:\/\/gpdl\.hubcloud\.cx\/\?id=[A-Za-z0-9:]+/i);
console.log('gpdlMatch:', gpdlMatch2 ? gpdlMatch2[0].slice(0, 80) : 'NULL');

// Which pixel URLs exist on the page at all?
const allPixel = [...new Set(body.match(/https:\/\/pixel\.hubcloud\.[a-z]+\/\?id=[^"'\s<>]+/g) || [])];
console.log('\nall pixel URLs on page:', allPixel.length);
allPixel.forEach(p => console.log('  ', p.slice(0, 100) + (p.length > 100 ? '…' : '')));
