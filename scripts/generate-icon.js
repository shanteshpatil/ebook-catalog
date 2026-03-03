#!/usr/bin/env node
// Generates build/icon.png — a 1024×1024 BookCatalog app icon.
// Draws an open book on a forest-green background using only Node.js builtins.
// Run: node scripts/generate-icon.js

'use strict';
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

const S = 1024; // canvas size
const buf = new Uint8Array(S * S * 4); // RGBA, starts fully transparent

// ── CRC32 ──────────────────────────────────────────────────────────────────
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[i] = c;
}
function crc32(b) {
  let c = 0xFFFFFFFF;
  for (const byte of b) c = (c >>> 8) ^ CRC_TABLE[(c ^ byte) & 0xFF];
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ── Drawing helpers ────────────────────────────────────────────────────────
function setpx(x, y, r, g, b, a = 255) {
  if (x < 0 || x >= S || y < 0 || y >= S) return;
  const i = (y * S + x) * 4;
  buf[i] = r; buf[i+1] = g; buf[i+2] = b; buf[i+3] = a;
}

function fillRect(x1, y1, x2, y2, r, g, b, a = 255) {
  for (let y = y1; y <= y2; y++)
    for (let x = x1; x <= x2; x++)
      setpx(x, y, r, g, b, a);
}

// Rounded rectangle with anti-aliased edges
function roundedRect(x1, y1, x2, y2, rad, r, g, b, a = 255) {
  const corners = [
    [x1 + rad, y1 + rad],
    [x2 - rad, y1 + rad],
    [x1 + rad, y2 - rad],
    [x2 - rad, y2 - rad],
  ];
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      let inside = true;
      if      (x < x1+rad && y < y1+rad) inside = (x-corners[0][0])**2 + (y-corners[0][1])**2 <= rad*rad;
      else if (x > x2-rad && y < y1+rad) inside = (x-corners[1][0])**2 + (y-corners[1][1])**2 <= rad*rad;
      else if (x < x1+rad && y > y2-rad) inside = (x-corners[2][0])**2 + (y-corners[2][1])**2 <= rad*rad;
      else if (x > x2-rad && y > y2-rad) inside = (x-corners[3][0])**2 + (y-corners[3][1])**2 <= rad*rad;
      if (inside) setpx(x, y, r, g, b, a);
    }
  }
}

// ── Icon design ────────────────────────────────────────────────────────────
// Background: forest green, with macOS-style rounded square (r=220)
roundedRect(0, 0, S-1, S-1, 220, 0x2c, 0x5f, 0x2e);

// Subtle inner gradient simulation: lighter strip at top edge
for (let y = 0; y < 80; y++) {
  const alpha = Math.round(18 * (1 - y / 80));
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    if (buf[i+3] > 0) {
      buf[i]   = Math.min(255, buf[i]   + alpha);
      buf[i+1] = Math.min(255, buf[i+1] + alpha);
      buf[i+2] = Math.min(255, buf[i+2] + alpha);
    }
  }
}

// Open book — white, centred
// Pages span: x 194–830, y 288–736 (542×448 px)
const PX1 = 194, PX2 = 830;   // outer left / right
const PY1 = 288, PY2 = 736;   // top / bottom
const SPX = 511, SPW = 12;     // spine centre-x, spine gap width

// Left page
fillRect(PX1, PY1, SPX - SPW/2 - 1, PY2, 255, 255, 255);
// Right page
fillRect(SPX + SPW/2, PY1, PX2, PY2, 255, 255, 255);

// Spine crease: dark green line, creating the open-book centre shadow
fillRect(SPX - SPW/2, PY1, SPX + SPW/2 - 1, PY2, 0x1e, 0x47, 0x20);

// Soft shadow along the spine edges (blend inward)
for (let blur = 0; blur < 14; blur++) {
  const alpha = Math.round(30 * (1 - blur / 14));
  for (let y = PY1; y <= PY2; y++) {
    setpx(SPX - SPW/2 - 1 - blur, y, 0x1e, 0x47, 0x20, alpha);
    setpx(SPX + SPW/2     + blur, y, 0x1e, 0x47, 0x20, alpha);
  }
}

// Page-edge lines (right side of right page — stacked pages effect)
for (let k = 1; k <= 4; k++) {
  const shade = 230 - k * 18;
  fillRect(PX2 + k*2, PY1 + k*4, PX2 + k*2 + 1, PY2 - k*4, shade, shade, shade);
}

// Text lines — grey stripes on both pages suggesting printed text
const LINE_R = 190, LINE_G = 190, LINE_B = 190;
const LINE_H  = 18;
const LINE_SP = 66;
const LY0     = PY1 + 88;
const LEFT_X1 = PX1 + 48, LEFT_X2  = SPX - SPW/2 - 52;
const RIGH_X1 = SPX + SPW/2 + 48, RIGH_X2 = PX2 - 48;

for (let i = 0; i < 5; i++) {
  const y1 = LY0 + i * LINE_SP;
  const y2 = y1 + LINE_H;
  if (y2 > PY2 - 40) break;
  // Last line shorter (natural paragraph end)
  const lx2 = (i === 4) ? LEFT_X1 + Math.round((LEFT_X2 - LEFT_X1) * 0.6) : LEFT_X2;
  const rx2 = (i === 4) ? RIGH_X1 + Math.round((RIGH_X2 - RIGH_X1) * 0.6) : RIGH_X2;
  fillRect(LEFT_X1, y1, lx2, y2, LINE_R, LINE_G, LINE_B);
  fillRect(RIGH_X1, y1, rx2, y2, LINE_R, LINE_G, LINE_B);
}

// Small decorative rule near the top of each page (chapter line)
const RULE_Y = PY1 + 52;
fillRect(LEFT_X1, RULE_Y, LEFT_X2, RULE_Y + 3, 210, 210, 210);
fillRect(RIGH_X1, RULE_Y, RIGH_X2, RULE_Y + 3, 210, 210, 210);

// ── PNG encode ─────────────────────────────────────────────────────────────
function pngChunk(type, data) {
  const t   = Buffer.from(type, 'ascii');
  const len = Buffer.allocUnsafe(4); len.writeUInt32BE(data.length);
  const crc = Buffer.allocUnsafe(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

const IHDR = Buffer.allocUnsafe(13);
IHDR.writeUInt32BE(S, 0); IHDR.writeUInt32BE(S, 4);
IHDR[8] = 8; IHDR[9] = 6; IHDR[10] = 0; IHDR[11] = 0; IHDR[12] = 0;

// Raw scanlines: 1 filter byte (0x00 = None) + 4 bytes per pixel
const raw = Buffer.allocUnsafe(S * (1 + S * 4));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  Buffer.from(buf.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1);
}

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  pngChunk('IHDR', IHDR),
  pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  pngChunk('IEND', Buffer.alloc(0)),
]);

const outPath = path.join(__dirname, '..', 'assets', 'icon.png');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, png);
console.log(`✓ Generated ${outPath}  (${S}×${S} px, ${(png.length / 1024).toFixed(1)} KB)`);
