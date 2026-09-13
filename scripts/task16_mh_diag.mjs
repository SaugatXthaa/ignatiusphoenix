// Task 16 — MoviesHunt live diagnosis: find where the single download link dies
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const ORIGIN = 'https://movieshunt.casa';

async function fetchText(url, referer, timeout) {
  const headers = { 'User-Agent': UA, 'Accept': 'text/html,application/json,*/*' };
  if (referer) headers['Referer'] = referer;
  let gs = null;
  try { const mod = await import('got-scraping'); gs = mod.gotScraping || mod.default || mod.got; } catch {}
  if (gs) {
    try {
      const res = await gs({ url, headers, timeout: { request: timeout || 10000 }, retry: { limit: 0 } });
      console.log(`    [fetchText got] ${res.statusCode} ${url.slice(0, 90)} (len=${String(res.body).length})`);
      if (res.statusCode >= 200 && res.statusCode < 400) return typeof res.body === 'string' ? res.body : res.body.toString();
    } catch (e) { console.log(`    [fetchText got ERR] ${e.message} ${url.slice(0, 90)}`); }
  }
  const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(timeout || 10000) });
  console.log(`    [fetchText plain] ${res.status} ${url.slice(0, 90)}`);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
}

async function headOk(url) {
  let gs = null;
  try { const mod = await import('got-scraping'); gs = mod.gotScraping || mod.default || mod.got; } catch {}
  if (!gs) { console.log('    [headOk] no got-scraping'); return false; }
  try {
    const res = await gs(url, { method: 'HEAD', headers: { 'User-Agent': UA }, timeout: { request: 6000 }, throwHttpErrors: false, followRedirect: true });
    console.log(`    [headOk] ${res.statusCode} ${url.slice(0, 90)}`);
    return res.statusCode >= 200 && res.statusCode < 400;
  } catch (e) { console.log(`    [headOk ERR] ${e.message} ${url.slice(0, 90)}`); return false; }
}

// ---- Step A: search ----
console.log('=== STEP A: search ===');
const searchHtml = await fetchText(ORIGIN + '/?s=' + encodeURIComponent('Avengers Endgame'));
const links = [...searchHtml.matchAll(/href="(https:\/\/movieshunt\.casa\/([a-z0-9-]+)\/)"/g)];
const seen = new Set(); const results = [];
for (const m of links) {
  const slug = m[2];
  if (slug.match(/^(category|tag|page|wp-|feed|comment|search|author|disclaimer|dmca|privacy|contact|about)/)) continue;
  if (seen.has(slug)) continue; seen.add(slug);
  if (slug.toLowerCase().includes('avengers')) results.push({ url: m[1], slug });
}
console.log('results:', results.map(r => r.slug));

// ---- Step B: movie page + parse links ----
console.log('=== STEP B: movie page ===');
const movieHtml = await fetchText(results[0].url, ORIGIN + '/');
console.log('page length:', movieHtml.length);
const abhi = [...movieHtml.matchAll(/href="(https:\/\/abhilinks\.site\/archives\/(\d+)\/?)"/g)];
const hub = [...movieHtml.matchAll(/href="(https:\/\/hubcloud\.[a-z]+\/(?:drive|video)\/([a-z0-9_]+))"/g)];
const gd = [...movieHtml.matchAll(/href="(https:\/\/(?:new\d+\.)?gdflix\.[a-z]+\/file\/([A-Za-z0-9]+))"/g)];
console.log('abhilinks:', abhi.map(m => m[1]), '\nhubcloud:', hub.map(m => m[1]), '\ngdflix:', gd.map(m => m[1]));

