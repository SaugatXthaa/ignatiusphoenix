// task50_fetch_variant.mjs — compare what undici fetch vs got-scraping receive
// from 4khdhub.one post pages (content-file block presence per transport).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const URL_POST = 'https://4khdhub.one/inception-movie-509/';

function summarize(tag, html) {
  const cf = (html.match(/content-file/g) || []).length;
  const gm = (html.match(/greenmotors/g) || []).length;
  const hc = (html.match(/hubcloud/gi) || []).length;
  const title = (html.match(/<title>[^<]*/) || [''])[0];
  console.log(`[${tag}] len=${html.length} content-file=${cf} greenmotors=${gm} hubcloud=${hc} ${title.slice(0, 50)}`);
  // Show where the download section would be — find "Download" anchor context
  const dl = html.indexOf('Download');
  console.log(`[${tag}] first "Download" at index=${dl}`);
  return { cf, gm, hc };
}

async function viaUndici() {
  const r = await fetch(URL_POST, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, signal: AbortSignal.timeout(15000) });
  const t = await r.text();
  console.log(`[undici] status=${r.status}`);
  summarize('undici', t);
}

async function viaGotScraping() {
  const { gotScraping } = await import('got-scraping');
  const r = await gotScraping({ url: URL_POST, headers: { 'User-Agent': UA }, timeout: { request: 15000 }, responseType: 'text' });
  console.log(`[got] status=${r.statusCode}`);
  summarize('got', r.body);
}

(async () => {
  for (let i = 1; i <= 3; i++) {
    console.log(`--- iteration ${i} ---`);
    try { await viaUndici(); } catch (e) { console.log('[undici] error:', e.message?.slice(0, 80)); }
    try { await viaGotScraping(); } catch (e) { console.log('[got] error:', e.message?.slice(0, 80)); }
    await new Promise(r => setTimeout(r, 2000));
  }
})();
