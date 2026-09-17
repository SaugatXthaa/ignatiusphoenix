// Task 51: probe 4khdhub.one search + match scoring locally
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { gotScraping } = await import('got-scraping');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const q = process.argv[2] || 'Spider-Man: Into the Spider-Verse';
const res = await gotScraping(`https://4khdhub.one/?s=${encodeURIComponent(q)}`, {
  headers: { 'User-Agent': UA }, timeout: { request: 20000 }, throwHttpErrors: false, followRedirect: true,
});
const html = res.body || '';
console.log('status', res.statusCode, 'len', html.length, 'final', res.url);

// 4khdhub_one.cjs result-card shape: find article nodes with links
const items = [...html.matchAll(/<article[\s\S]*?<\/article>/gi)].map(m => m[0]);
console.log('articles:', items.length);
for (const it of items.slice(0, 6)) {
  const href = (it.match(/href="(https:\/\/4khdhub\.one\/[a-z0-9-]+\/?)"/i) || [])[1];
  const title = (it.match(/<h\d[^>]*>([\s\S]*?)<\/h\d>/i) || [])[1];
  console.log(' -', (title || '').replace(/<[^>]+>/g, '').trim().slice(0, 90), '=>', href?.slice(0, 90));
}
if (items.length === 0) {
  // dump other listing structure
  const hrefs = [...new Set([...html.matchAll(/href="(https:\/\/4khdhub\.one\/[a-z0-9-]+\/)"/g)].map(m => m[1]))];
  console.log('post-ish hrefs:', hrefs.slice(0, 8));
}
