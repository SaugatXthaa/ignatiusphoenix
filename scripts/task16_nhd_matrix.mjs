// Task 16 — NowHDTime token matrix: what does /api/hls?t= need to serve m3u8?
import { gotScraping } from 'got-scraping';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const API_KEY = '7d5239afc1d0a4fa374587d1d3feb1b0';

// 1. fresh playUrl
const apiRes = await gotScraping.get('https://nhdapi.com/api/movie/299534', {
  headers: { 'User-Agent': UA, 'X-API-Key': API_KEY, Accept: 'application/json' },
  timeout: { request: 20000 }, throwHttpErrors: false,
});
console.log('api status:', apiRes.statusCode);
const data = JSON.parse(typeof apiRes.body === 'string' ? apiRes.body : apiRes.body.toString());
console.log('success:', data.success, '| playUrl:', (data.playUrl || '').slice(0, 90));
if (!data.playUrl) process.exit(0);

// 2. header combos against playUrl
const combos = [
  ['plain UA', { 'User-Agent': UA }],
  ['UA+XAPIKey', { 'User-Agent': UA, 'X-API-Key': API_KEY }],
  ['UA+Referer', { 'User-Agent': UA, Referer: 'https://www.nowhdtime.to/' }],
  ['UA+Range', { 'User-Agent': UA, Range: 'bytes=0-1023' }],
  ['no UA', {}],
  ['UA+XAPIKey+Referer', { 'User-Agent': UA, 'X-API-Key': API_KEY, Referer: 'https://www.nowhdtime.to/' }],
];
for (const [name, headers] of combos) {
  try {
    const r = await gotScraping.get(data.playUrl, { headers, timeout: { request: 15000 }, throwHttpErrors: false });
    const body = typeof r.body === 'string' ? r.body : r.body.toString();
    const head = body.slice(0, 80).replace(/\s+/g, ' ');
    console.log(`${name}: ${r.statusCode} | ${/EXTM3U/.test(body) ? 'M3U8 ✓' : head}`);
  } catch (e) { console.log(`${name}: ERR ${e.message}`); }
}

// 3. does a SECOND api call change verdict (per-call token binding)?
const apiRes2 = await gotScraping.get('https://nhdapi.com/api/movie/299534', {
  headers: { 'User-Agent': UA, 'X-API-Key': API_KEY, Accept: 'application/json' },
  timeout: { request: 20000 }, throwHttpErrors: false,
});
const data2 = JSON.parse(typeof apiRes2.body === 'string' ? apiRes2.body : apiRes2.body.toString());
const r2 = await gotScraping.get(data2.playUrl, { headers: { 'User-Agent': UA }, timeout: { request: 15000 }, throwHttpErrors: false });
const b2 = typeof r2.body === 'string' ? r2.body : r2.body.toString();
console.log(`\nsecond-call token, plain UA: ${r2.statusCode} | ${/EXTM3U/.test(b2) ? 'M3U8 ✓' : b2.slice(0, 80).replace(/\s+/g, ' ')}`);
