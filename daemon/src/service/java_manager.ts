import axios from "axios";
import { spawn } from "child_process";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { extract } from "tar";
import { URL } from "url";
import StorageSubsystem from "../common/system_storage";
import { JavaInfo } from "../entity/commands/java/java_manager";
import { globalConfiguration } from "../entity/config";
import { $t } from "../i18n";
import downloadManager from "./download_manager";
import logger from "./log";
import FileManager from "./system_file";
import InstanceSubsystem from "./system_instance";

class JavaManager {
  private javaDataDir = "";
  public readonly javaList = new Map<string, IJavaRuntime>();
  private _sysMajor?: number;

  constructor() {
    let javaDataDir = path.join(process.cwd(), "data/JavaData");
    if (globalConfiguration.config.defaultJavaDataPath) {
      javaDataDir = path.normalize(globalConfiguration.config.defaultJavaDataPath);
    }
    if (!fs.existsSync(javaDataDir)) fs.mkdirsSync(javaDataDir);
    this.javaDataDir = path.normalize(javaDataDir);

    this.loadJavaList();
  }

  public getJavaDataDir() {
    return this.javaDataDir;
  }

  async loadJavaList() {
    for (const file of await fs.readdir(this.javaDataDir)) {
      const javaPath = path.join(this.javaDataDir, file);
      const dir = await fs.stat(javaPath);
      if (!dir.isDirectory()) continue;

      const infoPath = path.join(javaPath, "java_info.json");
      if (!fs.existsSync(infoPath)) continue;

      const config = await fs.readJson(infoPath);
      // Delete java not yet fully downloaded
      if (config.downloading) {
        await fs.remove(javaPath);
        continue;
      }

      const info = new JavaInfo(config.name, config.installTime ?? Date.now(), config.version);
      info.path = config.path;
      this.javaList.set(info.fullname, {
        info: info,
        path: javaPath,
        usingInstances: []
      });
    }
  }

  list() {
    return Array.from(this.javaList.values());
  }

  getJava(id: string) {
    return this.javaList.get(id);
  }

  exists(id: string) {
    return this.javaList.has(id);
  }

  async getJavaDownloadUrl(info: JavaInfo) {
    switch (info.name) {
      case "zulu": {
        let platform: string = os.platform();

        // In some cases, using win32 will download macosx package
        // Therefore, change platform to windows
        switch (platform) {
          case "win32": {
            platform = "windows";
            break;
          }
        }

        const url =
          "https://api.azul.com/metadata/v1/zulu/packages/?java_package_type=jdk&javafx_bundled=true&release_status=ga&availability_types=CA&certifications=tck&page=1&page_size=2" +
          `&java_version=${info.version}&os=${platform}&arch=${os.arch()}`;
        const response = await axios.get(url, {
          // azul's metadata API is often slow to respond; 3s was too aggressive
          // and aborted with ECONNABORTED before a reply arrived.
          timeout: 1000 * 15
        });

        const data = response.data;
        if (!data) return;

        const javaPackage = data.find(
          (p: any) => p.name.endsWith(".zip") || p.name.endsWith(".tar.gz")
        );
        if (!javaPackage) return;

        const downloadUrl = javaPackage.download_url;
        if (!downloadUrl) return;

        return downloadUrl;
      }
    }
  }

  addJava(info: JavaInfo) {
    const javaPath = path.join(this.javaDataDir, info.fullname);
    if (!fs.existsSync(javaPath)) fs.mkdirsSync(javaPath);

    StorageSubsystem.store(`JavaData/${info.fullname}`, "java_info", {
      name: info.name,
      path: info.path,
      version: info.version,
      installTime: info.installTime,
      downloading: false
    });

    this.javaList.set(info.fullname, {
      info: info,
      path: javaPath,
      usingInstances: []
    });
  }

  updateJavaInfo(info: JavaInfo) {
    const javaPath = path.join(this.javaDataDir, info.fullname);
    if (!fs.existsSync(javaPath)) return;

    StorageSubsystem.store(`JavaData/${info.fullname}`, "java_info", {
      name: info.name,
      path: info.path,
      version: info.version,
      installTime: info.installTime,
      downloading: false
    });
  }

