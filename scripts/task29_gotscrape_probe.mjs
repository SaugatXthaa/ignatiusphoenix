// task29_gotscrape_probe.cjs — test got-scraping fingerprints against animotvslash CF gate
import { gotScraping as got } from 'got-scraping';

const targets = [
  ['detail', 'https://animotvslash.org/anime/frieren-beyond-journeys-end-season-2/'],
  ['episode', 'https://animotvslash.org/frieren-beyond-journeys-end-season-2-episode-1/'],
];

const variants = [
  ['chrome-desktop', { headerGeneratorOptions: { browsers: [{ name: 'chrome' }], devices: ['desktop'], operatingSystems: ['windows'] } }],
  ['firefox-desktop', { headerGeneratorOptions: { browsers: [{ name: 'firefox' }], devices: ['desktop'], operatingSystems: ['windows'] } }],
  ['safari-mobile', { headerGeneratorOptions: { browsers: [{ name: 'safari' }], devices: ['mobile'], operatingSystems: ['ios'] } }],
];

for (const [label, url] of targets) {
  for (const [vname, opts] of variants) {
    try {
      const res = await got(url, {
        ...opts,
        timeout: { request: 15000 },
        throwHttpErrors: false,
        followRedirect: true,
        http2: true,
      });
      const body = res.body || '';
      const isChallenge = /just a moment|cf-challenge|challenge-platform|attention required/i.test(body);
      const hasSelect = body.includes('<select');
      const hasDataLink = (body.match(/data-link/g) || []).length;
      console.log(`${label} [${vname}]: ${res.statusCode} len=${body.length} challenge=${isChallenge} select=${hasSelect} dataLinks=${hasDataLink}`);
    } catch (e) {
      console.log(`${label} [${vname}]: THREW ${e.message.slice(0, 80)}`);
    }
  }
}
