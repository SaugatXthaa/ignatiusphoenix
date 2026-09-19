// Task 61 Phase 2: analyze collected cards — per-source attribution, zero-card
// follow-up via /debug/source, classify.
import fs from 'fs';
import https from 'https';

const OUT = '/home/z/my-project/phoenix-analysis/scripts/task61';
const BASE = 'https://ignatiusphoenix.onrender.com';

const ALL_SOURCES = ('4khdhub cinefreak moviebox cinewave watchseries necro vidsrcsbs vidlink2 vidking vidfast ' +
  'vegamovies primeshows netlio animeflix anineko verhdlink meinecloud acermovies streamxtv anikoto anikage anibd ' +
  '2dhive anidoor nowhdtime pantyflix animegg peckle hianime animekai cineby hindmoviez playimdb zxcstream ' +
  'animezey uhdmovies videasy anikototv animeworldindia animesdigital itachi imdbplay raflix hindmovie rivestream ' +
  'reanime desiflix persianstremio anichan animesuge animotvslash bollyflix fourkhdhubone framextv cinejoyaio ' +
  'nikastream cinebyrocks stellarrip stellar hdhub4uv2 movieshuntv2 moviesdrivev2 vegamovies2 cinehdplus vidzee ' +
  'vixsrc allwish videasyto kmmovies atlantic movielinkbd').split(/\s+/).filter(Boolean);

const groupRe = new RegExp(
  ALL_SOURCES.slice().sort((a, b) => b.length - a.length).join('|'), 'i');
const attr = (s) => {
  const g = (s.behaviorHints || {}).bingeGroup || '';
  const m = g.match(groupRe);
  if (m) return m[0].toLowerCase();
  const nm = ((s.name || '') + ' ' + (s.title || '')).toLowerCase();
  for (const id of ALL_SOURCES) if (nm.includes(id)) return id;
  return 'unknown';
};

const files = ['Inception', 'Obsession', 'GoTS1E1', 'SquidGameS1E1v2', 'FrierenS2E1'];
const perSource = {};
for (const id of ALL_SOURCES) perSource[id] = { perTitle: {}, total: 0, sample: null, has4k: false };
let unknown = 0;

for (const tl of files) {
  let cards;
  try { cards = JSON.parse(fs.readFileSync(`${OUT}/cards_${tl}.json`, 'utf8')); } catch { continue; }
  for (const s of cards) {
    const id = attr(s);
    if (id === 'unknown') { unknown++; continue; }
    if (!perSource[id]) perSource[id] = { perTitle: {}, total: 0, sample: null, has4k: false };
    perSource[id].perTitle[tl] = (perSource[id].perTitle[tl] || 0) + 1;
    perSource[id].total++;
    if (!perSource[id].sample) perSource[id].sample = { url: s.url, name: s.name, title: (s.title || '').slice(0, 60) };
    if (/2160|4k/i.test((s.name || '') + (s.title || ''))) perSource[id].has4k = true;
  }
}

console.log(`unknown-attribution cards: ${unknown}`);
console.log('\n=== PER-SOURCE COVERAGE (5 titles: Inception/Obsession/GoT/SquidGame/Frieren) ===');
const landers = [], zeros = [];
for (const id of ALL_SOURCES) {
  const m = perSource[id];
  const t = m.perTitle;
  const line = `${id.padEnd(16)} total=${String(m.total).padStart(3)}  Inc=${t.Inception || 0} Obs=${t.Obsession || 0} GoT=${t.GoTS1E1 || 0} SG=${t.SquidGameS1E1v2 || 0} Fri=${t.FrierenS2E1 || 0}${m.has4k ? '  [4K]' : ''}`;
  (m.total > 0 ? landers : zeros).push(line);
}
console.log('--- LANDING (' + landers.length + ') ---');
landers.forEach(l => console.log(l));
console.log('--- ZERO (' + zeros.length + ') ---');
zeros.forEach(l => console.log(l));

fs.writeFileSync(`${OUT}/matrix.json`, JSON.stringify(perSource, null, 1));
console.log(`\nsaved ${OUT}/matrix.json`);
