// Task 49: live production diagnosis — 4khdhub refresh loop + hdhub4u playback
// Tests:
//   1. /debug/source/4khdhub  (isolated, fresh title) — count + timing
//   2. re-run same title immediately — is it cache-hit (fast) or cold again?
//   3. /debug/source/hdhub4uv2 — count + timing
//   4. probe hdhub4u card URLs for playability (200/206 vs 403/404/5xx)
//   5. probe 4khdhub card URLs likewise
import { execSync } from 'child_process';

const BASE = 'https://ignatiusphoenix.onrender.com';
// Breaking Bad S1E1 (series, multi-hop chain) + Inception (movie)
const TITLE = process.argv[2] || 'tmdb:1396';
const TYPE = process.argv[3] || 'series';
const S = TYPE === 'series' ? '1' : '';
const E = TYPE === 'series' ? '1' : '';

async function jget(url, timeoutMs = 60000) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    let j = null;
    try { j = JSON.parse(text); } catch {}
    return { status: res.status, ms: Date.now() - t0, json: j, text: text.slice(0, 400) };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, error: e?.message || String(e) };
  }
}

const q = `type=${TYPE}&id=${TITLE}${S ? `&season=${S}&episode=${E}` : ''}`;

console.log('=== PASS 1: 4khdhub isolated (cold?) ===');
const p1 = await jget(`${BASE}/debug/source/4khdhub?${q}`);
console.log(JSON.stringify(p1.json ? {
  status: p1.status, ms: p1.ms, count: p1.json.count,
  logs: (p1.json.logs || []).slice(-6),
} : p1, null, 1).slice(0, 1600));

console.log('=== PASS 2: 4khdhub again immediately (cache-hit should be <2s) ===');
const p2 = await jget(`${BASE}/debug/source/4khdhub?${q}`);
console.log(JSON.stringify(p2.json ? {
  status: p2.status, ms: p2.ms, count: p2.json.count,
  logs: (p2.json.logs || []).slice(-4),
} : p2, null, 1).slice(0, 1200));

console.log('=== PASS 3: hdhub4uv2 isolated ===');
const p3 = await jget(`${BASE}/debug/source/hdhub4uv2?${q}`);
console.log(JSON.stringify(p3.json ? {
  status: p3.status, ms: p3.ms, count: p3.json.count,
  logs: (p3.json.logs || []).slice(-6),
} : p3, null, 1).slice(0, 1600));

// Collect card URLs for both sources via the real /stream endpoint
console.log('=== PASS 4: real /stream — collect 4khdhub + hdhub4u card URLs ===');
const st = await jget(`${BASE}/stream/${TYPE}/${TITLE.replace('tmdb:', '')}.json${S ? `?season=${S}&episode=${E}` : ''}`, 60000);
const streams = st.json?.streams || [];
console.log(`total streams: ${streams.length} (HTTP ${st.status}, ${st.ms}ms)`);
const pick = (re) => streams.filter(s => re.test(s.name || ''));
const k4 = pick(/4KHDHub/i).slice(0, 3);
const h4 = pick(/HDHub4u/i).slice(0, 3);
console.log(`4khdhub cards: ${pick(/4KHDHub/i).length}, hdhub4u cards: ${pick(/HDHub4u/i).length}`);

async function probeCard(s, tag) {
  const url = s.url || s.externalUrl;
  if (!url) return console.log(`${tag}: NO URL`, JSON.stringify(s).slice(0, 120));
  const abs = url.startsWith('/') ? BASE + url : url;
  const r = await jget(abs, 25000);
  const ct = (r.json ? 'JSON' : (r.text || '').slice(0, 60).replace(/\n/g, ' '));
  console.log(`${tag}: HTTP ${r.status} @${r.ms}ms ${(r.json && r.json.headers ? JSON.stringify(r.json.headers).slice(0, 80) : ct).slice(0, 110)}`);
  console.log(`   url: ${abs.slice(0, 160)}`);
}
for (const [i, s] of k4.entries()) await probeCard(s, `4khdhub card ${i + 1}`);
for (const [i, s] of h4.entries()) await probeCard(s, `hdhub4u card ${i + 1}`);
