// Task 21: stage-by-stage probe for anichan + allwish (mimics wrapper logic)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const { gotScraping } = await import('got-scraping');
const tag = (s) => console.log(`[${new Date().toISOString().slice(11,19)}] ${s}`);

// ─────────────────────────── AniChan ───────────────────────────
const BASE = 'https://anichan.to';
let _acCookie = null, _acCookieExp = 0;

async function acCookie() {
  const now = Date.now() / 1000;
  if (_acCookie && now < _acCookieExp - 300) return _acCookie;
  const res = await gotScraping.post(`${BASE}/api/watch/session`, {
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: '' }),
    timeout: { request: 15000 }, throwHttpErrors: false, http2: false,
  });
  if (res.statusCode !== 200) { tag(`session FAIL ${res.statusCode}`); return null; }
  let scs = res.headers['set-cookie'] || [];
  if (typeof scs === 'string') scs = [scs];
  for (const sc of scs) {
    const m = String(sc).match(/anichan_ws=([^;]+)/);
    if (m) { _acCookie = m[1]; _acCookieExp = parseFloat(m[1]) || now + 7000; return _acCookie; }
  }
  return null;
}

async function acApi(path, anilistId = null) {
  const cookie = await acCookie();
  const res = await gotScraping.get(`${BASE}${path}`, {
    headers: {
      'User-Agent': UA, Accept: 'application/json',
      ...(anilistId && { Referer: `${BASE}/watch/${anilistId}`, 'X-Requested-With': 'XMLHttpRequest' }),
      ...(cookie && path.startsWith('/api/watch') && { Cookie: `anichan_ws=${cookie}` }),
    },
    timeout: { request: 15000 }, throwHttpErrors: false, followRedirect: true, http2: false,
  });
  if (res.statusCode !== 200) return { err: res.statusCode, body: String(res.body).slice(0, 80) };
  try { return { ok: JSON.parse(res.body) }; } catch { return { err: 'parse', body: '' }; }
}

async function probeAniChan(name) {
  tag(`── AniChan: "${name}" ──`);
  // AniList resolve
  const gql = `query($search:String){Page(page:1,perPage:5){media(type:ANIME,search:$search,sort:[SEARCH_MATCH,POPULARITY_DESC]){id title{romaji english} format}}}`;
  const ar = await gotScraping.post('https://graphql.anilist.co', {
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: gql, variables: { search: name } }),
    timeout: { request: 15000 }, throwHttpErrors: false, http2: false,
  }).catch(e => ({ statusCode: 0, body: String(e) }));
  tag(`anilist http=${ar.statusCode}`);
  let media = [];
  try { media = JSON.parse(ar.body)?.data?.Page?.media || []; } catch {}
  tag(`anilist hits: ${media.map(m => `${m.id}:${m.title?.english || m.title?.romaji}`).join(' | ') || 'NONE'}`);
  if (!media.length) return;
  const best = media[0];
  // episodes
  const ep = await acApi(`/api/watch/episodes?anilistId=${best.id}`, best.id);
  tag(`episodes: ${ep.err ? `ERR ${ep.err} ${ep.body}` : `eps=${ep.ok.episodes} dub=${ep.ok.dubAvailable}`}`);
  if (ep.err) return;
  // servers sub + dub with 3 retries each
  for (const type of ep.ok.dubAvailable ? ['sub', 'dub'] : ['sub']) {
    for (let i = 1; i <= 3; i++) {
      const s = await acApi(`/api/watch/servers?anilistId=${best.id}&episode=1&type=${type}`, best.id);
      if (s.ok?.servers?.length) {
        tag(`servers ${type} try${i}: OK ${s.ok.servers.length} stream=${String(s.ok.servers[0].stream).slice(0, 60)}`);
        break;
      }
      tag(`servers ${type} try${i}: ${s.err || 'no servers'}`);
      if (i < 3) await new Promise(r => setTimeout(r, 1000));
    }
  }
}

// ─────────────────────────── AllWish ───────────────────────────
const AW = 'https://all-wish.me';
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

async function probeAllWish(name) {
  tag(`── AllWish: "${name}" ──`);
  const queries = [name, name.normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
    name.replace(/[^a-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()]
    .filter((q, i, a) => q && a.indexOf(q) === i);
  for (const q of queries) {
    const res = await gotScraping.get(`${AW}/filter?keyword=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': UA, Referer: `${AW}/` },
      timeout: { request: 15000 }, throwHttpErrors: false, followRedirect: true,
    }).catch(e => null);
    if (!res || res.statusCode !== 200) { tag(`search "${q}": HTTP ${res?.statusCode ?? 'ERR'}`); continue; }
    // mimic wrapper: div.item cards
    const cards = [...String(res.body).matchAll(/<div class="item"[^>]*>[\s\S]*?<\/div>\s*<\/div>/g)];
    const hrefs = [...String(res.body).matchAll(/href="(\/watch\/[^"]+)"/g)].map(m => m[1]);
    tag(`search "${q}": 200, item-cards~${cards.length}, watch-hrefs=${[...new Set(hrefs)].slice(0, 3).join(', ')}${hrefs.length ? '' : ' (EMPTY)'}`);
    if (hrefs.length) {
      // score like the wrapper does (name from .name a)
      const nameNorm = norm(name);
      const items = [...String(res.body).matchAll(/<div class="item">[\s\S]*?<\/div>/g)].map(m => m[0]);
      let shown = 0;
      for (const it of items) {
        const nm = it.match(/class="name[^"]*"[^>]*>\s*<a[^>]*>([^<]+)<\/a>/);
        const jp = it.match(/data-jp="([^"]+)"/);
        const href = it.match(/href="(\/watch\/[^"]+)"/);
        if (nm && href && shown < 4) {
          const tn = norm(nm[1]), jn = norm(jp?.[1] || '');
          let score = 0;
          if (tn === nameNorm || jn === nameNorm) score = 100;
          else if (tn.includes(nameNorm) || nameNorm.includes(tn)) score = Math.min(tn.length, nameNorm.length) / Math.max(tn.length, nameNorm.length) * 90;
          else if (jn && (jn.includes(nameNorm) || nameNorm.includes(jn))) score = Math.min(jn.length, nameNorm.length) / Math.max(jn.length, nameNorm.length) * 90;
          tag(`  card "${nm[1]}" jp="${jp?.[1] || '-'}" score=${score.toFixed(1)} ${score >= 60 ? '✓MATCH' : '✗below-threshold'}`);
          shown++;
        }
      }
      return;
    }
  }
}

// run
const what = process.argv[2] || 'both';
if (what === 'anichan' || what === 'both') await probeAniChan('Attack on Titan');
if (what === 'allwish' || what === 'both') {
  await probeAllWish("Frieren: Beyond Journey's End");
  await probeAllWish('Naruto');
}