  async getJavaRuntimeCommand(id: string) {
    const java = this.getJava(id);
    if (!java) throw new Error($t("TXT_CODE_77ce8542"));
    if (java.info.downloading) throw new Error($t("TXT_CODE_45d02bb7"));

    let javaPath = java.info.path ?? java.path;
    if (!javaPath) throw new Error($t("TXT_CODE_82c8bca3"));

    // For macOS, if Java is within a .jdk bundle, use the Contents/Home/bin/java path
    if (os.platform() === "darwin") {
      // Scan first-level subdirectories under javaPath to find Contents directory
      try {
        const entries = await fs.readdir(javaPath);
        for (const entry of entries) {
          const entryPath = path.join(javaPath, entry);
          const stat = await fs.stat(entryPath);
          if (stat.isDirectory()) {
            const contentsPath = path.join(entryPath, "Contents");
            if (await fs.pathExists(contentsPath)) {
              // Found Contents directory, construct new javaPath
              javaPath = path.join(entryPath, "Contents", "Home");
              break;
            }
          }
        }
      } catch (error) {
        // If scan fails, use original javaPath
      }
    }

    const javaRuntimePath = path.join(
      javaPath,
      "bin",
      os.platform() == "win32" ? "java.exe" : "java"
    );

    return `"${javaRuntimePath}"`;
  }

  // Download + extract a Java runtime into data/JavaData/<fullname>. Shared by
  // the manual Java Manager (download router) and the automatic provisioning
  // used when installing a modpack that needs a specific Java version.
  async downloadAndInstall(info: JavaInfo, log?: (m: string) => void) {
    info.downloading = true;
    const javaPath = path.join(this.javaDataDir, info.fullname);
    fs.mkdirsSync(javaPath);
    // Persist a "downloading" marker so a crash mid-download is cleaned up on
    // the next startup (loadJavaList removes entries still flagged downloading).
    StorageSubsystem.store(`JavaData/${info.fullname}`, "java_info", {
      name: info.name,
      path: info.path,
      version: info.version,
      installTime: info.installTime,
      downloading: true
    });
    this.javaList.set(info.fullname, { info, path: javaPath, usingInstances: [] });

    try {
      const downloadUrl = await this.getJavaDownloadUrl(info);
      if (!downloadUrl) throw new Error($t("TXT_CODE_4b0f31b4"));

      logger.info(`Download Java: ${downloadUrl} --> ${info.fullname}`);
      const fileName = path.basename(new URL(downloadUrl).pathname);
      const filePath = path.join(javaPath, fileName);
      await downloadManager.downloadFromUrl(downloadUrl, filePath);

      if (fileName.endsWith(".zip")) {
        const fileManager = new FileManager(javaPath, "UTF-8");
        await fileManager.unzip(fileName, ".", "UTF-8");
        const extractDir = path.join(javaPath, path.basename(fileName, ".zip"));
        if (fs.existsSync(extractDir) && (await fs.stat(extractDir)).isDirectory()) {
          for (const file of await fs.readdir(extractDir)) {
            await fs.move(path.join(extractDir, file), path.join(javaPath, file));
          }
          await fs.remove(extractDir);
        }
      } else if (fileName.endsWith(".tar.gz")) {
        await extract({ file: filePath, cwd: javaPath, strip: 1 });
      }
      // Remove the downloaded archive once extracted to save disk space.
      try {
        await fs.remove(filePath);
      } catch {
        // ignore
      }

      logger.info(`Install Env Success: ${info.fullname}`);
      info.downloading = false;
      this.updateJavaInfo(info);
    } catch (error: any) {
      logger.warn(`Install Env Error: ${error?.message}`);
      await this.removeJava(info.fullname).catch(() => {});
      throw error;
    }
  }

  private majorOf(v?: string): number {
    if (!v) return 0;
    const parts = String(v)
      .split(".")
      .map((n) => parseInt(n, 10));
    let m = parts[0] || 0;
    if (m === 1 && parts[1]) m = parts[1]; // "1.8" -> 8
    return Number.isFinite(m) ? m : 0;
  }

