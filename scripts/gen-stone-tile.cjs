// One-time generator for the seamless stone texture used by the header/sidebar.
// Run: node scripts/gen-stone-tile.cjs  (requires sharp; dev-only, not shipped)
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const N = 8; // 8x8 cells
const CELL = 16; // px per cell -> 128px tile
const SIZE = N * CELL;
// Deterministic value-noise grayscale.
let s = 1234567;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const grid = Array.from({ length: N }, () => Array.from({ length: N }, () => Math.round(120 + rnd() * 90)));
let rects = "";
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const g = grid[y][x];
    const px = x * CELL, py = y * CELL;
    const lite = Math.min(255, g + 26), dark = Math.max(0, g - 32);
    rects += `<rect x="${px}" y="${py}" width="${CELL}" height="${CELL}" fill="rgb(${g},${g},${g})"/>`;
    rects += `<rect x="${px}" y="${py}" width="${CELL}" height="2" fill="rgb(${lite},${lite},${lite})" opacity="0.5"/>`;
    rects += `<rect x="${px}" y="${py}" width="2" height="${CELL}" fill="rgb(${lite},${lite},${lite})" opacity="0.4"/>`;
    rects += `<rect x="${px}" y="${py + CELL - 2}" width="${CELL}" height="2" fill="rgb(${dark},${dark},${dark})" opacity="0.5"/>`;
    rects += `<rect x="${px + CELL - 2}" y="${py}" width="2" height="${CELL}" fill="rgb(${dark},${dark},${dark})" opacity="0.4"/>`;
  }
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">${rects}</svg>`;
const out = path.join(__dirname, "..", "frontend", "src", "assets", "stone-tile.png");
sharp(Buffer.from(svg)).png().toFile(out).then((i) => console.log("wrote", out, i.width + "x" + i.height));
