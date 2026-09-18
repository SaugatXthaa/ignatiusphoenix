// Inspect the real 4khdhub.one post for Doraemon — what blocks does the site offer?
import { gotScraping } from 'got-scraping';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const slug = process.argv[2] || 'stand-by-me-doraemon-movie-1433';

const r = await gotScraping.get(`https://4khdhub.one/${slug}/`, {
  headers: { 'User-Agent': UA, 'Accept': 'text/html' },
  timeout: { request: 20000 }, throwHttpErrors: false, http2: false,
});
console.log('post:', r.statusCode, 'len', r.body.length);
const body = r.body;

// blocks: find quality headings and file links — mirror the scraper's block detection
const blocks = [...body.matchAll(/(2160p|1080p|720p|480p)[^<]{0,40}/gi)].map(m => m[1]);
console.log('quality mentions:', blocks.join(', '));

// file blocks (the scraper's pattern — look for download links)
const links = [...body.matchAll(/href="(https:\/\/hubcloud\.[a-z]+\/drive\/[^"]+|https:\/\/hubdrive[^"]+|https:\/\/gdflix[^"]+|https:\/\/gdflix[^"]*)"/g)].map(m => m[1]);
console.log('drive links:', links.length);
for (const l of links.slice(0, 12)) console.log('  ', l.slice(0, 90));

// Try the search-api to see the official quality field
const api = await gotScraping.get(`https://4khdhub.one/?s=${encodeURIComponent('stand by me doraemon')}`, {
  headers: { 'User-Agent': UA }, timeout: { request: 20000 }, throwHttpErrors: false, http2: false,
}).catch(e => ({ statusCode: 0, body: String(e) }));
console.log('\nsearch page:', api.statusCode);

// The search-api.php JSON (used by scraper)
const api2 = await gotScraping.get(`https://4khdhub.one/search-api.php?s=stand+by+me+doraemon`, {
  headers: { 'User-Agent': UA, 'Accept': 'application/json' }, timeout: { request: 20000 }, throwHttpErrors: false, http2: false,
}).catch(e => ({ statusCode: 0, body: String(e) }));
console.log('search-api:', api2.statusCode, String(api2.body).slice(0, 400));
try {
  const j = JSON.parse(api2.body);
  const arr = Array.isArray(j) ? j : j.results || [];
  for (const it of arr.slice(0, 3)) console.log('  api item:', JSON.stringify(it).slice(0, 240));
} catch { }
