#!/usr/bin/env node
/**
 * Task 52: deep playability verification of a reanime-proxy card on production.
 * Follows: card playlist -> audio/variant playlists -> segment bytes.
 */
const BASE = 'https://ignatiusphoenix.onrender.com';

async function main() {
  const probe = await fetch(`${BASE}/debug/source/reanime?type=series&id=tmdb:209867:1:1&full=1`);
  const data = await probe.json();
  const cardUrl = data.results?.[0]?.url;
  if (!cardUrl) { console.log('NO CARD'); return; }
  console.log('card:', cardUrl.slice(0, 90) + '...');

  const master = await (await fetch(cardUrl)).text();
  console.log('\n--- master playlist head ---');
  console.log(master.split('\n').slice(0, 4).join('\n'));

  // follow the first URI= (audio) and the first variant stream line
  const audioUri = master.match(/URI="([^"]+)"/)?.[1];
  const variantLine = master.split('\n').find(l => l.startsWith('https://') || (l && !l.startsWith('#') && l.trim()));
  console.log('\naudioUri:', audioUri?.slice(0, 80));
  console.log('variantLine:', variantLine?.slice(0, 80));

  if (audioUri) {
    const a = await (await fetch(audioUri)).text();
    console.log('\n--- audio playlist head ---');
    console.log(a.split('\n').slice(0, 4).join('\n'));
    const segLine = a.split('\n').find(l => l && !l.startsWith('#'));
    if (segLine) {
      console.log('\naudio segment:', segLine.slice(0, 90));
      const res = await fetch(segLine.trim());
      const buf = Buffer.from(await res.arrayBuffer());
      console.log(`segment HTTP ${res.status} bytes=${buf.length} head=${buf.slice(0, 4).toString('hex')}`);
      // XOR-decrypted segment should start with MPEG-TS sync byte 0x47
      console.log('TS sync byte check (0x47):', buf[0] === 0x47 ? 'PASS' : 'FAIL');
    }
  }

  if (variantLine) {
    const v = await (await fetch(variantLine.trim())).text();
    const segLine2 = v.split('\n').find(l => l && !l.startsWith('#'));
    if (segLine2) {
      console.log('\nvideo segment:', segLine2.slice(0, 90));
      const res2 = await fetch(segLine2.trim());
      const buf2 = Buffer.from(await res2.arrayBuffer());
      console.log(`segment HTTP ${res2.status} bytes=${buf2.length}`);
      console.log('TS sync byte check (0x47):', buf2[0] === 0x47 ? 'PASS' : 'FAIL head=' + buf2.slice(0, 4).toString('hex'));
    }
  }
}
main().catch(e => console.error('ERR', e.message));
