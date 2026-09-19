// Task 62: build a large valid MKV by inserting a Void element before the clusters
// and patching SeekHead offsets. Output: /tmp/t62/test_padded.mkv
import fs from 'fs';

const src = fs.readFileSync('/tmp/t62/test.mkv');
const VOID_SIZE = 60 * 1048576;

// --- minimal EBML top-level parser ---
function readVint(buf, off, keepMarker = false) {
  // ID vints keep the marker bits; data-size vints drop the length marker.
  const first = buf[off];
  let len = 1;
  if (first >= 0x80 && first <= 0xff) len = 1;
  else if (first >= 0x40 && first <= 0x7f) len = 2;
  else if (first >= 0x20 && first <= 0x3f) len = 3;
  else if (first >= 0x10 && first <= 0x1f) len = 4;
  else if (first >= 0x08 && first <= 0x0f) len = 5;
  else if (first >= 0x04 && first <= 0x07) len = 6;
  else if (first >= 0x02 && first <= 0x03) len = 7;
  else if (first === 0x01) len = 8;
  else throw new Error(`bad vint at ${off}: ${first.toString(16)}`);
  let value = 0n;
  for (let i = 0; i < len; i++) value = value * 256n + BigInt(buf[off + i]);
  if (!keepMarker) value -= 2n ** (7n * BigInt(len)); // drop the marker bit
  return { value: Number(value), length: len };
}
function encodeSizeVint(value, minBytes = 1) {
  // data-size vint (marker dropped): choose byte length
  let len = minBytes;
  const limits = [0x7f, 0x3fff, 0x1fffff, 0x0fffffff, 0x7ffffffff, 0x3ffffffffff, 0x1ffffffffffff];
  while (len < 8 && value > limits[len - 1]) len++;
  const out = Buffer.alloc(len);
  out[0] = (0x80 >> (len - 1)) | Math.floor(value / Math.pow(256, len - 1));
  // safer: fill from the end
  let v = value;
  for (let i = len - 1; i >= 1; i--) { out[i] = v & 0xff; v = Math.floor(v / 256); }
  out[0] = (0x80 >> (len - 1)) | v;
  return out;
}

// walk top level
let off = 0;
const elements = [];
while (off < src.length) {
  const id = readVint(src, off, true);
  const size = readVint(src, off + id.length);
  const header = id.length + size.length;
  const dataSize = size.value; // known-size elements expected
  elements.push({ id: id.value, idLen: id.length, sizeLen: size.length, dataOff: off + header, dataSize, totalOff: off, totalLen: header + dataSize });
  off += header + dataSize;
}
console.log('top-level elements:', elements.map(e => `id=${e.id.toString(16)} len=${e.totalLen}`).join(', '));

const seg = elements.find(e => e.id === 0x18538067); // Segment
// ffmpeg writes Segment with UNKNOWN size (all-ones vint) — clamp to EOF
const UNKNOWN = seg.sizeLen === 8 && seg.dataSize >= 0x00ffffffffffff;
const segEndAbs = UNKNOWN ? src.length : seg.dataOff + seg.dataSize;
if (UNKNOWN) seg.dataSize = segEndAbs - seg.dataOff;
// segment children start right after Segment header
let c = seg.dataOff;
const children = [];
while (c < segEndAbs) {
  const id = readVint(src, c, true);
  const size = readVint(src, c + id.length);
  const header = id.length + size.length;
  children.push({ id: id.value, offInSeg: c - seg.dataOff, headerLen: header, dataSize: size.value, absOff: c });
  c += header + size.value;
}
console.log('segment children:', children.map(e => `id=${e.id.toString(16)}@${e.offInSeg}(${e.dataSize}b)`).join(', '));

// insertion point: before first Cluster
const firstCluster = children.find(e => e.id === 0x1f43b675);
if (!firstCluster) throw new Error('no cluster');
const insertAt = firstCluster.offInSeg; // offset within Segment data

