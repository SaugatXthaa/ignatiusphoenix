// Task 61 Phase 1 (single title): pull merged /stream for ONE title, 2 rounds,
// save deduped cards. Run per title; analysis happens in task61_analyze.mjs.
import https from 'https';
import fs from 'fs';

const BASE = 'https://ignatiusphoenix.onrender.com';
const OUT = '/home/z/my-project/phoenix-analysis/scripts/task61';
fs.mkdirSync(OUT, { recursive: true });

const [,, type, id, label] = process.argv;
if (!type || !id || !label) { console.error('usage: node task61_title.mjs <type> <id> <label>'); process.exit(1); }

const wait = (ms) => new Promise(r => setTimeout(r, ms));

let d = { streams: [] };
try { d = await (await fetch(`${BASE}/stream/${type}/${id}.json`, { signal: AbortSignal.timeout(120000) })).json(); } catch (e) { console.log(`r1 fetch error: ${String(e).slice(0, 80)}`); }
const r1 = d.streams || [];
console.log(`${label} r1: ${r1.length} cards`);
await wait(40000);
try { d = await (await fetch(`${BASE}/stream/${type}/${id}.json`, { signal: AbortSignal.timeout(120000) })).json(); } catch (e) { console.log(`r2 fetch error: ${String(e).slice(0, 80)}`); }
const r2 = d.streams || [];
console.log(`${label} r2: ${r2.length} cards`);

const seen = new Map();
for (const s of r1) if (s.url) seen.set(s.url, s);
for (const s of r2) if (s.url) seen.set(s.url, s);
const all = [...seen.values()];
const htmlCards = all.filter(s => /\.(html?)(\?|$)/i.test((s.url || '').split('?')[0]) && !/\.(m3u8|mp4|mkv|ts)(\?|$)/i.test((s.url || '').split('?')[0]));
const withSubs = all.filter(s => (s.subtitles || []).length > 0).length;
console.log(`unique=${all.length} subbed=${withSubs}/${all.length} html=${htmlCards.length}`);
fs.writeFileSync(`${OUT}/cards_${label.replace(/\W/g, '')}.json`, JSON.stringify(all, null, 1));
console.log(`saved ${OUT}/cards_${label.replace(/\W/g, '')}.json`);