  private async waitUntilReady(fullname: string, timeoutMs = 5 * 60 * 1000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const rt = this.javaList.get(fullname);
      if (!rt || !rt.info.downloading) return;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // Detect the major version of the `java` on PATH (the daemon image's bundled
  // JDK), cached. Used to skip an auto-download when the system Java already
  // matches what the pack needs.
  async getSystemJavaMajor(): Promise<number | undefined> {
    if (this._sysMajor !== undefined) return this._sysMajor || undefined;
    try {
      const out = await new Promise<string>((resolve) => {
        let s = "";
        const p = spawn("java", ["-version"]);
        p.stdout.on("data", (d) => (s += d.toString()));
        p.stderr.on("data", (d) => (s += d.toString()));
        p.on("error", () => resolve(""));
        p.on("exit", () => resolve(s));
      });
      const m = out.match(/version "(\d+)(?:\.(\d+))?/);
      let major = 0;
      if (m) {
        major = Number(m[1]);
        if (major === 1 && m[2]) major = Number(m[2]); // 1.8 -> 8
      }
      this._sysMajor = major;
      return major || undefined;
    } catch {
      this._sysMajor = 0;
      return undefined;
    }
  }

  // Ensure a Java runtime with the given major version exists, downloading a
  // Zulu build if necessary. Returns the runtime id (fullname) to assign to an
  // instance's config.java.id, or undefined on failure.
  async ensureJavaMajor(major: number, log?: (m: string) => void): Promise<string | undefined> {
    if (!major || !Number.isFinite(major)) return undefined;

    // Already have a matching runtime?
    for (const rt of this.javaList.values()) {
      if (rt.info.downloading) continue;
      if (this.majorOf(rt.info.version) === major) return rt.info.fullname;
    }

    const info = new JavaInfo("zulu", Date.now(), String(major));
    // A matching download already in flight (parallel install)? Wait for it.
    if (this.exists(info.fullname)) {
      await this.waitUntilReady(info.fullname);
      const rt = this.getJava(info.fullname);
      return rt && !rt.info.downloading ? info.fullname : undefined;
    }

    log?.($t("TXT_CODE_modpack.javaDownloading", { ver: String(major) }));
    await this.downloadAndInstall(info, log);
    return this.exists(info.fullname) ? info.fullname : undefined;
  }

  async removeJava(id: string) {
    const java = this.getJava(id);
    if (!java) throw new Error($t("TXT_CODE_77ce8542"));

    // if (java.info.downloading) throw new Error($t("TXT_CODE_887fee99"));
    if (java.usingInstances.length) throw new Error($t("TXT_CODE_ea8ea5d1"));

    let javaPath = java.path;
    if (!javaPath) throw new Error($t("TXT_CODE_82c8bca3"));

    await fs.remove(javaPath);
    this.javaList.delete(id);

    return true;
  }
}

const javaManager = new JavaManager();

InstanceSubsystem.on("open", (obj: { instanceUuid: string }) => {
  const instanceUuid = obj.instanceUuid;
  const config = InstanceSubsystem.getInstance(instanceUuid)?.config;
  if (!config) return;

  const javaId = config.java.id;
  if (!javaId) return;

  const java = javaManager.getJava(javaId);
  if (java && !java.usingInstances.includes(instanceUuid)) java.usingInstances.push(instanceUuid);
});

const handleStopInstance = (obj: { instanceUuid: string }) => {
  const instanceUuid = obj.instanceUuid;
  const config = InstanceSubsystem.getInstance(instanceUuid)?.config;
  if (!config) return;

  const javaId = config.java.id;
  if (!javaId) return;

  const java = javaManager.getJava(javaId);
  if (java && !java.usingInstances.includes(instanceUuid))
    java.usingInstances.filter((uuid) => uuid !== instanceUuid);
};

InstanceSubsystem.on("exit", handleStopInstance);
InstanceSubsystem.on("failure", handleStopInstance);

export default javaManager;
