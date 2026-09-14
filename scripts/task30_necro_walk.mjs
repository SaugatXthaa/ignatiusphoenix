// Task 30 — necro gap follow-up: full vidsrcme.ru chain walk in one fast pass
// Chain: vidsrc.me -> vidsrcme.ru/vs_src.php -> cloudorchestranova embed ->
//        CFG.playerUrl -> player page -> generate.php token -> /pl stream URLs
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const H = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' };

async function g(url, referer, out = 'text') {
  const res = await fetch(url, { headers: { ...H, ...(referer ? { Referer: referer } : {}), ...(out === 'json' ? { Accept: 'application/json' } : {}) }, redirect: 'manual', signal: AbortSignal.timeout(20000) });
  const loc = res.headers.get('location') || '';
  const body = out === 'bin' ? Buffer.from(await res.arrayBuffer()) : await res.text();
  return { status: res.status, loc, body };
}

(async () => {
  const t0 = Date.now();
  // 1) embed page -> vs_src.php
  const e1 = await g('https://vidsrcme.ru/embed/movie?tmdb=299534', 'https://necro.pages.dev/');
  const vsSrcMatch = e1.body.match(/data-api="([^"]+)"/) || e1.body.match(/(\/vs_src\.php\?[^"]+)/);
  if (!vsSrcMatch) { console.log('FAIL: no vs_src on embed page'); return; }
  const vsSrcUrl = new URL(vsSrcMatch[1].replace(/&amp;/g, '&'), 'https://vidsrcme.ru').href;
  const s1 = await g(vsSrcUrl, 'https://vidsrcme.ru/embed/movie?tmdb=299534', 'json');
  const src1 = JSON.parse(s1.body).src;
  console.log(`[${Date.now() - t0}ms] hop1 src:`, src1.slice(0, 80));

  // 2) cloudorchestranova embed -> CFG.playerUrl
  const s2 = await g(src1, 'https://vidsrcme.ru/');
  const cfg = s2.body.match(/playerUrl"\s*:\s*"([^"]+)"/) || s2.body.match(/playerUrl\s*=\s*'([^']+)'/);
  if (!cfg) { console.log('FAIL: no CFG.playerUrl'); console.log(s2.body.slice(0, 300)); return; }
  const playerUrl = new URL(cfg[1], src1).href;
  console.log(`[${Date.now() - t0}ms] hop2 playerUrl:`, playerUrl.slice(0, 80));

  // 3) player page IMMEDIATELY
  const s3 = await g(playerUrl, src1);
  if (s3.status !== 200) { console.log('player page status', s3.status, s3.body.slice(0, 150)); return; }
  console.log(`[${Date.now() - t0}ms] player page ${s3.body.length}B`);
  // extract generate.php call + /pl host + any token flow
  const gen = s3.body.match(/["']([^"']*generate\.php[^"']*)["']/);
  const plHosts = [...s3.body.matchAll(/https?:\/\/[a-z0-9.-]+\/pl\//g)].map(m => m[0]);
  console.log('generate.php ref:', gen ? gen[1].slice(0, 100) : '(none)');
  console.log('/pl hosts in page:', [...new Set(plHosts)].slice(0, 3));
  // dump JS asset list for the next layer
  const scripts = [...s3.body.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m => m[1]);
  console.log('player scripts:', scripts.slice(0, 5));
  for (const [i, sc] of scripts.slice(0, 3).entries()) {
    const u = new URL(sc, playerUrl).href;
    const r = await g(u, playerUrl);
    const gen2 = r.body.match(/["']([^"']*generate\.php[^"']*)["']/);
    const fetches = [...new Set([...r.body.matchAll(/["'](\/[a-z_\/]+\.php[^"']{0,40})["']/g)].map(m => m[1]))];
    console.log(` script#${i} ${u.slice(u.lastIndexOf('/') + 1, u.lastIndexOf('/') + 30)} ${r.body.length}B gen=${gen2 ? gen2[1].slice(0, 80) : '-'} phpCalls=${fetches.slice(0, 4)}`);
  }
  // 4) if generate.php found anywhere, request a token NOW and try /pl
  const genAll = (s3.body + '').match(/["']([^"']*generate\.php[^"']*)["']/);
  if (genAll) {
    const genUrl = new URL(genAll[1], playerUrl).href;
    const tok = await g(genUrl, playerUrl, 'json');
    console.log(`[${Date.now() - t0}ms] token resp status=${tok.status} body=`, String(tok.body).slice(0, 300));
  }
})();
