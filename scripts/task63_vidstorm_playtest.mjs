// Task 63: in-process raflix vidstorm card play-test (full card list, real player path)
'use strict';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const { Fetcher } = await import(pathToFileURL(path.join(projectRoot, 'src/utils/Fetcher.js')).href);
const fetcher = new Fetcher(logger);
const { Raflix } = await import(pathToFileURL(path.join(projectRoot, 'src/source/Raflix.js')).href);
const { ImdbId } = await import(pathToFileURL(path.join(projectRoot, 'src/utils/id.js')).href);

const raflix = new Raflix(fetcher);
const ctx = { hostUrl: new URL('http://127.0.0.1:4697'), id: 'test', ip: '127.0.0.1', config: { multi: 'on', en: 'on' } };

async function playTest(label, url) {
  console.log(`\n=== PLAY-TEST ${label} ===`);
  try {
    const m = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const mt = await m.text();
    console.log(`master: ${m.status} ${m.headers.get('content-type')} | ${mt.slice(0, 70).replace(/\n/g, ' ')}`);
    if (!m.ok || !mt.includes('#EXTM3U')) return false;
    const lines = mt.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    const vRel = lines[0];
    const vUrl = vRel.startsWith('http') ? vRel : new URL(vRel, url).href;
    const r2 = await fetch(vUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const t2 = await r2.text();
    console.log(`variant: ${r2.status} | ${t2.slice(0, 90).replace(/\n/g, ' ')}`);
    if (!r2.ok) return false;
    const segLines = t2.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    const sRel = segLines[0];
    const sUrl = sRel.startsWith('http') ? sRel : new URL(sRel, vUrl).href;
    const r3 = await fetch(sUrl, { headers: { 'User-Agent': 'Mozilla/5.0', Range: 'bytes=0-99999' } });
    const buf = await r3.arrayBuffer();
    console.log(`segment: ${r3.status} bytes=${buf.byteLength} head=${Buffer.from(buf.slice(0, 4)).toString('hex')}`);
    return r3.ok && buf.byteLength > 1000;
  } catch (e) { console.log('ERR', String(e).slice(0, 100)); return false; }
}

for (const [type, rawId, label] of [
  ['movie', 'tt1375666', 'Inception'],
  ['series', 'tt0944947:1:1', 'GoT S1E1'],
]) {
  const id = ImdbId.fromString(rawId);
  const t0 = Date.now();
  const results = await raflix.handleInternal(ctx, type, id);
  console.log(`\n${label}: ${results.length} raw results @${Date.now() - t0}ms`);
  const vsCards = results.filter(r => /vidstorm/i.test(r.meta?.serverName || ''));
  console.log(`vidstorm cards: ${vsCards.length}`);
  for (const c of vsCards) {
    console.log(`  ${c.meta.serverName} h=${c.meta.height} url=${String(c.url.href).slice(0, 130)}`);
    console.log(`  inner: ${decodeURIComponent(c.url.href.match(/url=([^&]+)/)?.[1] || '').slice(0, 100)}`);
    const ok = await playTest(c.meta.serverName, c.url.href);
    console.log(`  → ${ok ? 'PLAYABLE ✅' : 'FAILED ❌'}`);
  }
}
process.exit(0);
