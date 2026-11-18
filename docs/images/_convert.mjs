// One-off: convert mapped source screenshots -> docs/images/<target>.webp
// Usage (with sharp installed in the checkout):
//   node docs/images/_convert.mjs /path/to/screenshots
// Or set NEXCRAFT_SCREENSHOT_DIR instead of passing a directory.
//
// Edit MAP below: source PNG (in the Screenshots folder) -> target webp name.
// Set `src` to a file in SRC_DIR. Comment out / remove lines you don't have.
// Existing docs/images/*.webp are ~full-width light-mode; these originals are
// 2559px wide — we keep them crisp (no downscale) and just encode to webp q82.

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const sourceDir = process.argv[2] || process.env.NEXCRAFT_SCREENSHOT_DIR;
if (!sourceDir) {
  console.error("Usage: node _convert.mjs <screenshot-directory> (or set NEXCRAFT_SCREENSHOT_DIR)");
  process.exit(1);
}
const SRC_DIR = path.resolve(sourceDir);
if (!fs.statSync(SRC_DIR, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(`Screenshot directory does not exist: ${SRC_DIR}`);
  process.exit(1);
}
const OUT_DIR = fileURLToPath(new URL("./", import.meta.url));
const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const sharp = require("sharp");

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
