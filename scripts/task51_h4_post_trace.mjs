// Task 51: trace post page → greenmotors decode for hdhub4u
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { gotScraping } = await import('got-scraping');
import fs from 'fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const ORIGIN = 'https://new5.hdhub4u.cl';

async function fetchText(url, referer, timeout = 15000) {
  const res = await gotScraping(url, {
    headers: { 'User-Agent': UA, Referer: referer || ORIGIN + '/' },
    timeout: { request: timeout }, throwHttpErrors: false, followRedirect: true,
  });
  console.log(`  fetch ${url.slice(0, 90)} → ${res.statusCode} (${(res.body || '').length}B) final=${res.url?.slice(0, 90)}`);
  if (res.statusCode >= 400) return null;
  return res.body || '';
}

const post = process.argv[2] || `${ORIGIN}/spider-man-into-the-spider-verse-2018-bluray-hindi-english/`;
const html = await fetchText(post);
if (!html) { console.log('POST FETCH FAILED'); process.exit(1); }
fs.writeFileSync('/tmp/h4_post.html', html);

const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1];
console.log('H1:', h1?.replace(/<[^>]+>/g, '').trim().slice(0, 120));

const hrefs = [...new Set([...html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map(m => m[1]))];
const gm = hrefs.filter(h => /greenmotors\.[a-z]+\/\?id=/i.test(h));
const other = hrefs.filter(h => /hubcloud|hubcdn|gdflix|hdstream|hblinks|pixeldrain|drive\.google/i.test(h));
console.log('greenmotors links:', gm.length);
gm.slice(0, 3).forEach(h => console.log('  GM:', h.slice(0, 110)));
console.log('other file links:', other.length);
other.slice(0, 5).forEach(h => console.log('  ??', h.slice(0, 110)));

if (gm.length) {
  console.log('\n--- decode first greenmotors link ---');
  const gmHtml = await fetchText(gm[0], ORIGIN + '/');
  if (gmHtml) {
    fs.writeFileSync('/tmp/gm.html', gmHtml);
    const tokenMatch = gmHtml.match(/s\(\s*['"]o['"]\s*,\s*['"]([A-Za-z0-9+/=]+)['"]/);
    console.log('token s(o,..):', tokenMatch ? 'MATCH len=' + tokenMatch[1].length : 'NO MATCH');
    if (!tokenMatch) {
      const inlineScripts = gmHtml.match(/<script[^>]*>[\s\S]*?<\/script>/gi) || [];
      console.log('inline scripts:', inlineScripts.length);
      // print scripts containing 's(' or token-ish content
      for (const s of inlineScripts) {
        const body = s.replace(/<\/?script[^>]*>/g, '');
        if (/function s\(|s\(\s*['"]o['"]|atob|eval/.test(body)) {
          console.log('--- candidate script (first 900 chars) ---');
          console.log(body.replace(/\s+/g, ' ').slice(0, 900));
          break;
        }
      }
    }
  }
}
