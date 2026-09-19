// Task 62 v2: build a large valid MKV — rebuilt SeekHead (5-byte positions),
// Void insertion before clusters, Segment size rewrite.
import fs from 'fs';

const src = fs.readFileSync('/tmp/t62/test.mkv');
const VOID_SIZE = 60 * 1048576;

function readVint(buf, off, keepMarker = false) {
  const first = buf[off];
  let len = 1;
  if (first >= 0x80) len = 1;
  else if (first >= 0x40) len = 2;
  else if (first >= 0x20) len = 3;
  else if (first >= 0x10) len = 4;
  else if (first >= 0x08) len = 5;
  else if (first >= 0x04) len = 6;
  else if (first >= 0x02) len = 7;
  else if (first === 0x01) len = 8;
  else throw new Error(`bad vint at ${off}: ${first.toString(16)}`);
  let value = 0n;
  for (let i = 0; i < len; i++) value = value * 256n + BigInt(buf[off + i]);
  if (!keepMarker) value -= 2n ** (7n * BigInt(len));
  return { value: Number(value), length: len };
}
function encodeSizeVint(value, fixedLen = null) {
  let len = fixedLen || 1;
  const limits = [0x7f, 0x3fff, 0x1fffff, 0x0fffffff, 0x7ffffffff, 0x3ffffffffff, 0x1ffffffffffff];
  while (!fixedLen && len < 8 && value > limits[len - 1]) len++;
  while (fixedLen && len < 8 && value > limits[len - 1]) len++;
  const out = Buffer.alloc(len);
  let v = BigInt(value);
  for (let i = len - 1; i >= 1; i--) { out[i] = Number(v & 0xffn); v >>= 8n; }
  out[0] = Number(v) | (0x80 >> (len - 1));
  return out;
}

// --- top-level parse ---
let off = 0;
const elements = [];
while (off < src.length) {
  const id = readVint(src, off, true);
  const size = readVint(src, off + id.length);
  const header = id.length + size.length;
  elements.push({ id: id.value, idLen: id.length, sizeLen: size.length, dataOff: off + header, dataSize: size.value, totalOff: off, totalLen: header + size.value });
  off += header + size.value;
}
const seg = elements[1];
if (seg.id !== 0x18538067) throw new Error('no segment');
const segEndAbs = seg.dataOff + seg.dataSize >= src.length ? src.length : seg.dataOff + seg.dataSize;
const segKnownSize = seg.dataSize;

// --- children ---
const children = [];
let c = seg.dataOff;
while (c < segEndAbs) {
  const id = readVint(src, c, true);
  const size = readVint(src, c + id.length);
  children.push({ id: id.value, offInSeg: c - seg.dataOff, headerLen: id.length + size.length, dataSize: size.value, absOff: c });
  c += id.length + size.length + size.value;
}
const seekHead = children.find(e => e.id === 0x114d9b74);
const firstCluster = children.find(e => e.id === 0x1f43b675);
const insertAt = firstCluster.offInSeg; // in OLD segment coordinates
console.log(`seekhead @${seekHead.offInSeg} (${seekHead.dataSize}b), first cluster @${insertAt}, void=${VOID_SIZE}`);

// --- rebuild SeekHead with fixed-width (5-byte) SeekPosition vints ---
const shDataOff = seekHead.absOff + seekHead.headerLen;
const shData = src.slice(shDataOff, shDataOff + seekHead.dataSize);
const entries = [];
let p = 0;
while (p < shData.length) {
  const id = readVint(shData, p, true); const sz = readVint(shData, p + id.length);
  const elLen = id.length + sz.length + sz.value;
  if (id.value === 0x4dbb) {
    let q = p + id.length + sz.length;
    let seekIdEl = null, posVal = null;
    while (q < p + elLen) {
      const id2 = readVint(shData, q, true); const sz2 = readVint(shData, q + id2.length);
      const h2 = id2.length + sz2.length;
      const data2 = shData.slice(q + h2, q + h2 + sz2.value);
      if (id2.value === 0x53ab) seekIdEl = shData.slice(q, q + h2 + sz2.value);
      if (id2.value === 0x53ac) posVal = Number(data2.readBigUInt64BE ? 0n : 0n) || parseInt(data2.toString('hex') || '0', 16);
      q += h2 + sz2.value;
    }
    entries.push({ seekIdEl, posVal });
  }
  p += elLen;
}
console.log('seek entries:', entries.map(e => `${e.seekIdEl ? e.seekIdEl.slice(2).toString('hex') : '?'}@${e.posVal}`).join(' '));

