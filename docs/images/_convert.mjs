// One-off: convert mapped source screenshots -> docs/images/<target>.webp
// Usage (from D:\NexCraft\frontend so it can resolve `sharp`):
//   node ../docs/images/_convert.mjs
//
// Edit MAP below: source PNG (in the Screenshots folder) -> target webp name.
// Set `src` to a file in SRC_DIR. Comment out / remove lines you don't have.
// Existing docs/images/*.webp are ~full-width light-mode; these originals are
// 2559px wide — we keep them crisp (no downscale) and just encode to webp q82.

import sharp from "sharp";
import path from "node:path";
import fs from "node:fs";

const SRC_DIR = "C:/Users/dimit/OneDrive/Pictures/Screenshots";
const OUT_DIR = path.resolve(process.cwd(), "../docs/images");

// FILL THIS IN — source screenshot filename -> target webp basename (no extension).
const MAP = {
  "Screenshot 2026-06-01 094120.png": "instances",
  "Screenshot 2026-06-01 094224.png": "browser-curseforge",
  "Screenshot 2026-06-01 094303.png": "browser-ftb",
  "Screenshot 2026-06-01 094319.png": "import-existing",
  "Screenshot 2026-06-01 094344.png": "modpack-detail-curseforge",
  "Screenshot 2026-06-01 094402.png": "modpack-detail-modrinth",
  "Screenshot 2026-06-01 094420.png": "settings",
  "Screenshot 2026-06-01 094441.png": "builder-detail-vanilla-2",
  "Screenshot 2026-06-01 094459.png": "builder-detail-vanilla",
  "Screenshot 2026-06-01 094517.png": "terminal-overview",
  "Screenshot 2026-06-01 094527.png": "world-management",
  "Screenshot 2026-06-01 094539.png": "automation-tab",
  "Screenshot 2026-06-01 094611.png": "instance-basic-settings",
  "Screenshot 2026-06-01 094913.png": "overview",
  "Screenshot 2026-06-01 094942.png": "builder-custom",
  "Screenshot 2026-06-01 095000.png": "browser-modrinth",
  "Screenshot 2026-06-01 102653.png": "bedrock-minecraft-settings"
};

const MAX_W = 2200; // cap width so webps aren't huge; existing set is full-width

let ok = 0,
  miss = 0;
for (const [srcName, target] of Object.entries(MAP)) {
  const srcPath = path.join(SRC_DIR, srcName);
  if (!fs.existsSync(srcPath)) {
    console.warn(`MISSING source: ${srcName}`);
    miss++;
    continue;
  }
  const outPath = path.join(OUT_DIR, `${target}.webp`);
  const img = sharp(srcPath);
  const meta = await img.metadata();
  const pipeline = meta.width > MAX_W ? img.resize({ width: MAX_W }) : img;
  await pipeline.webp({ quality: 82 }).toFile(outPath);
  console.log(`${srcName}  ->  docs/images/${target}.webp  (${meta.width}x${meta.height})`);
  ok++;
}
console.log(`\nDone: ${ok} written, ${miss} missing.`);
