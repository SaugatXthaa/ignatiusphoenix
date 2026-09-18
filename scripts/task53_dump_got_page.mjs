#!/usr/bin/env node
// Dump 4khdhub.one GoT page structure around season/episode markup
const got = (await import('got-scraping')).gotScraping;
const r = await got('https://4khdhub.one/game-of-thrones-series-487/', { responseType: 'text', timeout: { request: 30000 } });
const html = r.body;
console.log('page length', html.length);
const fs = await import('fs');
fs.writeFileSync('/tmp/got_4khdhub.html', html);
// structural census
for (const sel of ['season-content', 'episode-download-item', 'episode-number', 'episode-file-title', 'download-item', 'badge-psa', 'file-item', 'content-file', 'episode-item']) {
  const n = (html.match(new RegExp(sel, 'g')) || []).length;
  console.log(sel.padEnd(24), n);
}
// find how episodes appear
const m = html.match(/.{200}S01E01.{300}/s) || html.match(/.{200}S1E1.{300}/s) || html.match(/.{200}Episode\s*1.{300}/is);
console.log('\nS01E01 context:\n', m ? m[0].replace(/\s+/g, ' ').slice(0, 450) : 'NO S01E01 marker in html');
