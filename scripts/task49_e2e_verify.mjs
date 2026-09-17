// Task 49 E2E: boot the addon, hit real /stream, verify:
//   1. Universal subtitles on cards from MANY different sources (movies+series+anime)
//   2. 4khdhub + hdhub4u cards present and playable-class URLs
//   3. Same provider set (granite/natsuki/opensubs markers) across sources
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..');
const PORT = 4597;

function sh(cmd, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn('bash', ['-c', cmd], { cwd: REPO, ...opts });
    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('close', code => resolve({ code, out, err }));
  });
}

console.log('booting addon on :' + PORT + ' (15s budget — production-like)...');
const boot = spawn('bash', ['-c', `STREAM_CLIENT_BUDGET_MS=15000 PHOENIX_PREWARM=0 PORT=${PORT} node src/index.js > /tmp/task49_e2e.log 2>&1`], { cwd: REPO, detached: true });
boot.unref();

// wait for boot
let up = false;
for (let i = 0; i < 40; i++) {
  await new Promise(r => setTimeout(r, 1000));
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/manifest.json`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) { up = true; break; }
  } catch {}
}
console.log('booted:', up);
if (!up) { console.log((await sh('tail -20 /tmp/task49_e2e.log')).out); process.exit(1); }

async function stream(type, id, extra = '') {
  const r = await fetch(`http://127.0.0.1:${PORT}/stream/${type}/${id}.json${extra}`, { signal: AbortSignal.timeout(60000) });
  return r.json();
}

const HOST = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  [PASS] ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ' — ' + detail : ''}`); }
};

const analyze = (streams, tag) => {
  const withSubs = streams.filter(s => Array.isArray(s.subtitles) && s.subtitles.length > 0);
  const bySrc = {};
  for (const s of streams) {
    const m = (s.name || '').match(/PhoeniX(?: · [^·]+)? · ([^·\u{1F3F4}]+?)·/u);
    for (const srcId of ['4KHDHub', 'HDHub4u', 'CineJoy', 'Atlantic', 'UHDMovies', 'Cineby', 'BollyFlix', 'CineWave', 'VidKing']) {
      if ((s.name || '').includes(srcId)) {
        bySrc[srcId] = bySrc[srcId] || { cards: 0, withSubs: 0, langs: 0 };
        bySrc[srcId].cards++;
        if (Array.isArray(s.subtitles) && s.subtitles.length) { bySrc[srcId].withSubs++; bySrc[srcId].langs = Math.max(bySrc[srcId].langs, s.subtitles.length); }
      }
    }
  }
  console.log(`\n${tag}: ${streams.length} cards, ${withSubs.length} with subtitles`);
  for (const [k, v] of Object.entries(bySrc)) console.log(`   ${k}: ${v.withSubs}/${v.cards} cards with subs (max ${v.langs} tracks)`);
  return { streams, withSubs, bySrc };
};

// ── 1. Movie (Inception) ──
const mv = analyze((await stream('movie', 'tmdb:27205')).streams || [], 'Inception movie');
// 15s budget on a just-booted instance = partial by design (Task 36); warm
// re-opens amplify (verified below). Cold floor 30, warm checks do the rest.
check('movie: >=30 cards cold', mv.streams.length >= 30, String(mv.streams.length));
check('movie: >=60% cards carry subtitles', mv.withSubs.length >= mv.streams.length * 0.6, `${mv.withSubs.length}/${mv.streams.length}`);
const mvSub = mv.withSubs[0]?.subtitles || [];
check('movie: subtitle set >=30 langs', mvSub.length >= 30, String(mvSub.length));
const hasGranite = mvSub.some(s => String(s.id).startsWith('gr-'));
const hasNatsuki = mvSub.some(s => String(s.id).startsWith('nk-'));
check('movie: granite provider present', hasGranite);
// natsuki is best-effort (its SRT host flaps 502 per-file — Task 48); granite
// carries the set when natsuki flaps. Assert granite always; log natsuki.
console.log(`   (info) natsuki present: ${hasNatsuki}`);
check('movie: 4khdhub cards present', (mv.bySrc['4KHDHub']?.cards || 0) >= 1, JSON.stringify(mv.bySrc['4KHDHub']));
check('movie: hdhub4u cards present', (mv.bySrc['HDHub4u']?.cards || 0) >= 1, JSON.stringify(mv.bySrc['HDHub4u']));
const k4card = mv.streams.find(s => (s.name || '').includes('4KHDHub'));
check('movie: 4khdhub card carries subs', k4card && Array.isArray(k4card.subtitles) && k4card.subtitles.length >= 20, k4card ? String(k4card.subtitles.length) : 'no card');
const h4card = mv.streams.find(s => (s.name || '').includes('HDHub4u'));
check('movie: hdhub4u card carries subs', h4card && Array.isArray(h4card.subtitles) && h4card.subtitles.length >= 20, h4card ? String(h4card.subtitles.length) : 'no card');
// zero html rule
const htmlCards = mv.streams.filter(s => (s.url || '').startsWith('http') && !s.url.includes('/proxy') && !s.url.includes('/range-proxy') && /\.html?($|\?)/i.test(s.url));
check('movie: zero .html URLs', htmlCards.length === 0);

// ── 2. Series (Breaking Bad S1E1) ──
const tv = analyze((await stream('series', 'tmdb:1396:1:1')).streams || [], 'BreakingBad S1E1');
check('series: >=15 cards cold', tv.streams.length >= 15, String(tv.streams.length));
check('series: >=60% cards carry subtitles', tv.withSubs.length >= tv.streams.length * 0.6, `${tv.withSubs.length}/${tv.streams.length}`);

// warm re-open (cache) — subs must persist
const tv2 = analyze((await stream('series', 'tmdb:1396:1:1')).streams || [], 'BreakingBad warm');
check('series warm: >=60 cards', tv2.streams.length >= 60, String(tv2.streams.length));
check('series warm: subtitles persist', tv2.withSubs.length >= tv2.streams.length * 0.6, `${tv2.withSubs.length}/${tv2.streams.length}`);

// ── 3. Anime (Frieren S1E1) — colon id format (the real Stremio route) ──
const an = analyze((await stream('series', 'tmdb:209867:1:1')).streams || [], 'Frieren S1E1 anime');
check('anime: >=20 cards', an.streams.length >= 20, String(an.streams.length));
check('anime: >=50% cards carry subtitles', an.withSubs.length >= an.streams.length * 0.5, `${an.withSubs.length}/${an.streams.length}`);

// ── 4. workers.dev cards ship direct+proxyHeaders (Task 49 routing) ──
const wdCards = mv.streams.filter(s => /(^|\.)workers\.dev$/i.test((s.url || '').replace(/^https?:\/\//, '').split('/')[0] || '') );
const wdBad = wdCards.filter(s => !s.behaviorHints?.proxyHeaders?.request);
console.log(`\nworkers.dev movie cards: ${wdCards.length}, without proxyHeaders: ${wdBad.length}`);
check('movie: workers.dev cards all direct+proxyHeaders', wdCards.length === 0 || wdBad.length === 0);

console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
