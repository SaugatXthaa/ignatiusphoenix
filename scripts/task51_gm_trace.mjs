// Task 51: step-by-step diag of hdhub4u funnel — post page → links → greenmotors decode
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { gotScraping } = await import('got-scraping');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const ORIGIN = 'https://hdhub4u.green'; // will confirm from module constants below
import fs from 'fs';
const src = fs.readFileSync(new URL('../src/nuvio/hdhub4u_v2.cjs', import.meta.url), 'utf8');
const originMatch = src.match(/const ORIGIN\s*=\s*['"]([^'"]+)['"]/);
const origin = originMatch ? originMatch[1] : 'https://hdhub4u.green';
console.log('module ORIGIN =', origin);

async function fetchText(url, referer, timeout = 15000) {
  const res = await gotScraping(url, {
    headers: { 'User-Agent': UA, Referer: referer || origin + '/' },
    timeout: { request: timeout }, throwHttpErrors: false, followRedirect: true,
  });
  console.log(`  fetch ${url.slice(0, 90)} → ${res.statusCode} (${(res.body || '').length}B)`);
  if (res.statusCode >= 400) return null;
  return res.body || '';
}

// 1. search
const searchHtml = await fetchText(`${origin}/?s=spider-man+into+the+spider-verse`);
if (!searchHtml) { console.log('SEARCH FAILED'); process.exit(1); }
// reuse the module's link patterns? simpler: find post links
const postRe = /href="((?:https?:\/\/[^"]*)?\/[a-z0-9-]*spider-man-into-the-spider-verse[a-z0-9-]*\/?)"/gi;
const posts = new Set();
for (const m of searchHtml.matchAll(postRe)) {
  let u = m[1];
  if (u.startsWith('/')) u = origin + u;
  posts.add(u);
}
console.log('posts found:', [...posts].slice(0, 5));

// 2. first post → links
const post = [...posts][0];
const postHtml = await fetchText(post, origin + '/');
// find ALL hrefs on the post page and classify
const allHrefs = [...postHtml.matchAll(/href="(https?:\/\/[^"]+)"/g)].map(m => m[1]);
const interesting = allHrefs.filter(h => /greenmotors|hubcloud|hubcdn|gdflix|hdstream|hblinks|drive\b/i.test(h));
console.log('\nInteresting hrefs on post:');
for (const h of [...new Set(interesting)].slice(0, 10)) console.log('  ', h.slice(0, 110));

// 3. take the first greenmotors link and decode manually
const gm = interesting.find(h => /greenmotors\.[a-z]+\/\?id=/i.test(h));
if (!gm) { console.log('\nNO greenmotors link on post — funnel changed?'); process.exit(0); }
console.log('\nDecoding greenmotors:', gm.slice(0, 100));
const gmHtml = await fetchText(gm, origin + '/');
if (gmHtml) {
  fs.writeFileSync('/tmp/gm_page.html', gmHtml);
  const tokenMatch = gmHtml.match(/s\(\s*['"]o['"]\s*,\s*['"]([A-Za-z0-9+/=]+)['"]/);
  console.log('token s(o,..) match:', tokenMatch ? 'YES' : 'NO');
  if (!tokenMatch) {
    // dump script snippets to see the new obfuscation
    const scripts = gmHtml.match(/<script[^>]*>[\s\S]{0,400}?/gi) || [];
    console.log('--- first script snippets ---');
    for (const s of scripts.slice(0, 6)) console.log(s.replace(/\s+/g, ' ').slice(0, 220));
    const sCall = gmHtml.match(/s\([^)]{0,80}\)/g);
    console.log('s(...) calls:', (sCall || []).slice(0, 5));
    const atobCalls = gmHtml.match(/atob\([^)]*\)/g);
    console.log('atob calls:', (atobCalls || []).slice(0, 5));
  }
}
