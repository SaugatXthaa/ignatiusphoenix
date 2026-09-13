// Task 21: dump what got-scraping actually receives from allwish search + check AniChan addon-path gate
const { gotScraping } = await import('got-scraping');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const res = await gotScraping.get('https://all-wish.me/filter?keyword=frieren', {
  headers: { 'User-Agent': UA, Referer: 'https://all-wish.me/', Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
  timeout: { request: 15000 }, throwHttpErrors: false, followRedirect: true,
});
console.log('HTTP', res.statusCode, 'url:', res.url, 'len:', String(res.body).length);
const body = String(res.body);
// find any watch references
const watchRefs = body.match(/watch/gi)?.length || 0;
console.log('occurrences of "watch":', watchRefs);
// hrefs of any kind
const hrefs = [...body.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
const uniq = [...new Set(hrefs)];
console.log('total hrefs:', hrefs.length, 'unique:', uniq.length);
console.log('first 15 hrefs:', uniq.slice(0, 15));
// item card structure — dump first card raw
const idx = body.indexOf('class="item"');
if (idx >= 0) console.log('--- first .item card raw (700 chars) ---\n' + body.slice(idx - 50, idx + 700));
else console.log('NO .item cards found');
// check data-url / onclick patterns
const dataUrl = [...body.matchAll(/data-(?:url|href|target)="([^"]+)"/g)].map(m => m[1]).slice(0, 5);
console.log('data-url/href attrs:', dataUrl);
const onclick = [...body.matchAll(/onclick="([^"]+)"/g)].map(m => m[1]).slice(0, 5);
console.log('onclick attrs:', onclick);
