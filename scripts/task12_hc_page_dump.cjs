// task12_hc_page_dump.cjs — dump the 1080p file page + gamerxyt bridge for MoviesDrive Endgame
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HUBCLOUD_BASE = 'https://hubcloud.cx';

async function fetchText(url, referer) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*', ...(referer ? { Referer: referer } : {}) }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
}

async function main() {
  const page = await fetchText('https://new3.moviesdrive.christmas/avengers-endgame-2019-dual-audio-hindi-english-480p-500mb-720p-1-7gb-1080p-4-3gb-2160p-4k/', 'https://new3.moviesdrive.christmas/');
  const linkMatch = page.match(/href="(https:\/\/hubcloud\.[a-z]+\/drive\/search-recover\.php\?from_ac=[A-Za-z0-9_-]+)/);
  const tokenPage = await fetchText(linkMatch[1].replace('hubcloud.foo', 'hubcloud.cx'), 'https://new3.moviesdrive.christmas/');
  const token = tokenPage.match(/FROM_AC_TOKEN\s*=\s*"([^"]+)"/)?.[1];

  const qEnc = encodeURIComponent('Avengers: Endgame 1080p');
  const apiUrl = `${HUBCLOUD_BASE}/drive/search-recover.php?api=search&q=${qEnc}&page=1&from_ac=${token}`;
  const res = await fetch(apiUrl, { headers: { 'User-Agent': UA, Referer: `${HUBCLOUD_BASE}/drive/search-recover.php?from_ac=${token}` }, signal: AbortSignal.timeout(15000) });
  const data = await res.json();
  const hits = data.hits || [];
  console.log('hits:', hits.length);
  const h = hits[0];
  console.log('file:', h.file_name, '| url:', h.url);
  const fileId = h.url.match(/\/drive\/([A-Za-z0-9_]+)/)?.[1];
  console.log('fileId:', fileId);

  const fileHtml = await fetchText(`${HUBCLOUD_BASE}/drive/${fileId}`, HUBCLOUD_BASE + '/');
  console.log('\n=== var url matches ===');
  console.log((fileHtml.match(/var\s+url\s*=\s*'[^']*'/g) || []).slice(0, 3));
  console.log('=== gamerxyt href matches ===');
  console.log((fileHtml.match(/href="https:\/\/gamerxyt\.com\/hubcloud\.php\?[^"]+"/g) || []).slice(0, 3));
  console.log('=== pixeldrain matches ===');
  console.log((fileHtml.match(/https:\/\/pixeldrain\.[a-z]+\/(u|api\/file)\/[A-Za-z0-9]+/g) || []).slice(0, 5));
  console.log('=== JS-set href (getElementById) ===');
  console.log((fileHtml.match(/getElementById\([^)]+\)\.href\s*=\s*'[^']+'|getElementById\([^)]+\)\.href\s*=\s*"[^"]+"/g) || []).slice(0, 8));
  console.log('=== any googleusercontent/workers on page ===');
  console.log([...new Set(fileHtml.match(/https:\/\/[a-z0-9.-]*(googleusercontent|workers\.dev)[^\s"'<>]*/g) || [])].slice(0, 5));
  console.log('=== pixel refs ===');
  console.log([...new Set(fileHtml.match(/https:\/\/(pixel|gpdl)\.hubcloud[^"'\s<>]*/g) || [])].slice(0, 5));
  console.log('=== button/anchor summary (first 12 anchors) ===');
  const anchors = [...fileHtml.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]{0,80}?)<\/a>/g)].map(x => ({ href: x[1], txt: x[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }));
  anchors.slice(0, 12).forEach(a => console.log(`  [${a.txt.slice(0, 30)}] ${a.href.slice(0, 100)}`));
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
