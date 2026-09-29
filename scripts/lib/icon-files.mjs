/**
 * The three icon containers the packager takes (v8-0-plan A6) — PNG, the
 * macOS .icns and the Windows .ico — written and read back without any tool
 * outside Node.
 *
 * Written the way the Native SDK's own pipeline writes them
 * (src/primitives/canvas/app_icon.zig in @native-sdk/cli 0.10.1): PNG
 * members everywhere except the .icns 16 and 32 px 1x slots (ic04, ic05),
 * which the system reads as "ARGB" run-length planes; the .ico holds PNG
 * entries. Deterministic: the same pixels give the same bytes, so a
 * regenerated icon that did not change is not a diff.
 *
 * The readers exist for scripts/test-brand.mjs, which checks the files that
 * are committed rather than trusting that the generator was run.
 * @module icon-files
 */
import zlib from "zlib";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Straight-alpha RGBA8 → PNG (8-bit RGBA, no interlace, filter 0 on every
 * row, zlib level 9: plain enough to be byte-stable).
 */
export function encodePng(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([PNG_SIG, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

/** PNG → {w, h, rgba}: 8-bit RGB or RGBA, non-interlaced, any filter. */
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error("not a PNG");
  let off = 8, w = 0, h = 0, type = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const kind = buf.toString("latin1", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (kind === "IHDR") {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4); type = data[9];
      if (data[8] !== 8 || (type !== 6 && type !== 2) || data[12] !== 0) throw new Error("unsupported PNG");
    } else if (kind === "IDAT") idat.push(data);
    off += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      let p = 0;
      if (f === 1) p = a;
      else if (f === 2) p = b;
      else if (f === 3) p = (a + b) >> 1;
      else if (f === 4) {
        const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = (v + p) & 0xff;
    }
  }
  if (bpp === 4) return { w, h, rgba: px };
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { px.copy(rgba, i * 4, i * 3, i * 3 + 3); rgba[i * 4 + 3] = 255; }
  return { w, h, rgba };
}

/** icns "ARGB": the magic, then A, R, G, B planes, each PackBits-style RLE. */
export function encodeArgb(rgba, w, h) {
  const n = w * h;
  const out = [Buffer.from("ARGB", "latin1")];
  for (const ch of [3, 0, 1, 2]) {
    const plane = Buffer.alloc(n);
    for (let i = 0; i < n; i++) plane[i] = rgba[i * 4 + ch];
    out.push(packBits(plane));
  }
  return Buffer.concat(out);
}
function packBits(bytes) {
  const out = [];
  let i = 0;
  while (i < bytes.length) {
    let run = 1;
    while (i + run < bytes.length && bytes[i + run] === bytes[i] && run < 130) run++;
    if (run >= 3) { out.push(0x80 + run - 3, bytes[i]); i += run; continue; }
    let end = i + 1;
    while (end < bytes.length && end - i < 128) {
      if (end + 2 < bytes.length && bytes[end] === bytes[end + 1] && bytes[end] === bytes[end + 2]) break;
      end++;
    }
    out.push(end - i - 1, ...bytes.subarray(i, end));
    i = end;
  }
  return Buffer.from(out);
}
/** ARGB payload → RGBA (the reader side of encodeArgb). */
export function decodeArgb(buf, w, h) {
  if (buf.toString("latin1", 0, 4) !== "ARGB") throw new Error("not ARGB");
  const n = w * h, planes = Buffer.alloc(n * 4);
  let off = 4, got = 0;
  while (got < n * 4) {
    const c = buf[off++];
    if (c >= 0x80) { const run = c - 0x80 + 3; planes.fill(buf[off++], got, got + run); got += run; }
    else { const run = c + 1; buf.copy(planes, got, off, off + run); off += run; got += run; }
  }
  const rgba = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    rgba[i * 4 + 3] = planes[i]; rgba[i * 4] = planes[n + i];
    rgba[i * 4 + 1] = planes[2 * n + i]; rgba[i * 4 + 2] = planes[3 * n + i];
  }
  return rgba;
}

/** The .icns members, in the order the platform's own tool writes them. */
export const ICNS_SLOTS = [
  { kind: "ic04", size: 16, argb: true }, { kind: "ic11", size: 32 },
  { kind: "ic05", size: 32, argb: true }, { kind: "ic12", size: 64 },
  { kind: "ic07", size: 128 }, { kind: "ic13", size: 256 },
  { kind: "ic08", size: 256 }, { kind: "ic14", size: 512 },
  { kind: "ic09", size: 512 }, { kind: "ic10", size: 1024 },
];
/** The .ico sizes (the SDK's list). */
export const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/** [{kind, data}] → .icns */
export function writeIcns(members) {
  const parts = members.map(({ kind, data }) => {
    const head = Buffer.alloc(8);
    head.write(kind, 0, "latin1");
    head.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([head, data]);
  });
  const head = Buffer.alloc(8);
  head.write("icns", 0, "latin1");
  head.writeUInt32BE(8 + parts.reduce((s, p) => s + p.length, 0), 4);
  return Buffer.concat([head, ...parts]);
}
/** .icns → [{kind, data}] */
export function readIcns(buf) {
  if (buf.toString("latin1", 0, 4) !== "icns" || buf.readUInt32BE(4) !== buf.length) throw new Error("not an icns");
  const out = [];
  for (let off = 8; off < buf.length;) {
    const len = buf.readUInt32BE(off + 4);
    out.push({ kind: buf.toString("latin1", off, off + 4), data: buf.subarray(off + 8, off + len) });
    off += len;
  }
  return out;
}

/** [{size, png}] → .ico of PNG entries */
export function writeIco(entries) {
  const head = Buffer.alloc(6 + 16 * entries.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
  let off = head.length;
  entries.forEach(({ size, png }, i) => {
    const e = 6 + 16 * i;
    head[e] = size >= 256 ? 0 : size; head[e + 1] = size >= 256 ? 0 : size;
    head[e + 2] = 0; head[e + 3] = 0;
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(png.length, e + 8); head.writeUInt32LE(off, e + 12);
    off += png.length;
  });
  return Buffer.concat([head, ...entries.map((x) => x.png)]);
}
/** .ico → [{size, png}] */
export function readIco(buf) {
  if (buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) throw new Error("not an ico");
  const n = buf.readUInt16LE(4), out = [];
  for (let i = 0; i < n; i++) {
    const e = 6 + 16 * i;
    const len = buf.readUInt32LE(e + 8), at = buf.readUInt32LE(e + 12);
    out.push({ size: buf[e] || 256, png: buf.subarray(at, at + len) });
  }
  return out;
}
