// Task 22: run the site's own obfuscated string decoder in a sandbox
const fs = require('fs');
const data = fs.readFileSync('/tmp/st_chunks/1uewwjxw3lxnk.js', 'utf8');
const start = data.indexOf('function u()');
const end = data.indexOf('A.s(["protectedPost",0,x]') + 30;
const snippet = data.slice(start, end);

const harness = `
let A = { s: function(){} };
${snippet}
const out = {};
for (let k = 426; k <= 464; k++) { try { out[k] = G(k); } catch (e) { out[k] = '<ERR>'; } }
console.log(JSON.stringify(out));
// also expose U internals: decode the field names used in the payload copy
const names = {
  copyField1: G(448) + G(433),
  copyField2: G(454),
  copyField3: null,
  headerName: G(434) + G(453),
  headerVal: G(435) + G(452) + G(431),
  method: G(443),
  retry1: G(445) + G(457) + G(439) + G(455) + G(436),
  retry2: G(442) + G(447) + G(464) + 'sy',
  errMsg1: G(446) + G(449) + G(441) + G(461),
};
console.log(JSON.stringify(names));
`;
fs.writeFileSync('/tmp/st_decode.js', harness);
console.log(require('child_process').execSync('node /tmp/st_decode.js').toString());
