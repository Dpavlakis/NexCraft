import fs from "fs-extra";
import os from "os";
import path from "path";

function findFile(dir: string, name: string, maxDepth = 12): string | undefined {
  if (maxDepth < 0 || !fs.existsSync(dir)) return undefined;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const e of entries) if (e.isFile() && e.name === name) return path.join(dir, e.name);
  for (const e of entries) {
    if (e.isDirectory()) {
      const found = findFile(path.join(dir, e.name), name, maxDepth - 1);
      if (found) return found;
    }
  }
  return undefined;
}

// True if a start command launches a shell wrapper script (sh/bash run.sh, etc.)
export function isShellWrapperStart(cmd: string): boolean {
  return /(^|\s)(sh|bash)\s+\.?\/?(run|start|startserver|serverstart)\.sh\b/i.test(cmd || "");
}

// Compute a direct `java ...` start command from an installed Forge/NeoForge server
// (the args-file form run.sh uses) so the monitored process is Java, not the shell.
export function detectDirectJavaStart(
  cwd: string,
  javaExe = "java",
  memMB = 4096
): string | undefined {
  const argsName = os.platform() === "win32" ? "win_args.txt" : "unix_args.txt";
  const argsFile = findFile(path.join(cwd, "libraries"), argsName, 12);
  if (argsFile && fs.existsSync(path.join(cwd, "user_jvm_args.txt"))) {
    const rel = path.relative(cwd, argsFile).split(path.sep).join("/");
    // memory comes from user_jvm_args.txt, so don't add -Xmx here
    return `${javaExe} @user_jvm_args.txt @${rel} nogui`;
  }
  // Legacy Forge universal/server jar
  try {
    for (const e of fs.readdirSync(cwd)) {
      if (/^(forge|neoforge)-.*\.jar$/i.test(e) && !/installer/i.test(e)) {
        return `${javaExe} -Xmx${memMB}M -jar ${e} nogui`;
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}
