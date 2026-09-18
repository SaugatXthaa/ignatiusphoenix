// Task 55 diagnostics — production probes for the four user-reported issues:
//   1. ZXCStream cards → mpv playback error (Doraemon)
//   2. 4khdhub not returning 4K (only 1080p)
//   3. Atlantic returning no streams
//   4. Atlantic subtitles not appearing on other sources' cards
const BASE = 'https://ignatiusphoenix.onrender.com';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function j(url, opts = {}, timeoutMs = 60000) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; }
  catch { return { status: res.status, data: text.slice(0, 500) }; }
}

const mode = process.argv[2] || 'all';

// ── 1. Atlantic on Inception (movie) + one series ──────────────────────────
if (mode === 'atlantic' || mode === 'all') {
  console.log('\n===== 1. ATLANTIC =====');
  for (const [label, type, id] of [
    ['Inception (movie)', 'movie', 'tmdb:27205'],
    ['GoT S1E1 (series)', 'series', 'tmdb:1399:1:1'],
  ]) {
    const r = await j(`${BASE}/debug/source/atlantic?type=${type}&id=${encodeURIComponent(id)}`, {}, 90000);
    const d = r.data || {};
    const streams = d.results || d.streams || [];
    const logs = d.logs || [];
    console.log(`\n--- ${label}: HTTP ${r.status} count=${d.count} timedOut=${d.timedOut} dur=${d.durationMs} err=${d.error||'-'}`);
    for (const l of logs.slice(-25)) console.log('  LOG:', typeof l === 'string' ? l.slice(0, 200) : JSON.stringify(l).slice(0, 200));
    for (const s of streams.slice(0, 5)) {
      console.log(`  CARD: ${String(s.name).slice(0, 70)} | ${String(s.title).slice(0, 60)} | subs=${(s.subtitles || []).length}`);
    }
  }
}

// ── 2. 4khdhub 4K check on Inception ───────────────────────────────────────
if (mode === 'fourk' || mode === 'all') {
  console.log('\n===== 2. 4KHDHUB 4K CHECK (Inception) =====');
  const r = await j(`${BASE}/debug/source/4khdhub?type=movie&id=tmdb:27205`, {}, 90000);
  const d = r.data || {};
  const streams = d.results || d.streams || [];
  console.log(`HTTP ${r.status} streams=${streams.length} timedOut=${d.timedOut}`);
  const q = {};
  for (const s of streams) {
    const m = /4K|2160p|1080p|720p|480p/.exec(String(s.name));
    const key = m ? m[0] : 'other';
    q[key] = (q[key] || 0) + 1;
  }
  console.log('quality histogram:', JSON.stringify(q));
  for (const s of streams.slice(0, 10)) console.log('  CARD:', String(s.name).slice(0, 90), '|', String(s.title).slice(0, 70));
  for (const l of (d.logs || []).slice(-15)) console.log('  LOG:', typeof l === 'string' ? l.slice(0, 200) : JSON.stringify(l).slice(0, 200));
}

// ── 3. ZXCStream Doraemon ──────────────────────────────────────────────────
if (mode === 'zxc' || mode === 'all') {
  console.log('\n===== 3. ZXCSTREAM Doraemon =====');
  // Find the TMDB id of the Doraemon movie the user means: search TMDB.
  const tmdb = await j('https://api.themoviedb.org/3/search/movie?query=' + encodeURIComponent('Stand by Me Doraemon') + '&api_key=439c478a771f35c05022f9feabcca01c');
  const hit = tmdb.data?.results?.[0];
  console.log('TMDB search:', hit ? `${hit.id} — ${hit.title} (${hit.release_date})` : 'none');
  const movieId = hit ? `tmdb:${hit.id}` : 'tmdb:402105';
  const r = await j(`${BASE}/debug/source/zxcstream?type=movie&id=${encodeURIComponent(movieId)}`, {}, 90000);
  const d = r.data || {};
  const streams = d.results || d.streams || [];
  console.log(`HTTP ${r.status} streams=${streams.length} timedOut=${d.timedOut}`);
  for (const s of streams) {
    const url = String(s.url || s.externalUrl || '');
    console.log(`  CARD: ${String(s.name).slice(0, 60)} | url=${url.slice(0, 110)}`);
  }
  for (const l of (d.logs || []).slice(-12)) console.log('  LOG:', typeof l === 'string' ? l.slice(0, 180) : JSON.stringify(l).slice(0, 180));
}

// ── 4. Subtitles on other sources' cards ───────────────────────────────────
if (mode === 'subs' || mode === 'all') {
  console.log('\n===== 4. SUBTITLES ON NON-ATLANTIC CARDS (Inception full resolve) =====');
  const r = await j(`${BASE}/stream/movie/tmdb:27205.json`, {}, 90000);
  const streams = r.data?.streams || [];
  console.log(`HTTP ${r.status} total streams=${streams.length}`);
  const withSubs = streams.filter(s => Array.isArray(s.subtitles) && s.subtitles.length > 0);
  console.log(`cards WITH subtitles: ${withSubs.length}/${streams.length}`);
  if (withSubs.length > 0) {
    const sample = withSubs[0];
    console.log('sample card:', String(sample.name).slice(0, 80));
    console.log('sample sub langs:', sample.subtitles.slice(0, 12).map(s => s.lang).join(', '));
    const perSource = {};
    for (const s of streams) {
      const src = /PhoeniX · ([^·]+)/.exec(String(s.name))?.[1] || String(s.name).split('·')[1]?.trim() || '?';
      perSource[src] = perSource[src] || { total: 0, subs: 0 };
      perSource[src].total++;
      if (Array.isArray(s.subtitles) && s.subtitles.length) perSource[src].subs++;
    }
    console.log('per-source subs coverage:', JSON.stringify(perSource, null, 1));
  }
}

console.log('\nDONE');
