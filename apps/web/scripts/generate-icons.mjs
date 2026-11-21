import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const outDir = path.resolve(import.meta.dirname, '../public/icons');
fs.mkdirSync(outDir, { recursive: true });

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  const combined = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(combined), 0);
  return Buffer.concat([lenBuf, combined, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter none
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

function pointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const v0x = cx - ax;
  const v0y = cy - ay;
  const v1x = bx - ax;
  const v1y = by - ay;
  const v2x = px - ax;
  const v2y = py - ay;

  const dot00 = v0x * v0x + v0y * v0y;
  const dot01 = v0x * v1x + v0y * v1y;
  const dot02 = v0x * v2x + v0y * v2y;
  const dot11 = v1x * v1x + v1y * v1y;
  const dot12 = v1x * v2x + v1y * v2y;

  const invDenom = 1 / (dot00 * dot11 - dot01 * dot01);
  const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
  const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
  return u >= 0 && v >= 0 && u + v <= 1;
}

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  // Keep main emblem inside 80% safe zone for maskable icons
  const badgeR = size * 0.34;
  const ringThickness = size * 0.032;

  // Dual overlapping play triangles in tungsten-amber & warm ivory
  const tri1 = [cx - size * 0.14, cy - size * 0.14, cx - size * 0.14, cy + size * 0.14, cx + size * 0.08, cy];
  const tri2 = [cx - size * 0.01, cy - size * 0.14, cx - size * 0.01, cy + size * 0.14, cx + size * 0.21, cy];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      // Base canvas: #0E0E10
      let r = 14;
      let g = 14;
      let b = 16;

      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.hypot(dx, dy);

      if (dist <= badgeR) {
        // Inner screening circle: #1B1B21
        r = 27;
        g = 27;
        b = 33;
      }

      if (dist >= badgeR - ringThickness && dist <= badgeR) {
        // Subtle ring: #383844
        r = 56;
        g = 56;
        b = 68;
      }

      const inT1 = pointInTriangle(x + 0.5, y + 0.5, ...tri1);
      const inT2 = pointInTriangle(x + 0.5, y + 0.5, ...tri2);

      if (inT1 && inT2) {
        // Bright tungsten highlight at overlap: #F6C244
        r = 246;
        g = 194;
        b = 68;
      } else if (inT2) {
        // Primary tungsten amber: #E5A00D
        r = 229;
        g = 160;
        b = 13;
      } else if (inT1) {
        // Warm cinema ivory: #F4F2EE
        r = 244;
        g = 242;
        b = 238;
      }

      rgba[idx] = r;
      rgba[idx + 1] = g;
      rgba[idx + 2] = b;
      rgba[idx + 3] = 255;
    }
  }

  return encodePng(size, size, rgba);
}

fs.writeFileSync(path.join(outDir, 'icon-192.png'), renderIcon(192));
fs.writeFileSync(path.join(outDir, 'icon-512.png'), renderIcon(512));
console.log('Generated PWA PNG icons in', outDir);
