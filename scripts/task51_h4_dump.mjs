// Task 51: dump the hdhub4u search page structure to see post link format
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { gotScraping } = await import('got-scraping');
import fs from 'fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const ORIGIN = 'https://new5.hdhub4u.cl';

const res = await gotScraping(`${ORIGIN}/?s=spider-man+into+the+spider-verse`, {
  headers: { 'User-Agent': UA }, timeout: { request: 20000 }, throwHttpErrors: false, followRedirect: true,
});
const html = res.body || '';
fs.writeFileSync('/tmp/h4_search.html', html);
console.log('status', res.statusCode, 'len', html.length, 'finalUrl', res.url);

// All hrefs
const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
const uniq = [...new Set(hrefs)];
console.log('total unique hrefs:', uniq.length);
const slugs = uniq.filter(h => /spider/i.test(h));
console.log('spider hrefs:', slugs.slice(0, 10));
// Look at article structure
const articles = html.match(/<article[\s\S]{0,300}/gi) || [];
console.log('articles:', articles.length);
if (articles[0]) console.log(articles[0].replace(/\s+/g, ' ').slice(0, 280));
