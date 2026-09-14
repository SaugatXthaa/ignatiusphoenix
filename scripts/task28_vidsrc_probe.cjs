// Task 28 — vidsrcme.ru ChaCha20-WASM decrypt probe (necro gap)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36';

async function j(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, accept: 'application/json', ...headers }, signal: AbortSignal.timeout(15000) });
  console.log('  GET', url.slice(0, 90), '->', res.status);
  if (!res.ok) return null;
  return res.json();
}

async function decryptStreamUrls(payload) {
  const enc = Buffer.from(payload.data.stream_urls, 'base64');
  const wasmBytes = Buffer.from(await (await fetch(payload.vs.wasm_url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) })).arrayBuffer());
  const mod = await WebAssembly.compile(wasmBytes);
  const inst = await WebAssembly.instantiate(mod, {});
  const ex = inst.exports;
  const ptr = ex.alloc(enc.length);
  new Uint8Array(ex.memory.buffer, ptr, enc.length).set(enc);
  const outLen = ex.decrypt(ptr, enc.length);
  return new TextDecoder().decode(new Uint8Array(ex.memory.buffer, ptr + 12, outLen));
}

(async () => {
  for (const [label, q] of [
    ['Endgame (movie)', 'type=movie&tmdb=299534'],
    ['AoT S1E1 (tv)', 'type=tv&tmdb=1429&season=1&episode=1'],
  ]) {
    console.log(`=== ${label} ===`);
    const data = await j(`https://data.vidsrcme.ru/api.php?${q}&stream_urls`);
    if (!data?.data?.stream_urls) { console.log('  no stream_urls'); continue; }
    if (typeof data.data.stream_urls !== 'string') {
      console.log('  PLAIN array:', JSON.stringify(data.data.stream_urls).slice(0, 300));
      continue;
    }
    const txt = await decryptStreamUrls(data);
    const urls = txt.split('\n').filter(Boolean);
    console.log('  decrypted URLs:', urls.length);
    for (const u of urls.slice(0, 6)) console.log('   ', u.slice(0, 110));
  }
  process.exit(0);
})();
