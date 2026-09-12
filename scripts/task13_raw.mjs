// Dump RAW stream identity fields — no label guessing
const res = await fetch('http://127.0.0.1:4595/stream/movie/tt4154796.json');
const data = await res.json();
const streams = data.streams || [];
console.log(`total=${streams.length}`);
const ids = {};
for (const s of streams) {
  // collect every plausible identity field
  const sid = s.meta?.sourceId || s.id?.split(/[-_]/)[0] || '(no-id)';
  const name2 = (s.name || '').split('\n')[1] || s.name || '(no-name)';
  ids[sid] = ids[sid] || { n: 0, sample: name2 };
  ids[sid].n++;
}
console.log('--- by meta.sourceId / id-prefix ---');
for (const [k, v] of Object.entries(ids).sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${String(v.n).padStart(3)}  ${k.padEnd(18)}  ${String(v.sample).slice(0, 60)}`);
}
console.log('--- does any URL point to vidking backend? ---');
const vk = streams.filter(s => JSON.stringify(s).toLowerCase().includes('vidking'));
console.log(`streams mentioning vidking anywhere: ${vk.length}`);
if (vk.length) console.log('sample:', vk[0].name, '|', (vk[0].url || vk[0].externalUrl || '').slice(0, 100));
