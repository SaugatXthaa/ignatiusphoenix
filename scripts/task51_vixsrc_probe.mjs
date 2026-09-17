// Task 51: vixsrc.to page probe — find the player data / token flow
const { gotScraping } = await import('got-scraping');
import fs from 'fs';

const res = await gotScraping('https://vixsrc.to/movie/324857', {
  timeout: { request: 20000 }, throwHttpErrors: false, followRedirect: true,
  headers: { 'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8' },
});
console.log('status', res.statusCode, 'len', (res.body || '').length);
fs.writeFileSync('/tmp/vixsrc2.html', res.body || '');
const html = res.body || '';
if (res.statusCode === 200) {
  const m = html.match(/window\.appProps\s*=\s*([\s\S]{0,900})/);
  console.log('appProps:', m ? m[1].slice(0, 700) : 'NOT FOUND');
  console.log('---');
  const api = [...new Set([...html.matchAll(/["'](\/api\/[^"']+|https:\/\/[^"']*vixsrc[^"']*)["']/g)].map(m => m[1]))];
  console.log('api-ish urls:', api.slice(0, 10));
}
