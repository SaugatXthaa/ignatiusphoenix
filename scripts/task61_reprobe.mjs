// Task 61 Phase 3b: re-probe the FAIL set with retries, http support, and
// full card context (headers, behaviorHints) to classify real vs artifact.
import https from 'https';
import http from 'http';
import fs from 'fs';
import { URL } from 'url';

const OUT = '/home/z/my-project/phoenix-analysis/scripts/task61';
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const get = (u, headers = {}, timeout = 30000, onHeaders = null) => new Promise((resolve) => {
  let req;
  try {
    const mod = u.startsWith('http://') ? http : https;
    req = mod.get(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36', ...headers }, timeout }, (res) => {
      if (onHeaders) { onHeaders(res); req.destroy(); return resolve({ status: res.statusCode, headers: res.headers, body: Buffer.alloc(0) }); }
      const c = []; let n = 0;
      res.on('data', d => { if (n < 300000) { c.push(d); n += d.length; } else req.destroy(); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c) }));
      res.on('error', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c) }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ status: 0, headers: {}, body: Buffer.alloc(0), err: String(e && e.message || e) }));
  } catch (e) { resolve({ status: -1, headers: {}, body: Buffer.alloc(0), err: String(e).slice(0, 120) }); }
});

const REFAILS = ['anikage', 'animeflix', 'atlantic', 'cinebyrocks', 'desiflix', 'hdhub4uv2', 'hindmovie', 'moviebox', 'netlio', 'pantyflix', 'playimdb', 'raflix', 'vidlink2', 'vixsrc'];

const groupRe = /(fourkhdhubone|movieshuntv2|moviesdrivev2|vegamovies2|cinejoyaio|hdhub4uv2|cinebyrocks|stellarrip|movielinkbd|animotvslash|animeworldindia|animesdigital|anikototv|persianstremio|4khdhub|cinefreak|moviebox|cinewave|watchseries|necro|vidsrcsbs|vidlink2|vidking|vidfast|vegamovies|primeshows|netlio|animeflix|anineko|verhdlink|meinecloud|acermovies|streamxtv|anikoto|anikage|anibd|2dhive|anidoor|nowhdtime|pantyflix|animegg|peckle|hianime|animekai|cineby|hindmoviez|playimdb|zxcstream|animezey|uhdmovies|videasy|itachi|imdbplay|raflix|hindmovie|rivestream|reanime|desiflix|anichan|animesuge|bollyflix|framextv|nikastream|stellar|cinehdplus|vidzee|vixsrc|allwish|videasyto|kmmovies|atlantic)/i;
const attr = (s) => {
  const g = (s.behaviorHints || {}).bingeGroup || '';
  const m = g.match(groupRe);
  if (m) return m[0].toLowerCase();
  return 'unknown';
};

// gather all cards for the fail sources
const perSource = new Map();
for (const tl of ['Inception', 'Obsession', 'GoTS1E1', 'SquidGameS1E1v2', 'FrierenS2E1']) {
  let cards;
  try { cards = JSON.parse(fs.readFileSync(`${OUT}/cards_${tl}.json`, 'utf8')); } catch { continue; }
  for (const s of cards) {
    const id = attr(s);
    if (!REFAILS.includes(id)) continue;
    if (!perSource.has(id)) perSource.set(id, []);
    perSource.get(id).push(s);
  }
}

const sniffHtml = (buf) => /^\s*<(!doctype|html|\?xml)/i.test(buf.slice(0, 100).toString());

async function probeCard(card, attempt) {
  const url = card.url || '';
  const hdrs = { ...((card.behaviorHints || {}).proxyHeaders || {}) };
  if (url.includes('/proxy?')) {
    const r = await get(url, {}, 45000);
    const head = r.body.toString('utf8', 0, 7);
    const ok = r.status === 200 && (head === '#EXTM3U' || head === 'WEBVTT' || /^video\/|^audio\//.test(r.headers['content-type'] || '')) && !sniffHtml(r.body);
    return `attempt${attempt}: status=${r.status} head=${head.replace(/\n/g, '|')} ct=${r.headers['content-type'] || '-'}`;
  }
  if (url.includes('/range-proxy?')) {
    const r = await get(url, { Range: 'bytes=0-65535', ...hdrs }, 45000);
    const ok = (r.status === 206 || r.status === 200) && !sniffHtml(r.body);
    return `attempt${attempt}: status=${r.status} ct=${r.headers['content-type'] || '-'}`;
  }
  const r = await get(url, { Range: 'bytes=0-65535', ...hdrs }, 30000);
  const ok = (r.status === 206 || r.status === 200) && !sniffHtml(r.body) && !/text\/html/i.test(r.headers['content-type'] || '');
  return `attempt${attempt}: status=${r.status} ct=${r.headers['content-type'] || '-'} bytes=${r.body.length}`;
}

for (const [src, cards] of [...perSource.entries()].sort()) {
  console.log(`\n=== ${src} (${cards.length} cards) ===`);
  // pick up to 3 diverse cards (first, a /proxy one, a direct one)
  const picks = [];
  const seenKinds = new Set();
  for (const c of cards) {
    const u = c.url || '';
    const kind = u.includes('/proxy?') ? 'proxy' : u.includes('/range-proxy?') ? 'rp' : 'direct';
    if (!seenKinds.has(kind)) { seenKinds.add(kind); picks.push(c); }
    if (picks.length >= 3) break;
  }
  if (!picks.length) picks.push(cards[0]);
  for (const c of picks) {
    const u = c.url || '';
    console.log(`  card: ${u.slice(0, 110)}`);
    console.log(`    name=${c.name} | notWebReady=${(c.behaviorHints || {}).notWebReady} | hdrs=${Object.keys(((c.behaviorHints || {}).proxyHeaders) || {}).join(',') || '-'}`);
    let last = '';
    for (let a = 1; a <= 3; a++) {
      last = await probeCard(c, a);
      const ok = /status=(206|200)\b/.test(last) && !/ct=text\/html/.test(last) && !/head=<!DOCTYPE|head=<html/i.test(last);
      console.log(`    ${ok ? 'OK  ' : 'FAIL'} ${last}`);
      if (ok) break;
      await wait(1500);
    }
  }
}
