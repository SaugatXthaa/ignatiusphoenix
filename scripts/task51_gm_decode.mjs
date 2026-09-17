// Task 51: manually run the greenmotors decode chain on a live token
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { gotScraping } = await import('got-scraping');
import fs from 'fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const ORIGIN = 'https://new5.hdhub4u.cl';

function rot13(s) {
  return String(s).replace(/[a-zA-Z]/g, c => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}
function b64decode(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('binary');
}

const post = `${ORIGIN}/spider-man-into-the-spider-verse-2018-bluray-hindi-english/`;
const postRes = await gotScraping(post, { headers: { 'User-Agent': UA }, timeout: { request: 15000 }, throwHttpErrors: false });
const gmHref = [...new Set([...postRes.body.matchAll(/href="(https:\/\/greenmotors\.[a-z]+\/\?id=[^"]+)"/g)].map(m => m[1]))][0];
console.log('GM:', gmHref.slice(0, 90));

const res = await gotScraping(gmHref, {
  headers: { 'User-Agent': UA, Referer: ORIGIN + '/' },
  timeout: { request: 15000 }, throwHttpErrors: false, followRedirect: true,
});
const html = res.body || '';
fs.writeFileSync('/tmp/gm2.html', html);
console.log('GM page status', res.statusCode, 'len', html.length);

const tokenMatch = html.match(/s\(\s*['"]o['"]\s*,\s*['"]([A-Za-z0-9+/=]+)['"]/);
const token = tokenMatch[1];
console.log('\nSTEP 1 atob(token) →', b64decode(token).slice(0, 80));
let s = b64decode(token);
console.log('\nSTEP 2 atob(again) →', (() => { try { return b64decode(s).slice(0, 80); } catch (e) { return 'THROW: ' + e.message; } })());
s = b64decode(s);
console.log('\nSTEP 3 rot13 →', rot13(s).slice(0, 80));
s = rot13(s);
console.log('\nSTEP 4 atob →', (() => { try { return b64decode(s).slice(0, 120); } catch (e) { return 'THROW: ' + e.message; } })());
s = b64decode(s);
try {
  const json = JSON.parse(s);
  console.log('\nSTEP 5 JSON →', JSON.stringify(json).slice(0, 200));
  if (json.o) console.log('\nFINAL atob(json.o) →', b64decode(json.o));
} catch (e) {
  console.log('\nSTEP 5 JSON.parse THROW:', e.message, '| raw:', s.slice(0, 150));
}
