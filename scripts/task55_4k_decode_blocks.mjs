// Decode every greenmotors link on the Doraemon 4khdhub post — which hosts do the 4K blocks land on?
import { gotScraping } from 'got-scraping';
import * as cheerio from 'cheerio';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const slug = process.argv[2] || 'stand-by-me-doraemon-movie-1433';

function rot13(s) {
  return String(s).replace(/[a-zA-Z]/g, c => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}
function b64decode(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('binary');
}
async function resolveGm(href) {
  const r = await gotScraping.get(href, {
    headers: { 'User-Agent': UA, Referer: 'https://4khdhub.one/' },
    timeout: { request: 15000 }, throwHttpErrors: false, http2: false,
  });
  const html = r.body || '';
  const m = /s\(\s*['"]o['"]\s*,\s*['"]([A-Za-z0-9+/=]+)['"]/.exec(html);
  if (!m) return { err: 'no token, status ' + r.statusCode };
  let s = b64decode(m[1]); s = b64decode(s); s = rot13(s); s = b64decode(s);
  try {
    const json = JSON.parse(s);
    return { real: json.o ? Buffer.from(json.o, 'base64').toString('binary') : null, landing: json.l };
  } catch (e) { return { err: 'decode ' + e.message }; }
}

const r = await gotScraping.get(`https://4khdhub.one/${slug}/`, {
  headers: { 'User-Agent': UA }, timeout: { request: 20000 }, throwHttpErrors: false, http2: false,
});
const $ = cheerio.load(r.body);
$('div[id^="content-file"]').each(async (_i, el) => {
  const $el = $(el);
  const title = ($el.find('.file-title').first().text() || '').trim();
  const links = [];
  $el.find('a[href]').each((_j, a) => {
    const href = ($(a).attr('href') || '');
    const text = ($(a).text() || '').trim();
    if (/greenmotors/.test(href)) links.push({ href, text });
  });
  if (title) {
    console.log(`\nBLOCK: ${title}`);
    for (const l of links) {
      const res = await resolveGm(l.href).catch(e => ({ err: e.message }));
      console.log(`  [${l.text.slice(0, 30)}] → ${res.real ? res.real.slice(0, 80) : 'FAIL ' + (res.err || '?')}`);
    }
  }
});