const POS_WIDTH = 4;
// shDelta = growth of the SeekHead element itself (id+size+data) — everything after it shifts
function buildSeekHead(posTransform) {
  const parts = [Buffer.from([0x4d, 0xbb])]; // Seek entry ID (2 bytes)
  const entryParts = [];
  for (const e of entries) {
    // SeekPosition element = ID(53 ac) + size-vint(W) + W-byte big-endian value
    const newPos = BigInt(posTransform(e.posVal));
    const posData = Buffer.alloc(POS_WIDTH);
    let v = newPos;
    for (let i = POS_WIDTH - 1; i >= 0; i--) { posData[i] = Number(v & 0xffn); v >>= 8n; }
    const posEl = Buffer.concat([Buffer.from([0x53, 0xac]), encodeSizeVint(POS_WIDTH), posData]);
    const data = Buffer.concat([e.seekIdEl, posEl]);
    entryParts.push(Buffer.concat([Buffer.from([0x4d, 0xbb]), encodeSizeVint(data.length), data]));
  }
  const body = Buffer.concat(entryParts);
  // CRC-32 element (bf 84 + 4 bytes) — copy verbatim from original (offset invalid now but CRC optional; drop it)
  const head = Buffer.from([0x11, 0x4d, 0x9b, 0x74]);
  const sizeBuf = encodeSizeVint(body.length);
  return Buffer.concat([head, sizeBuf, body]);
}

// two-pass: SeekHead is the first child, so its own size change (shDelta) shifts
// every other element — the position transform must include it.
const oldSeekHeadLen = seekHead.headerLen + seekHead.dataSize;
let newSeekHead = buildSeekHead(pos => pos); // pass 1: measure length
const shDelta = newSeekHead.length - oldSeekHeadLen;
newSeekHead = buildSeekHead(pos => pos + shDelta + (pos >= insertAt ? VOID_SIZE : 0));
console.log(`new seekhead ${newSeekHead.length}b (delta ${shDelta})`);

// --- assemble ---
const voidSizeBuf = encodeSizeVint(VOID_SIZE);
const voidEl = Buffer.concat([Buffer.from([0xec]), voidSizeBuf, Buffer.alloc(VOID_SIZE)]);
const beforeInsert = src.slice(seg.dataOff + seekHead.headerLen + seekHead.dataSize, seg.dataOff + insertAt);
const afterInsert = src.slice(seg.dataOff + insertAt);

const bodyLen = newSeekHead.length + beforeInsert.length + voidEl.length + afterInsert.length;
const segSizeVint = encodeSizeVint(bodyLen, seg.sizeLen); // same 8-byte width
if (segSizeVint.length !== seg.sizeLen) throw new Error('segment size vint width changed');

// head = EBML header + Segment ID only (old size vint excluded, replaced by segSizeVint)
const head = src.slice(0, seg.totalOff + seg.idLen);
const out = Buffer.concat([head, segSizeVint, newSeekHead, beforeInsert, voidEl, afterInsert]);
fs.writeFileSync('/tmp/t62/test_padded.mkv', out);
console.log(`written /tmp/t62/test_padded.mkv ${(out.length / 1048576).toFixed(2)}MB (expected ${(40 + 12 + bodyLen)} | segSize=${bodyLen})`);