// ---- Step C: resolve the found link(s) with full logging ----
const allLinks = [
  ...abhi.map(m => ({ type: 'abhilinks', url: m[1] })),
  ...hub.map(m => ({ type: 'hubcloud', url: m[1] })),
  ...gd.map(m => ({ type: 'gdflix', url: m[1] })),
];
for (const link of allLinks) {
  console.log(`\n=== STEP C: resolving ${link.type}: ${link.url} ===`);
  if (link.type === 'abhilinks') {
    const archHtml = await fetchText(link.url, ORIGIN + '/');
    const subs = [
      ...[...archHtml.matchAll(/href="(https:\/\/hubcloud\.[a-z]+\/(?:drive|video)\/([a-z0-9_]+))"/g)].map(m => ({ source: 'hubcloud', url: m[1] })),
      ...[...archHtml.matchAll(/href="(https:\/\/(?:new\d+\.)?gdflix\.[a-z]+\/file\/([A-Za-z0-9]+))"/g)].map(m => ({ source: 'gdflix', url: m[1] })),
    ];
    console.log('archive subs:', subs);
    for (const sub of subs.slice(0, 3)) {
      console.log(`  -- sub ${sub.source}: ${sub.url}`);
      const html = await fetchText(sub.url, 'https://hubcloud.cx/');
      const gx = html.match(/https:\/\/gamerxyt\.com\/hubcloud\.php\?[^"'\s]+/);
      const sv = html.match(/https:\/\/sportverse\.cc\/hubcloud\.php\?[^"'\s]+/);
      const pixel = html.match(/https:\/\/pixel\.hubcloud\.[a-z]+\/\?id=[^"'\s]+/);
      console.log('  gamerxyt:', gx && gx[0].slice(0, 100));
      console.log('  sportverse:', sv && sv[0].slice(0, 100));
      console.log('  pixel:', pixel && pixel[0].slice(0, 100));
      if (gx) {
        const gxHtml = await fetchText(gx[0], sub.url);
        const lh3 = gxHtml.match(/https:\/\/lh3\.googleusercontent\.com\/[^\s"'<>]+/);
        const pd = [...new Set([...gxHtml.matchAll(/https:\/\/pixeldrain\.[a-z]+\/u\/([A-Za-z0-9]+)/gi)].map(m => m[1]))];
        console.log('  gx lh3:', lh3 && lh3[0].slice(0, 90));
        console.log('  gx pixeldrain ids:', pd);
        if (lh3) {
          const dl = lh3[0].split('#')[0].split('=m')[0] + '=d';
          await headOk(dl);
        }
        for (const p of pd.slice(0, 2)) await headOk('https://pixeldrain.com/api/file/' + p + '?download');
      }
      if (sv) {
        const svHtml = await fetchText(sv[0], sub.url);
        console.log('  sv length:', svHtml.length, '| has lh3:', /lh3\.googleusercontent/.test(svHtml), '| has vd:', /video-downloads\.googleusercontent/.test(svHtml), '| has pd:', /pixeldrain/.test(svHtml), '| has r2:', /r2\.cloudflarestorage|r2\.dev/.test(svHtml));
      }
      if (pixel) {
        console.log('  (pixel chain fallback would emit HTML page URL: ' + pixel[0].slice(0, 80) + ')');
      }
    }
  } else if (link.type === 'hubcloud') {
    const html = await fetchText(link.url, 'https://hubcloud.cx/');
    console.log('  page length:', html.length);
    const gx = html.match(/https:\/\/gamerxyt\.com\/hubcloud\.php\?[^"'\s]+/);
    const sv = html.match(/https:\/\/sportverse\.cc\/hubcloud\.php\?[^"'\s]+/);
    const pixel = html.match(/https:\/\/pixel\.hubcloud\.[a-z]+\/\?id=[^"'\s]+/);
    console.log('  gamerxyt:', !!gx, '| sportverse:', !!sv, '| pixel:', !!pixel);
    if (gx) {
      const gxHtml = await fetchText(gx[0], link.url);
      const lh3 = gxHtml.match(/https:\/\/lh3\.googleusercontent\.com\/[^\s"'<>]+/);
      console.log('  gx lh3:', !!lh3);
      if (lh3) await headOk(lh3[0].split('#')[0].split('=m')[0] + '=d');
    }
  } else if (link.type === 'gdflix') {
    const html = await fetchText(link.url);
    const idx = html.match(/https:\/\/max\.indexserver\.site\/[^\s"'<>]+/);
    console.log('  indexserver:', idx ? idx[0].slice(0, 100) : 'NOT FOUND');
    if (!idx) console.log('  page head:', html.slice(0, 300).replace(/\s+/g, ' '));
  }
}
console.log('\nDONE');
