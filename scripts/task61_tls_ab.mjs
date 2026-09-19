// Task 61: test vixsrc/animeflix/anikage play-time URLs with browser TLS vs
// plain fetch to determine whether CF challenges plain players.
import { gotScraping } from 'got-scraping';

const test = async (label, url, headers = {}) => {
  // browser TLS
  try {
    const r = await gotScraping(url, { headers, timeout: { request: 15000 }, throwHttpErrors: false, followRedirect: true });
    const head = String(r.body || '').slice(0, 60).replace(/\n/g, '|');
    console.log(`${label} [got-scraping] status=${r.statusCode} len=${(r.body || '').length} head=${head}`);
  } catch (e) { console.log(`${label} [got-scraping] ERR ${String(e).slice(0, 80)}`); }
  // plain fetch (what mpv/simple players do)
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    const t = await r.text();
    console.log(`${label} [plain-fetch ] status=${r.status} len=${t.length} head=${t.slice(0, 60).replace(/\n/g, '|')}`);
  } catch (e) { console.log(`${label} [plain-fetch ] ERR ${String(e).slice(0, 80)}`); }
};

await test('vixsrc  playlist', 'https://vixsrc.to/api/playlist/27205?token=', { Referer: 'https://vixsrc.to/', Origin: 'https://vixsrc.to' });
await test('vixsrc  root    ', 'https://vixsrc.to/', {});
await test('nexablo megaplay', 'https://fetch.nexabloom.top/anime/806c0bf65a5cc8e89564ac7391bb3f76/346cbee2477523f137903152be5727d4/master.m3u8', { Referer: 'https://megaplay.buzz/' });
await test('anicore prox    ', 'https://prox.anicore.tv/m3u8/DB5BNEcPGmMcCUYvI2Q2IAwn', {});
await test('hindmov workers ', 'https://gdtwo.gdtwo.workers.dev/d/vu1RXiVW2ksWHPCfUX5Nl6mGx7UT0J8B9tui365qaPPaGXQWzM9zqsllUrOuSqZktuGfffe6g1hJ', { Referer: 'https://hubcloud.cx/' });
