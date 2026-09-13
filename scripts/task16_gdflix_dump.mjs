// Task 16 — dump new3.gdflix.io file page structure
import { gotScraping } from 'got-scraping';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const url = process.argv[2] || 'https://new3.gdflix.io/file/N0ok72OpkmAOoKn';

const res = await gotScraping({
  url, headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*' },
  timeout: { request: 15000 }, retry: { limit: 0 }, throwHttpErrors: false,
});
const body = typeof res.body === 'string' ? res.body : (res.body ? res.body.toString() : '');
console.log('status:', res.statusCode, '| len:', body.length);

const hrefs = [...new Set([...body.matchAll(/(?:href|action|src)="([^"]{10,})"/g)].map(m => m[1]))];
console.log('\n=== HREFS/ACTIONS/SRC (' + hrefs.length + ') ===');
hrefs.filter(h => !/\.(css|js|png|jpg|svg|ico|woff)/.test(h)).slice(0, 40).forEach(h => console.log(' ', h.slice(0, 130)));

console.log('\n=== KEYWORDS ===');
for (const kw of ['indexserver', 'drive.google', 'googleusercontent', 'pixeldrain', 'workers.dev', 'r2.dev', 'cloudflarestorage', 'direct', 'download', 'token', 'atob', 'ajax', 'XMLHttpRequest', 'fetch(']) {
  const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  const n = (body.match(re) || []).length;
  if (n) {
    const i = body.search(re);
    console.log(`${kw}: ${n}x | ctx: ${body.slice(Math.max(0, i - 100), i + 200).replace(/\s+/g, ' ').slice(0, 280)}`);
  }
}

const scripts = [...body.matchAll(/<script[^>]*>([\s\S]{300,}?)<\/script>/g)].map(m => m[1]);
console.log('\n=== SCRIPTS (' + scripts.length + ') ===');
scripts.slice(0, 5).forEach((s, i) => { console.log(`--- #${i} (${s.length}) ---\n${s.slice(0, 800).replace(/\s+/g, ' ')}\n`); });
