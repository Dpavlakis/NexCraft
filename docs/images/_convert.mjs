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
  // Round 2 (2026-06-01) — the previously-old-theme set, recaptured in the new theme.
  "backups.png": "backups",
  "players.png": "players",
  "metrics.png": "metrics",
  "reset-java.png": "reset-dialog",
  "reset-bedrock.png": "reset-bedrock",
  "file-management.png": "file-management",
  "mod-plugin-manager.png": "mod-plugin-manager",
  "scheduled-tasks.png": "scheduled-tasks",
  "profile-themes.png": "profile-themes",
  "daemons.png": "daemons"
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
