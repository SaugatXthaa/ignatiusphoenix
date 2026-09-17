// Task 51: decode ALL greenmotors tokens on the post page
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { gotScraping } = await import('got-scraping');

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
function decodeToken(token) {
  try {
    let s = b64decode(token);
    s = b64decode(s);
    s = rot13(s);
    s = b64decode(s);
    const json = JSON.parse(s);
    return json.o ? b64decode(json.o) : JSON.stringify(json);
  } catch (e) { return 'DECODE-FAIL: ' + e.message; }
}

const post = `${ORIGIN}/spider-man-into-the-spider-verse-2018-bluray-hindi-english/`;
const postRes = await gotScraping(post, { headers: { 'User-Agent': UA }, timeout: { request: 15000 }, throwHttpErrors: false });
const html = postRes.body;

// grab each greenmotors href with its nearby label heading (walk linearly like the module)
const gmHrefs = [...html.matchAll(/href="(https:\/\/greenmotors\.[a-z]+\/\?id=[^"]+)"/g)].map(m => m[1]);
console.log('total GM links:', gmHrefs.length);

for (let i = 0; i < gmHrefs.length; i++) {
  const href = gmHrefs[i];
  if (i > 0 && href === gmHrefs[i - 1]) { console.log(`[${i}] (dupe) skip`); continue; }
  const res = await gotScraping(href, {
    headers: { 'User-Agent': UA, Referer: ORIGIN + '/' },
    timeout: { request: 15000 }, throwHttpErrors: false, followRedirect: true,
  });
  const tm = (res.body || '').match(/s\(\s*['"]o['"]\s*,\s*['"]([A-Za-z0-9+/=]+)['"]/);
  const final = tm ? decodeToken(tm[1]) : 'NO TOKEN';
  console.log(`[${i}] ${href.slice(0, 75)}...\n     → ${String(final).slice(0, 130)}`);
}
