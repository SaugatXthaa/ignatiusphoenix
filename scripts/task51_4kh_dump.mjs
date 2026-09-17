// Task 51: dump 4khdhub.one search page link structure + run module search with tracing
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { gotScraping } = await import('got-scraping');
import fs from 'fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const q = process.argv[2] || 'spider man into the spider verse';

const res = await gotScraping(`https://4khdhub.one/?s=${encodeURIComponent(q)}`, {
  headers: { 'User-Agent': UA }, timeout: { request: 20000 }, throwHttpErrors: false, followRedirect: true,
});
const html = res.body || '';
fs.writeFileSync('/tmp/4kh_search.html', html);
console.log('status', res.statusCode, 'len', html.length);

// dump every href with its anchor text
const links = [...html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]{0,120}?)<\/a>/gi)].map(m => ({ href: m[1], text: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }));
const movieLinks = links.filter(l => /-(movie|series)-\d+/.test(l.href));
console.log('post-format links:', movieLinks.length);
for (const l of movieLinks.slice(0, 10)) console.log('  ', l.href.slice(0, 80), '|', l.text.slice(0, 60));
console.log('sample of all links:');
for (const l of links.slice(0, 15)) console.log('  ', l.href.slice(0, 80), '|', l.text.slice(0, 50));
