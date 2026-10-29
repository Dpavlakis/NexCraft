"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const testDirectory = path.join(repoRoot, "scripts", "security-tests");

function main() {
  let entries;
  try {
    entries = fs.readdirSync(testDirectory, { withFileTypes: true });
  } catch (error) {
    console.error(`Cannot enumerate security tests in ${testDirectory}: ${error.message}`);
    return 1;
  }

  const tests = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.cjs"))
    .map((entry) => path.join(testDirectory, entry.name))
    .sort();

  if (tests.length === 0) {
    console.error(`No security tests found: expected scripts/security-tests/*.test.cjs in ${repoRoot}`);
    return 1;
  }

  const result = spawnSync(process.execPath, ["--test", ...tests], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false
  });

  if (result.error) {
    console.error(`Failed to start security tests: ${result.error.message}`);
    return 1;
  }
  if (result.signal) {
    console.error(`Security tests terminated by signal ${result.signal}`);
    return 1;
  }
  return result.status === null ? 1 : result.status;
}

process.exitCode = main();
