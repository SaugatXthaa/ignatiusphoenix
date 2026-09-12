// task12_pixel_trace.mjs — trace pixel.hubcloud.cx redirect chain hop by hop
import { gotScraping } from 'got-scraping';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const pixelUrl = 'https://pixel.hubcloud.cx/?id=331f96c3409ee9ca81fa7e7f73adcca63a5cf85b2a3b2aed86f8845618f033e8bd8102de4895321871e08b2e5989d92cac8a944d5b18524f467c7615279e9bd573cb1a6c1fbcc41e4be071aac016f733c3e55e4c7ea258adb4a13f9de499b6c9::04ba85232843d8d27d4e6127e74aa806';

let currentUrl = pixelUrl;
for (let i = 0; i < 6; i++) {
  const t0 = Date.now();
  let res;
  try {
    res = await gotScraping(currentUrl, {
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*', Referer: 'https://hubcloud.cx/' },
      timeout: { request: 10000 }, throwHttpErrors: false, followRedirect: false, http2: true,
    });
  } catch (e) { console.log(`hop ${i}: FETCH ERR ${e.message?.slice(0, 80)}`); break; }
  const ms = Date.now() - t0;
  const loc = res.headers.location || '';
  console.log(`hop ${i}: ${res.statusCode} in ${ms}ms | loc=${loc.slice(0, 100)} | url=${currentUrl.slice(0, 80)}...`);
  if (res.statusCode >= 300 && res.statusCode < 400 && loc) {
    currentUrl = loc.startsWith('http') ? loc : new URL(loc, currentUrl).toString();
    continue;
  }
  // 200: inspect body
  const body = typeof res.body === 'string' ? res.body : (res.body ? res.body.toString() : '');
  console.log(`  body len=${body.length}`);
  const dl = body.match(/https:\/\/video-downloads\.googleusercontent\.com\/[A-Za-z0-9_-]+/i);
  const lh3 = body.match(/https:\/\/lh3\.googleusercontent\.com\/[A-Za-z0-9_/-]+/i);
  const meta = body.match(/http-equiv="refresh"[^>]*url=([^"]+)/i);
  const jsLoc = body.match(/(?:location|window\.location)\s*[=.]\s*['"]([^'"]+)['"]/i);
  console.log(`  video-downloads in body: ${dl ? dl[0].slice(0, 80) : 'no'}`);
  console.log(`  lh3 in body: ${lh3 ? lh3[0].slice(0, 80) : 'no'}`);
  console.log(`  meta refresh: ${meta ? meta[1].slice(0, 80) : 'no'}`);
  console.log(`  js location: ${jsLoc ? jsLoc[1].slice(0, 80) : 'no'}`);
  if (currentUrl.includes('gamerxyt') && currentUrl.includes('dl.php')) {
    const link = new URL(currentUrl).searchParams.get('link');
    console.log(`  dl.php link param: ${link ? link.slice(0, 80) : 'none'}`);
  }
  break;
}
console.log('\nfinal URL:', currentUrl.slice(0, 120));
