// Task 30 — necro E2E: decrypt /pl URLs -> mint generate.php token -> fetch stream
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const H = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' };

async function j(url) {
  const res = await fetch(url, { headers: { ...H, accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) { console.log('  api fail', res.status); return null; }
  return res.json();
}

async function decryptStreamUrls(payload) {
  const enc = Buffer.from(payload.data.stream_urls, 'base64');
  const wasmBytes = Buffer.from(await (await fetch(payload.vs.wasm_url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) })).arrayBuffer());
  const inst = await WebAssembly.instantiate(await WebAssembly.compile(wasmBytes), {});
  const ex = inst.exports;
  const ptr = ex.alloc(enc.length);
  new Uint8Array(ex.memory.buffer, ptr, enc.length).set(enc);
  const outLen = ex.decrypt(ptr, enc.length);
  return new TextDecoder().decode(new Uint8Array(ex.memory.buffer, ptr + 12, outLen)).split('\n').filter(Boolean);
}

async function tryHost(label, plUrl) {
  const origin = new URL(plUrl).origin;
  console.log(`\n=== ${label} ===`);
  console.log('  pl:', plUrl.slice(0, 70) + '...');
  // a) no token
  const r0 = await fetch(plUrl, { headers: H, redirect: 'manual', signal: AbortSignal.timeout(15000) }).catch(e => ({ status: 'THREW ' + e.message.slice(0, 40) }));
  console.log('  no-token  ->', r0.status);
  // b) mint token (same IP, immediately)
  const tRes = await fetch(origin + '/generate.php', { headers: { ...H, Referer: 'https://cloudorchestranova.com/' }, signal: AbortSignal.timeout(15000) }).catch(e => null);
  if (!tRes) { console.log('  generate.php THREW'); return; }
  const tText = await tRes.text();
  console.log('  generate  ->', tRes.status, 'body[:120]:', tText.slice(0, 120).replace(/\n/g, ' '));
  let token = '';
  try { const p = JSON.parse(tText); token = p.token || p.data || p.string || p.result || ''; } catch { token = tText.trim(); }
  if (!token) { console.log('  NO TOKEN minted'); return; }
  console.log('  token[:40]:', token.slice(0, 40));
  // c) fetch with token
  const sep = plUrl.includes('?') ? '&' : '?';
  const r1 = await fetch(plUrl + sep + 'token=' + encodeURIComponent(token), { headers: H, redirect: 'manual', signal: AbortSignal.timeout(15000) });
  const body = await r1.text();
  const magic = body.startsWith('#EXTM3U') ? 'HLS-M3U8' : body.slice(0, 60).replace(/\n/g, ' ');
  console.log('  with-token->', r1.status, 'ct=', r1.headers.get('content-type'), 'len=', body.length, 'magic=', magic, 'loc=', r1.headers.get('location') || '-');
  if (r1.status === 200 && body.startsWith('#EXTM3U')) {
    console.log('  >>> MASTER PLAYLIST (first 3 lines):');
    body.split('\n').slice(0, 6).forEach(l => console.log('   ', l.slice(0, 100)));
  }
}

(async () => {
  // fresh decrypt per host (hosts rotate per media)
  for (const [label, q] of [['Endgame (movie)', 'type=movie&tmdb=299534'], ['AoT S1E1 (tv)', 'type=tv&tmdb=1429&season=1&episode=1']]) {
    const data = await j(`https://data.vidsrcme.ru/api.php?${q}&stream_urls`);
    if (!data?.data?.stream_urls) continue;
    const urls = typeof data.data.stream_urls === 'string' ? await decryptStreamUrls(data) : data.data.stream_urls;
    console.log(`\n### ${label}: ${urls.length} pl urls`);
    if (urls[0]) await tryHost(label, urls[0]);
  }
})();
