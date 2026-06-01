import fs from "fs-extra";
import path from "path";
import { detectStartArtifact } from "./modloader_bootstrap";
import type { ModLoader } from "./modloader_bootstrap";

export interface IServerDetectResult {
  kind: "java" | "bedrock";
  loader?: ModLoader;
  mcVersion?: string;
  startCommand?: string;
  worldName: string;
  manifest?: { source: "curseforge" | "modrinth"; raw: any };
  packName?: string;
}

function readProp(file: string, key: string): string | undefined {
  if (!fs.existsSync(file)) return undefined;
  const re = new RegExp(`^${key}=(.*)$`, "m");
  const m = re.exec(fs.readFileSync(file, "utf-8"));
  return m?.[1]?.trim();
}

function hasTop(dir: string, name: string): boolean {
  return fs.existsSync(path.join(dir, name));
}

export function detectServer(dir: string): IServerDetectResult {
  // --- Bedrock first: a native bedrock_server binary at the top level. ---
  if (hasTop(dir, "bedrock_server")) {
    const worldName = readProp(path.join(dir, "server.properties"), "level-name") || "Bedrock level";
    try {
      fs.chmodSync(path.join(dir, "bedrock_server"), 0o755);
    } catch {
      // ignore
    }
    return {
      kind: "bedrock",
      loader: "bedrock",
      worldName,
      startCommand: 'sh -c "LD_LIBRARY_PATH=. exec ./bedrock_server"'
    };
  }

  // --- Java ---
  const worldName = readProp(path.join(dir, "server.properties"), "level-name") || "world";
  const detected = detectStartArtifact({
    cwd: dir,
    javaExe: "java",
    memArgs: "-Xmx4096M -Xms1024M",
    allowScripts: true
  });

  const result: IServerDetectResult = {
    kind: "java",
    worldName,
    startCommand: detected?.startCommand,
    loader: detected?.loader,
    mcVersion: detectMcVersion(dir)
  };

  // Manifests (used by the panel for pack identification).
  const cfManifest = path.join(dir, "manifest.json");
  if (fs.existsSync(cfManifest)) {
    try {
      const raw = fs.readJsonSync(cfManifest);
      result.manifest = { source: "curseforge", raw };
      result.packName = typeof raw?.name === "string" ? raw.name : undefined;
    } catch {
      // ignore
    }
  }
  const mrIndex = path.join(dir, "modrinth.index.json");
  if (fs.existsSync(mrIndex)) {
    try {
      const raw = fs.readJsonSync(mrIndex);
      result.manifest = { source: "modrinth", raw };
      result.packName = typeof raw?.name === "string" ? raw.name : undefined;
    } catch {
      // ignore
    }
  }

  return result;
}

// Best-effort MC version sniff. Unknown -> undefined (user fills in review).
function detectMcVersion(dir: string): string | undefined {
  // 1) Vanilla-style versions/<v>/server-<v>.jar
  const versionsDir = path.join(dir, "versions");
  if (fs.existsSync(versionsDir)) {
    for (const v of fs.readdirSync(versionsDir)) {
      if (fs.existsSync(path.join(versionsDir, v, `server-${v}.jar`))) return v;
    }
  }
  // 2) Forge/NeoForge libraries path: net/minecraft/server/<mc>-<...>/
  const mcLib = path.join(dir, "libraries", "net", "minecraft", "server");
  if (fs.existsSync(mcLib)) {
    for (const e of fs.readdirSync(mcLib)) {
      const m = /^(\d+(?:\.\d+){1,2})/.exec(e);
      if (m) return m[1];
    }
  }
  return undefined;
}
