// Task 42: streamGate unit test — known-dead and known-alive targets
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const gate = require('/home/z/my-project/phoenix-analysis/src/utils/streamGate.cjs');

const CASES = [
  ['dead?', 'https://fetch.nexabloom.top/anime/bb6d2babd7797d94d8f4a8600bc9b44e/b7d51fb7e838ee9b60dcdb34b953bc07/master.m3u8', 'nexabloom CF-403 html'],
  ['dead?', 'https://nhdapi.com/anime/154587/1', 'nhdapi html page'],
  ['dead?', 'https://pixeldrain.com/api/file/mvJtJzLM?download', 'pixeldrain 4.9GB ZIP decoy'],
  ['alive?', 'https://pixeldrain.dev/api/file/H2jbwrgu?download', 'pixeldrain real mkv (Inception sweep sample)'],
];

for (const [expect, url, label] of CASES) {
  const t0 = Date.now();
  const v = await gate.probe(url);
  console.log(`${expect.padEnd(6)} -> ${v.padEnd(8)} (${Date.now() - t0}ms) ${label}`);
}

// gateHostOf unwrapping
const gh1 = gate.gateHostOf('https://ignatiusphoenix.onrender.com/proxy?url=https%3A%2F%2Fmoon.peakstorm.top%2Fr2%2Fcdn1%2FXYZ&referer=https%3A%2F%2Fvidking.net%2F');
const gh2 = gate.gateHostOf('https://pixeldrain.dev/api/file/H2jbwrgu?download');
console.log('gateHostOf proxied:', gh1, '| gated:', gate.isGatedHost(gh1));
console.log('gateHostOf direct :', gh2, '| gated:', gate.isGatedHost(gh2));
process.exit(0);
