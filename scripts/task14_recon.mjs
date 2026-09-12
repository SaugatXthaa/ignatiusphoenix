// Task 14 recon: raflix API embeds + zxcstream sentinel + netlio URL shapes
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ─── 1. Raflix API: what are the 8 embed URLs for Endgame? ───
console.log('===== RAFlix API (Endgame) =====');
try {
  const r = await fetch('https://raflixx.vercel.app/api/media/sources?type=movie&tmdbId=299534', {
    headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000),
  });
  const d = await r.json();
  for (const s of (d?.sources || [])) console.log(`  [${s.label}] kind=${s.kind} ${String(s.url).slice(0, 110)}`);
} catch (e) { console.log('  API FAIL:', e.message); }

// ─── 2. zxcstream sentinel: does it return data.embed from this server? ───
console.log('\n===== zxcstream sentinel =====');
const crypto = await import('crypto');
try {
  const zm = await import('/home/z/my-project/phoenix-analysis/src/nuvio/zxcstream.cjs');
  const streams = await zm.getStreams(299534, 'movie', null, null);
  console.log('  provider returned', streams.length, 'streams');
  for (const s of streams) console.log(`   -> ${s.name}: ${String(s.url).slice(0, 100)}`);
} catch (e) { console.log('  provider FAIL:', e.message); }

// ─── 3. Netlio source: real URL shapes ───
console.log('\n===== Netlio source URLs =====');
try {
  const { createSources } = await import('/home/z/my-project/phoenix-analysis/src/source/index.js');
  const mock = { json: async () => ({}), head: async () => { throw new Error('x'); } };
  const netlio = createSources(mock).find(s => s.id === 'netlio');
  if (netlio) {
    const res = await netlio.handle({ config: {}, hostUrl: new URL('http://127.0.0.1:4595') }, 'movie', { id: 'tt4154796' }).catch(e => { console.log('  netlio handle err:', e.message); return []; });
    for (const r of (res || []).slice(0, 5)) console.log(`  ${String(r.url?.href || r.url).slice(0, 130)}`);
    console.log('  (total', (res || []).length, ')');
  }
} catch (e) { console.log('  FAIL:', e.message); }
