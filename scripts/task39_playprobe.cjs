// Task 39 playability probes
(async () => {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  // 1. r2.dev direct probe
  try {
    const r = await fetch('https://pub-f4ba9fb2017042968ec12c06f4b42344.r2.dev/ef64eb995a17cbc59055b78e27055229', { headers: { 'User-Agent': UA, Range: 'bytes=0-15' }, signal: AbortSignal.timeout(12000), redirect: 'follow' });
    const buf = Buffer.from(await r.arrayBuffer());
    console.log('r2.dev:', r.status, r.headers.get('content-type'), r.headers.get('content-range') || r.headers.get('content-length'), 'magic:', buf.slice(0, 4).toString('hex'));
  } catch (e) { console.log('r2.dev probe ERR:', e.message.slice(0, 60)); }
  // 2. hblinks page — confirm hub links inside (HBLinks extractor resolves at play)
  const gsMod = await import('got-scraping');
  const gs = gsMod.gotScraping || gsMod.default;
  try {
    const res = await gs({ url: 'https://hblinks.co/archives/115065', headers: { 'User-Agent': UA }, timeout: { request: 12000 } });
    const html = typeof res.body === 'string' ? res.body : res.body.toString();
    const hubRe = /https:\/\/(hubcloud|hubdrive|hubcdn|gdflix)[a-z0-9.-]*[^\s"'<>)]*/gi;
    const hub = [...new Set([...html.matchAll(hubRe)].map(m => m[0]))].slice(0, 5);
    console.log('hblinks 115065 status:', res.statusCode, 'hub targets:', hub.length ? hub : '(none)');
  } catch (e) { console.log('hblinks probe ERR:', e.message.slice(0, 60)); }
})();
