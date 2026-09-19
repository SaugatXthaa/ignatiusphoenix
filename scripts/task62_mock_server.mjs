// Task 62 mock: Range-ignoring upstream + deep-seek proxy variants. Standalone long-running server.
import http from 'http';
import fs from 'fs';

const media = fs.readFileSync('/tmp/t62/test_padded.mkv');
const mediaSize = media.length;

// upstream: google-like (ignores Range, always 200 from byte 0)
const upstream = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'video/x-matroska', 'Content-Length': String(mediaSize) });
  res.end(media);
});
upstream.listen(47001);

function makeProxy(mode) {
  return http.createServer((req, res) => {
    const range = req.headers.range;
    let start = 0;
    if (range) { const m = String(range).match(/bytes=(\d*)-(\d*)/); if (m && m[1]) start = parseInt(m[1], 10); }
    console.log(`[${mode}] ${req.method} range=${range || '-'} -> ${start === 0 ? 'OPEN' : 'SEEK ' + start}`);
    const open = !range || start === 0;
    if (open) {
      res.writeHead(206, {
        'Content-Type': 'video/x-matroska',
        'Content-Length': String(mediaSize),
        'Content-Range': `bytes 0-${mediaSize - 1}/${mediaSize}`,
        'Accept-Ranges': 'bytes',
      });
      res.end(media);
      return;
    }
    if (mode === '416') { res.writeHead(416, { 'Content-Range': `bytes */${mediaSize}` }); return res.end(); }
    if (mode === '403') { res.writeHead(403); return res.end('no'); }
    if (mode === '502') { res.writeHead(502); return res.end('bad gateway'); }
    if (mode === '200') { res.writeHead(200, { 'Content-Type': 'video/x-matroska', 'Content-Length': String(mediaSize) }); return res.end(media); }
    if (mode === 'close') { res.destroy(); return; }
  });
}

const ports = { '416': 47101, '403': 47102, '502': 47103, '200': 47104, 'close': 47105 };
for (const [mode, port] of Object.entries(ports)) makeProxy(mode).listen(port);

console.log('mock up: upstream 47001, variants 47101-47105');
setInterval(() => {}, 60000);
