// Task 62 Phase 1: fresh merged /stream sweep, per-source attribution via bingeGroup.
// Usage: node task62_sweep.mjs <type> <id> <label>
import fs from 'fs';

const BASE = 'https://ignatiusphoenix.onrender.com';
const OUT = '/home/z/my-project/phoenix-analysis/scripts/task62';
fs.mkdirSync(OUT, { recursive: true });

const [,, type, id, label] = process.argv;
if (!type || !id || !label) { console.error('usage: node task62_sweep.mjs <type> <id> <label>'); process.exit(1); }

const wait = (ms) => new Promise(r => setTimeout(r, ms));

function attrib(s) {
  const bg = s.behaviorHints?.bingeGroup || '';
  const m = bg.match(/^phoenix-([a-z0-9]+)/i);
  if (m) return m[1];
  return (s.name || '?').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 14);
}

let d = { streams: [] };
try { d = await (await fetch(`${BASE}/stream/${type}/${id}.json`, { signal: AbortSignal.timeout(150000) })).json(); } catch (e) { console.log(`r1 fetch error: ${String(e).slice(0, 80)}`); }
const r1 = d.streams || [];
console.log(`${label} r1: ${r1.length} cards`);
await wait(40000);
try { d = await (await fetch(`${BASE}/stream/${type}/${id}.json`, { signal: AbortSignal.timeout(150000) })).json(); } catch (e) { console.log(`r2 fetch error: ${String(e).slice(0, 80)}`); }
const r2 = d.streams || [];
console.log(`${label} r2: ${r2.length} cards`);

const seen = new Map();
for (const s of r1) if (s.url) seen.set(s.url, s);
for (const s of r2) if (s.url) seen.set(s.url, s);
const all = [...seen.values()];
const htmlCards = all.filter(s => /\.(html?)(\?|$)/i.test((s.url || '').split('?')[0]) && !/\.(m3u8|mp4|mkv|ts)(\?|$)/i.test((s.url || '').split('?')[0]));
const withSubs = all.filter(s => (s.subtitles || []).length > 0).length;

const bySrc = {};
const r1BySrc = {};
for (const s of all) { const k = attrib(s); bySrc[k] = (bySrc[k] || 0) + 1; }
for (const s of r1) { const k = attrib(s); r1BySrc[k] = (r1BySrc[k] || 0) + 1; }
console.log(`unique=${all.length} subbed=${withSubs}/${all.length} html=${htmlCards.length}`);
console.log('r1 sources:', Object.entries(r1BySrc).map(([k, v]) => `${k}:${v}`).join(' '));
console.log('all sources:', Object.entries(bySrc).map(([k, v]) => `${k}:${v}`).join(' '));
const fourK = all.filter(s => /2160|4k/i.test(s.name || '') || /2160/.test(s.title || ''));
console.log(`4K cards: ${fourK.length}`);
fs.writeFileSync(`${OUT}/cards_${label.replace(/\W/g, '')}.json`, JSON.stringify(all, null, 1));
fs.writeFileSync(`${OUT}/bysrc_${label.replace(/\W/g, '')}.json`, JSON.stringify({ r1: r1BySrc, all: bySrc }, null, 1));
console.log(`saved cards_${label.replace(/\W/g, '')}.json`);
