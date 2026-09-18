// zxcstream: test sentinel + token endpoints from SANDBOX
import crypto from 'crypto';
const BASE = 'https://player.zxcstream.xyz';
const SECRET = '24356351231432574635345245245252324';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const tmdbId = 265712; // Stand by Me Doraemon
const ts = Date.now();
const xt = crypto.createHash('sha512').update(`${ts}:${SECRET}:${tmdbId}`).digest('hex').slice(0, 64);

// 1. token endpoint
try {
  const r = await fetch(`${BASE}/backend/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'Referer': `${BASE}/` },
    body: JSON.stringify({ id: tmdbId, fToken: xt, ts }), signal: AbortSignal.timeout(10000),
  });
  const body = await r.text();
  console.log('TOKEN endpoint:', r.status, body.slice(0, 200));
} catch (e) { console.log('TOKEN error:', e.message); }

// 2. sentinel endpoint
try {
  const r = await fetch(`${BASE}/backend_/embed/sentinel?id=${tmdbId}&b=movie&ts=${ts}&token=&fToken=${encodeURIComponent(xt)}`, {
    headers: { 'User-Agent': UA, 'Referer': `${BASE}/embed/movie/${tmdbId}` }, redirect: 'follow', signal: AbortSignal.timeout(10000),
  });
  const body = await r.text();
  console.log('SENTINEL endpoint:', r.status, body.slice(0, 300));
} catch (e) { console.log('SENTINEL error:', e.message); }

// 3. player page fetch — look for stream hints / server list
try {
  const r = await fetch(`${BASE}/embed/movie/${tmdbId}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
  const body = await r.text();
  console.log('PLAYER PAGE:', r.status, 'len=', body.length);
  const m = /servers?\s*[:=]\s*(\[[^\]]{10,400}\])/.exec(body);
  if (m) console.log('servers hint:', m[1].slice(0, 300));
  const api = /backend[_]?\/[a-z/_-]+/g.exec(body);
  if (api) console.log('api paths:', [...new Set(body.match(/backend_?\/[a-zA-Z/_-]+/g))].slice(0, 10));
} catch (e) { console.log('PLAYER PAGE error:', e.message); }
