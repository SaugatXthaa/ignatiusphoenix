// Task 62 production verification: fresh Obsession resolve → ffmpeg through the
// deployed /range-proxy for the exact screenshot cards (MoviesDrive/CineFreak 4K).
import { spawn } from 'child_process';
import fs from 'fs';

const BASE = 'https://ignatiusphoenix.onrender.com';
const d = await (await fetch(`${BASE}/stream/movie/tt37287335.json`, { signal: AbortSignal.timeout(150000) })).json();
const cards = d.streams || [];
console.log(`Obsession: ${cards.length} cards`);
const google = cards.filter(s => /range-proxy/.test(s.url || '') && /googleusercontent/.test(s.url || ''));
console.log(`google range-proxy cards: ${google.length}`);

const picks = [];
const md4k = google.find(s => /moviesdrivev2/.test(s.behaviorHints?.bingeGroup || '') && /4K/.test(s.name));
if (md4k) picks.push(['MoviesDrive-4K', md4k]);
const cf4k = google.find(s => /cinefreak/.test(s.behaviorHints?.bingeGroup || '') && /4K/.test(s.name));
if (cf4k) picks.push(['CineFreak-4K', cf4k]);
const cf1080 = google.find(s => /cinefreak/.test(s.behaviorHints?.bingeGroup || '') && /1080p/.test(s.name));
if (cf1080) picks.push(['CineFreak-1080p', cf1080]);
const uhd = google.find(s => /uhdmovies/.test(s.behaviorHints?.bingeGroup || ''));
if (uhd) picks.push(['UHDMovies-google', uhd]);

function playTest(label, url) {
  return new Promise((resolve) => {
    const child = spawn('timeout', ['-k', '3', '55', 'ffmpeg', '-nostdin', '-v', 'info', '-i', url, '-t', '6', '-f', 'null', '-']);
    let err = '';
    child.stderr.on('data', c => { err += c.toString(); });
    child.on('close', () => {
      const stats = err.split('\r').filter(l => /frame=/.test(l)).pop() || 'no-stats';
      const empty = /Output file is empty|File ended prematurely|Error opening input/.test(err);
      const ok = !empty && /time=00:00:0[4-9]|time=00:00:[1-9][0-9]/.test(stats);
      console.log(`${label.padEnd(20)} → ${ok ? 'PLAYS OK' : 'FAILS'}  ${stats.trim().slice(0, 70)}`);
      if (!ok) console.log('   err:', err.replace(/\n/g, ' | ').slice(-300));
      resolve(ok);
    });
  });
}

let pass = 0, total = 0;
for (const [label, s] of picks) {
  console.log(`\n=== ${label} ===`);
  total++;
  if (await playTest(label, s.url)) pass++;
}
console.log(`\nRESULT: ${pass}/${total} production google cards PLAY through ffmpeg`);
