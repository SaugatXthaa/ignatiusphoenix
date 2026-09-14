// Task 27 — walk the animesuge -> megaplay chain step by step
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const AS_API = 'https://animesuge.at/api/animesuge';
const MEGAPLAY = 'https://megaplay.buzz';

async function j(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', ...headers } });
  console.log(`  GET ${url.slice(0, 110)} -> ${res.status}`);
  if (!res.ok) return null;
  return res.json();
}
async function t(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
  console.log(`  GET ${url.slice(0, 110)} -> ${res.status} (${(await res.clone().text()).length}B)`);
  if (!res.ok) return '';
  return res.text();
}

(async () => {
  // 1. server list for AoT id=1648 ep=1
  const data = await j(`${AS_API}/server/list?id=1648&episode=1`);
  const html = data?.result || '';
  const matches = [...html.matchAll(/data-type="([^"]+)"[\s\S]*?data-link="([^"]+)"[\s\S]*?data-sv-id="([^"]+)"/g)];
  const servers = matches.map(m => ({ type: m[1], link: Buffer.from(m[2], 'base64').toString('utf-8'), svId: m[3] }));
  console.log('servers:', JSON.stringify(servers, null, 1).slice(0, 800));

  if (!servers.length) { console.log('NO SERVERS'); process.exit(0); }

  // 2. walk first 2 server links through megaplay
  for (const s of servers.slice(0, 2)) {
    console.log(`\n--- ${s.type} sv=${s.svId}: ${s.link}`);
    const page = await t(s.link, { Referer: 'https://animesuge.at/' });
    if (!page) { console.log('  page fetch FAILED/empty'); continue; }
    const idm = page.match(/data-id="(\d+)"/);
    console.log('  data-id:', idm ? idm[1] : 'NOT FOUND');
    // dump a hint of what the page is
    const tmatch = page.match(/<title>([^<]*)<\/title>/);
    console.log('  page <title>:', tmatch ? tmatch[1].slice(0, 100) : '(none)');
    if (!idm) continue;
    const api = `${MEGAPLAY}/stream/getSourcesNew?id=${idm[1]}`;
    const src = await j(api, { Referer: s.link });
    if (!src) { console.log('  getSourcesNew FAILED'); continue; }
    console.log('  sources keys:', Object.keys(src).slice(0, 8).join(','));
    console.log('  sources.file:', String(src?.sources?.file || '(none)').slice(0, 120));
    console.log('  tracks:', Array.isArray(src?.tracks) ? src.tracks.length : typeof src?.tracks);
  }
  process.exit(0);
})();
