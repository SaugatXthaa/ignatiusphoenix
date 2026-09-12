// task12_vcloud_probe.mjs — resolve vcloud.fit with got-scraping
import { gotScraping } from 'got-scraping';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function fetchGS(url, referer) {
  const res = await gotScraping({
    url, headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*', ...(referer ? { Referer: referer } : {}) },
    timeout: { request: 20000 }, retry: { limit: 1 },
  });
  return { status: res.statusCode, body: typeof res.body === 'string' ? res.body : res.body.toString() };
}

// vcloud IDs from the Endgame abhilinks page, one per quality band
const probes = [
  ['480p', 'https://vcloud.fit/sepiqm8zv2v7z7y'],
  ['1080p', 'https://vcloud.fit/grr12biuhoue1m_'],
  ['2160p-4K-HDR', 'https://vcloud.fit/bycxgtppyxcefne'],
  ['2160p-UHD-BDRip-25GB', 'https://vcloud.fit/x1xuuggxxe5fwqx'],
];

for (const [q, url] of probes) {
  try {
    const { status, body } = await fetchGS(url, 'https://abhilinks.site/');
    console.log(`\n===== ${q} ${url} → ${status}, size ${body.length}`);
    // interesting outbound targets
    const links = [...body.matchAll(/(?:href="([^"]+)"|var\s+url\s*=\s*'([^']+)'|var\s+url\s*=\s*"([^"]+)")/g)]
      .map(x => x[1] || x[2] || x[3])
      .filter(u => /drive\.google|googleusercontent|pixeldrain|workers\.dev|hubcloud|gamerxyt|dl\.php|indexserver|cloudflarestorage|r2\.dev|gofile|dropbox|1fichier/.test(u));
    [...new Set(links)].slice(0, 8).forEach(l => console.log('   LINK:', l.slice(0, 110)));
    const text = body.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    console.log('   PAGE:', text.slice(0, 400));
  } catch (e) {
    console.log(`\n===== ${q} ${url} → ERROR ${e.message?.slice(0, 100)}`);
  }
}
