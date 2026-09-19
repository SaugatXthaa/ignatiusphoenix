// Task 62 production verification v2: N rounds, fresh resolve each round,
// probe EVERY google range-proxy card via ffmpeg (6s decode), stop early on success per card class.
import { spawn } from 'child_process';
import fs from 'fs';

const BASE = 'https://ignatiusphoenix.onrender.com';
const ROUNDS = parseInt(process.env.ROUNDS || '3', 10);

function playTest(label, url, seconds = 6) {
  return new Promise((resolve) => {
    const child = spawn('timeout', ['-k', '3', '75', 'ffmpeg', '-nostdin', '-v', 'info', '-i', url, '-t', String(seconds), '-f', 'null', '-']);
    let err = '';
    child.stderr.on('data', c => { err += c.toString(); });
    child.on('close', () => {
      const stats = err.split('\r').filter(l => /frame=/.test(l)).pop() || 'no-stats';
      const empty = /Output file is empty|File ended prematurely|Error opening input/.test(err);
      const ok = !empty && /time=00:00:0[4-9]|time=00:00:[1-9][0-9]/.test(stats);
      console.log(`  ${label.padEnd(24)} ${ok ? 'PLAYS OK' : 'FAILS'}  ${stats.trim().slice(0, 60)}`);
      if (!ok) console.log(`     err: ${err.replace(/\n/g, ' | ').slice(-200)}`);
      resolve(ok);
    });
  });
}

const results = {};
for (let round = 1; round <= ROUNDS; round++) {
  const d = await (await fetch(`${BASE}/stream/movie/tt37287335.json`, { signal: AbortSignal.timeout(150000) })).json();
  const cards = d.streams || [];
  const google = cards.filter(s => /range-proxy/.test(s.url || '') && /googleusercontent/.test(s.url || ''));
  console.log(`\n=== round ${round}: ${cards.length} cards, ${google.length} google rp ===`);
  const labels = google.map(s => {
    const bg = s.behaviorHints?.bingeGroup || '';
    const src = (bg.match(/^phoenix-([a-z0-9]+)/i) || [])[1] || 'unk';
    return `${src}-${/4K/.test(s.name) ? '4K' : /1080/.test(s.name) ? '1080p' : /720/.test(s.name) ? '720p' : 'q'}`;
  });
  console.log('  cards: ' + labels.join(', '));
  for (let i = 0; i < google.length; i++) {
    const label = labels[i];
    if (results[label] === true) continue; // already proven
    const ok = await playTest(label, google[i].url);
    results[label] = ok;
  }
  if (Object.values(results).filter(Boolean).length >= 3 && round >= 2) break;
}
fs.writeFileSync('/home/z/my-project/phoenix-analysis/scripts/task62/prod_verify_v2.json', JSON.stringify(results, null, 1));
const pass = Object.values(results).filter(Boolean).length;
console.log(`\nRESULT: ${pass}/${Object.keys(results).length} card classes PLAY OK on production`);