// --- build Void element ---
const voidSizeBuf = encodeSizeVint(VOID_SIZE, 4);
const voidEl = Buffer.concat([Buffer.from([0xec]), voidSizeBuf, Buffer.alloc(VOID_SIZE)]);
console.log(`void element: ${voidEl.length} bytes (header ${1 + voidSizeBuf.length})`);

// --- patch SeekHead ---
function patchSeekHead(seekHeadChild, delta) {
  const abs = seekHeadChild.absOff;
  const size = seekHeadChild.dataSize;
  const data = src.slice(abs + seekHeadChild.headerLen, abs + seekHeadChild.headerLen + size);
  const out = Buffer.from(data);
  let p = 0;
  while (p < out.length) {
    const id = readVint(out, p, true); const sz = readVint(out, p + id.length); // Seek entry (0x4dbb)
    const entryLen = id.length + sz.length + sz.value;
    // inside: SeekID(0x53ab) SeekPosition(0x53ac)
    let q = p + id.length + sz.length;
    let posVal = null, posOff = -1, posLen = 0;
    while (q < p + entryLen) {
      const id2 = readVint(out, q, true); const sz2 = readVint(out, q + id2.length);
      const h2 = id2.length + sz2.length;
      if (id2.value === 0x53ac) { posVal = sz2.value; posOff = q + h2; posLen = sz2.length; }
      q += h2 + sz2.value;
    }
    if (posVal !== null && posVal >= insertAt) {
      const newPos = posVal + delta;
      const enc = encodeSizeVint(newPos, posLen);
      // pad to same length (posLen usually 1-2 bytes; may need expansion)
      if (enc.length <= posLen) {
        while (enc.length < posLen) { /* left-pad not possible for vint; expand marker instead */ break; }
        enc.copy(out, posOff + (posLen - enc.length) > 0 ? posOff : posOff);
        // if shorter, shift — but vint must stay same length; instead rewrite with padding:
        if (enc.length < posLen) {
          const padded = encodeSizeVint(newPos, posLen);
          padded.copy(out, posOff);
        }
      } else {
        const padded = encodeSizeVint(newPos, posLen);
        padded.copy(out, posOff);
      }
      console.log(`  seek entry pos ${posVal} -> ${newPos} (id ok)`);
    }
    p += entryLen;
  }
  return out;
}

const seekHead = children.find(e => e.id === 0x114d9b74);
const seekHeadPatched = patchSeekHead(seekHead, VOID_SIZE);

// --- assemble new file ---
// original file layout: [EBML][Segment(size)(children...)]
const ebmlEl = elements[0];
const beforeSegData = Buffer.concat([
  src.slice(ebmlEl.totalOff, seg.totalOff + seg.idLen + seg.sizeLen), // EBML + Segment header
  src.slice(seg.dataOff, seg.dataOff + insertAt),                     // children up to insertion
]);
// replace SeekHead bytes inside that region: SeekHead is at seg.dataOff + seekHead.offInSeg
const shStart = seg.dataOff + seekHead.offInSeg;
const relSh = shStart - (seg.dataOff - (seg.dataOff - seg.dataOff)); // absolute file offset
const absShStart = seekHead.absOff;
const absShEnd = seekHead.absOff + seekHead.headerLen + seekHead.dataSize;
const beforeSegDataFixed = Buffer.concat([
  src.slice(ebmlEl.totalOff, absShStart),
  seekHeadPatched.length === seekHead.dataSize ? seekHeadPatched : (() => { throw new Error('seekhead size changed'); })(),
  src.slice(absShEnd, seg.dataOff + insertAt),
]);

const newSegDataLen = seg.dataSize + VOID_SIZE;
// ffmpeg writes Segment size as UNKNOWN 8-byte vint — keep unknown (no patch needed)
const newSegSize = null;

const out = Buffer.concat([
  beforeSegDataFixed,
  voidEl,
  src.slice(seg.dataOff + insertAt),
]);

fs.writeFileSync('/tmp/t62/test_padded.mkv', out);
console.log(`written /tmp/t62/test_padded.mkv ${(out.length / 1048576).toFixed(1)}MB`);
