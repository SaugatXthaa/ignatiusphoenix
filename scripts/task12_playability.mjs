// task12_playability.mjs — HEAD/Range-check resolved stream URLs
import { gotScraping } from 'got-scraping';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const urls = process.argv.slice(2);
for (const u of urls) {
  try {
    const res = await gotScraping({
      url: u,
      method: 'GET',
      headers: { 'User-Agent': UA, Range: 'bytes=0-1023' },
      timeout: { request: 20000 },
      throwHttpErrors: false,
      followRedirect: false,
      http2: true,
    });
    const ct = res.headers['content-type'] || '?';
    const cr = res.headers['content-range'] || '';
    const cl = res.headers['content-length'] || '';
    console.log(`${res.statusCode} | CT: ${String(ct).slice(0, 40)} | CR: ${String(cr).slice(0, 40)} | CL: ${cl} | ${u.slice(0, 80)}`);
  } catch (e) {
    console.log(`ERR ${e.message?.slice(0, 60)} | ${u.slice(0, 80)}`);
  }
}
