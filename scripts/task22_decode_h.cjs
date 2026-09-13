// Task 22: decode the h() table (z strings) from the live bundle via sandbox
const fs = require('fs');
const data = fs.readFileSync('/tmp/st_chunks/1uewwjxw3lxnk.js', 'utf8');

// z table + h function live right after D(); extract from 'function z(){' to end of h()
const zStart = data.indexOf('function z(){', data.indexOf('async function D()'));
const hEnd = data.indexOf('async function q(', zStart);
const snippet = data.slice(zStart, hEnd);

// also need the rotation loop for z/h — find parseInt expression referencing h(...) between hEnd and q start? It's right after h definition.
// Extract the rotation loop that follows
const afterH = data.slice(hEnd, hEnd + 900);
const rotMatch = afterH.match(/for\(;;\)try\{if\(parseInt\(h\([^)]*\)\)[^;]+;h\.push\(h\.shift\(\)\)\}catch\(A\){h\.push\(h\.shift\(\)\)\}/);

const harness = `
let _t = ${JSON.stringify(null)};
${snippet}
${rotMatch ? rotMatch[0] : ''}
const out = {};
for (let k = 385; k <= 432; k++) { try { out[k] = h(k); } catch (e) { out[k] = '<ERR>'; } }
console.log(JSON.stringify(out));
`;
fs.writeFileSync('/tmp/st_h.js', harness);
console.log(require('child_process').execSync('node /tmp/st_h.js').toString());
