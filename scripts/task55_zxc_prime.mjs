// zxcprime mirror: dump bundle → extract FIELD_MAP/SECRET/POST path → full flow
import crypto from 'crypto';
import fs from 'fs';

const BASE = process.argv[2] || 'https://player.zxcprime.xyz';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

// 1. find the app chunks from the home page
const home = await (await fetch(`${BASE}/`, { headers: { 'User-Agent': UA } })).text();
const srcs = [...home.matchAll(/src="([^"]+\.js[^"]*)"/g)].map(m => m[1]);
console.log('home scripts:', srcs.length);

let fieldMap = null, secret = null, postPath = null;
for (const s of srcs) {
  const url = s.startsWith('http') ? s : `${BASE}${s}`;
  try {
    const body = await (await fetch(url, { headers: { 'User-Agent': UA } })).text();
    const fm = /let [a-zA-Z]="([^"]+)",([a-zA-Z])=\{id:"([a-f0-9]+)",fToken:"([a-f0-9]+)",ts:"([a-f0-9]+)",token:"([a-f0-9]+)"/.exec(body);
    if (fm) {
      secret = fm[1];
      fieldMap = { id: fm[3], fToken: fm[4], ts: fm[5], token: fm[6] };
      // extend with path/mediaType if present
      const pathM = /path:"([a-f0-9]+)"/.exec(body); const mtM = /mediaType:"([a-f0-9]+)"/.exec(body);
      const seasonM = /season:"([a-f0-9]+)"/.exec(body); const epM = /episode:"([a-f0-9]+)"/.exec(body);
      const imdbM = /imdbId:"([a-f0-9]+)"/.exec(body);
      if (pathM) fieldMap.path = pathM[1];
      if (mtM) fieldMap.mediaType = mtM[1];
      if (seasonM) fieldMap.season = seasonM[1];
      if (epM) fieldMap.episode = epM[1];
      if (imdbM) fieldMap.imdbId = imdbM[1];
      const pp = /\.post\("([^"]+)"[^)]*?FIELD_MAP/.exec(body) || /post\("([^"]*backend[^"]*)"/.exec(body);
      if (pp) postPath = pp[1];
      console.log('FOUND in', url.slice(-40));
      break;
    }
  } catch (e) { /* skip */ }
}
console.log('secret:', secret, '\nfieldMap:', JSON.stringify(fieldMap), '\npostPath:', postPath);
if (!fieldMap) { console.log('no field map found'); process.exit(0); }

// 2. full flow: token → sentinel
const tmdbId = 265712;
const ts = Date.now();
const xt = crypto.createHash('sha512').update(`${ts}:${secret}:${tmdbId}`).digest('hex').slice(0, 64);
const pagePath = `/embed/movie/${tmdbId}`;
const tokBody = { [fieldMap.id]: tmdbId, [fieldMap.fToken]: xt, [fieldMap.ts]: ts };
if (fieldMap.path) tokBody[fieldMap.path] = pagePath;
if (fieldMap.mediaType) tokBody[fieldMap.mediaType] = 'movie';
const r1 = await fetch(`${BASE}${postPath || '/backend/a1b2c3'}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'Referer': `${BASE}${pagePath}`, 'Origin': BASE },
  body: JSON.stringify(tokBody), signal: AbortSignal.timeout(12000),
});
const t1 = await r1.text();
console.log('TOKEN:', r1.status, t1.slice(0, 160));
if (!r1.ok) process.exit(0);
const j1 = JSON.parse(t1);
const token = j1[fieldMap.token] || j1.token;
const serverTs = j1[fieldMap.ts] || j1.ts;
const q = new URLSearchParams({ [fieldMap.id]: String(tmdbId), b: 'movie', [fieldMap.ts]: String(serverTs), [fieldMap.token]: token, [fieldMap.fToken]: xt });
const r2 = await fetch(`${BASE}/backend_/embed/sentinel?${q}`, { headers: { 'User-Agent': UA, 'Referer': `${BASE}${pagePath}` }, signal: AbortSignal.timeout(12000) });
const t2 = await r2.text();
console.log('SENTINEL:', r2.status, t2.trimStart().startsWith('<') ? '(html)' : t2.slice(0, 400));
