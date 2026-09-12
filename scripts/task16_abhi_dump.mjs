// Task 16 — dump abhilinks archive page structure to find new link format
import { createRequire } from 'module';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const url = process.argv[2] || 'https://abhilinks.site/archives/1040';

let gs = null;
try { const mod = await import('got-scraping'); gs = mod.gotScraping || mod.default || mod.got; } catch {}
const res = await gs({ url, headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Referer': 'https://movieshunt.casa/' }, timeout: { request: 15000 }, retry: { limit: 0 } });
const html = typeof res.body === 'string' ? res.body : res.body.toString();
console.log('status:', res.statusCode, '| length:', html.length);

// All hrefs
const hrefs = [...new Set([...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]))];
console.log('\n=== ALL UNIQUE HREFS (' + hrefs.length + ') ===');
for (const h of hrefs) console.log(' ', h.slice(0, 140));

// Interesting keyword contexts
console.log('\n=== KEYWORD SCAN ===');
for (const kw of ['hubcloud', 'gdflix', 'gamerxyt', 'driveleech', 'drivetam', 'gdrive', 'googleusercontent', 'pixeldrain', 'archives', 'button', 'onclick', 'atob', 'b64', 'base64', 'token', 'data-url', 'data-href', 'data-link', 'encrypt', 'redirect', 'dl.php', 'indexserver']) {
  const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  const count = (html.match(re) || []).length;
  if (count) {
    const first = html.search(re);
    console.log(`${kw}: ${count}x  ctx: ${html.slice(Math.max(0, first - 80), first + 160).replace(/\s+/g, ' ')}`);
  }
}

// Script blocks (look for link-generation JS)
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]{100,}?)<\/script>/g)].map(m => m[1]);
console.log('\n=== SCRIPT BLOCKS: ' + scripts.length + ' ===');
scripts.slice(0, 6).forEach((s, i) => {
  console.log(`--- script #${i} (${s.length} chars) first 500: ---`);
  console.log(s.slice(0, 500).replace(/\s+/g, ' '));
});

// Any JS vars that look like encoded payloads
const encVars = [...html.matchAll(/(?:const|var|let)\s+(\w+)\s*=\s*["']([A-Za-z0-9+/=]{40,})["']/g)].map(m => m[1] + ' = ' + m[2].slice(0, 60) + '...');
console.log('\n=== BASE64-LIKE VARS ===');
encVars.forEach(v => console.log(' ', v));
