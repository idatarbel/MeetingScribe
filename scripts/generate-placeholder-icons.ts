/**
 * Generates solid-color placeholder PNG icons for the Chrome extension manifest.
 * Run with: npx tsx scripts/generate-placeholder-icons.ts
 *
 * These will be replaced with real branded icons in Phase 11.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const ICON_DIR = resolve(import.meta.dirname, '..', 'assets', 'icons');
const SIZES = [16, 32, 48, 128];

// Brand blue from tailwind.css theme
const R = 0x3b, G = 0x82, B = 0xf6;

function createPng(size: number): Buffer {
  // Minimal valid PNG: IHDR + single IDAT (uncompressed) + IEND
  // Color type 2 (RGB), bit depth 8, no filtering, no compression

  const width = size;
  const height = size;

  // Raw pixel data: filter byte (0) + RGB per pixel, per row
  const rawRowLen = 1 + width * 3;
  const rawData = Buffer.alloc(rawRowLen * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * rawRowLen;
    rawData[rowOffset] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const px = rowOffset + 1 + x * 3;
      rawData[px] = R;
      rawData[px + 1] = G;
      rawData[px + 2] = B;
    }
  }

  // Deflate the raw data using zlib stored blocks (no compression)
  const deflated = deflateStored(rawData);

  // Build chunks
  const ihdr = createIHDR(width, height);
  const idat = createIDAT(deflated);
  const iend = createIEND();

  // PNG signature + chunks
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([signature, ihdr, idat, iend]);
}

function deflateStored(data: Buffer): Buffer {
  // zlib header (CM=8, CINFO=7, no dict, FCHECK valid) + stored deflate blocks
  const maxBlock = 65535;
  const blocks: Buffer[] = [];

  // zlib header: CMF=0x78, FLG=0x01 (FCHECK=1 makes checksum valid)
  blocks.push(Buffer.from([0x78, 0x01]));

  let offset = 0;
  while (offset < data.length) {
    const remaining = data.length - offset;
    const blockLen = Math.min(remaining, maxBlock);
    const isLast = offset + blockLen >= data.length;

    const header = Buffer.alloc(5);
    header[0] = isLast ? 0x01 : 0x00;
    header.writeUInt16LE(blockLen, 1);
    header.writeUInt16LE(blockLen ^ 0xffff, 3);

    blocks.push(header);
    blocks.push(data.subarray(offset, offset + blockLen));
    offset += blockLen;
  }

  // Adler-32 checksum
  let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]!) % 65521;
    b = (b + a) % 65521;
  }
  const adler = Buffer.alloc(4);
  adler.writeUInt32BE(((b << 16) | a) >>> 0, 0);
  blocks.push(adler);

  return Buffer.concat(blocks);
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]!;
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeB = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeB, data])), 0);
  return Buffer.concat([len, typeB, data, crc]);
}

function createIHDR(w: number, h: number): Buffer {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(w, 0);
  data.writeUInt32BE(h, 4);
  data[8] = 8;  // bit depth
  data[9] = 2;  // color type: RGB
  data[10] = 0; // compression
  data[11] = 0; // filter
  data[12] = 0; // interlace
  return createChunk('IHDR', data);
}

function createIDAT(deflatedData: Buffer): Buffer {
  return createChunk('IDAT', deflatedData);
}

function createIEND(): Buffer {
  return createChunk('IEND', Buffer.alloc(0));
}

// Main
mkdirSync(ICON_DIR, { recursive: true });
for (const size of SIZES) {
  const png = createPng(size);
  const path = resolve(ICON_DIR, `icon-${size}.png`);
  writeFileSync(path, png);
  console.log(`Created ${path} (${png.length} bytes)`);
}
console.log('Placeholder icons generated.');
