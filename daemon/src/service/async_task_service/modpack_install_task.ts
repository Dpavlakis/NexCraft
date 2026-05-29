import axios from "axios";
import fs from "fs-extra";
import path from "path";
import { pipeline, Readable } from "stream";
import { v4 } from "uuid";
import { getCommonHeaders } from "../../common/network";
import Instance from "../../entity/instance/instance";
import InstanceConfig from "../../entity/instance/Instance_config";
import { $t } from "../../i18n";
import { ModloaderBootstrap, type ModLoader } from "../modloader_bootstrap";
import {
  downloadMrpackFiles,
  extractMrpackOverrides,
  extractZipOverwrite,
  maybeFlatten,
  parseMrpackIndex,
  resolveLoader
} from "../modpack_files";
import InstanceSubsystem from "../system_instance";
import { AsyncTask, IAsyncTaskJSON } from "./index";

export interface IModpackInstallDescriptor {
  source: "curseforge" | "modrinth";
  // CurseForge server-pack path:
  serverPackUrl?: string;
  serverPackFileName?: string;
  // Modrinth path:
  mrpackUrl?: string;
  // Metadata / bootstrap hints (panel supplies what it knows):
  mcVersion?: string;
  loader?: ModLoader;
  loaderVersion?: string;
  packInfo: IModpackInfo;
  maxMemoryMB?: number;
  acceptEula?: boolean;
  buildParams?: Partial<IGlobalInstanceConfig>;
}

export class ModpackInstallTask extends AsyncTask {
  public static TYPE = "ModpackInstallTask";

  public instance: Instance;
  public phase: "download" | "extract" | "files" | "bootstrap" | "done" = "download";
  public downloadProgress = {
    percentage: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    speed: 0,
    eta: 0
  };

  private isInitInstance = false;
  private abortController?: AbortController;
  private writeStream?: fs.WriteStream;
  private bootstrap?: ModloaderBootstrap;
  private tmpFiles: string[] = [];
  private lastProgressOutput = 0;

  constructor(
    public instanceName: string,
    public descriptor: IModpackInstallDescriptor,
    curInstance?: Instance
  ) {
    super();
    const config = new InstanceConfig();
    config.nickname = instanceName;
    config.stopCommand = "stop";
    config.type = "minecraft/java";
    if (descriptor.buildParams?.processType) config.processType = descriptor.buildParams.processType;
    if (descriptor.buildParams?.docker)
      config.docker = { ...config.docker, ...descriptor.buildParams.docker };

    if (!curInstance) {
      config.cwd = "";
      this.instance = InstanceSubsystem.createInstance(config);
      this.isInitInstance = true;
    } else {
      this.instance = curInstance;
      this.isInitInstance = false;
    }

    this.taskId = `${ModpackInstallTask.TYPE}-${this.instance.instanceUuid}-${v4()}`;
    this.type = ModpackInstallTask.TYPE;
  }

  // Download a single archive with byte-level progress (modeled on QuickInstallTask).
  private async downloadWithProgress(url: string, dest: string) {
    this.abortController = new AbortController();
    this.writeStream = fs.createWriteStream(dest);
    this.downloadProgress = { percentage: 0, downloadedBytes: 0, totalBytes: 0, speed: 0, eta: 0 };

    const response = await axios<Readable>({
      url,
      responseType: "stream",
      signal: this.abortController.signal,
      headers: getCommonHeaders(url),
      maxRedirects: 10
    });
    const contentLength = response.headers["content-length"];
    if (contentLength) this.downloadProgress.totalBytes = parseInt(`${contentLength}`);

    let lastTime = Date.now();
    let lastBytes = 0;
    response.data.on("data", (chunk: Buffer) => {
      this.downloadProgress.downloadedBytes += chunk.length;
      const now = Date.now();
      if (now - lastTime >= 1000) {
        this.downloadProgress.speed =
          (this.downloadProgress.downloadedBytes - lastBytes) / ((now - lastTime) / 1000);
        lastTime = now;
        lastBytes = this.downloadProgress.downloadedBytes;
      }
      if (this.downloadProgress.totalBytes > 0) {
        this.downloadProgress.percentage = Math.round(
          (this.downloadProgress.downloadedBytes / this.downloadProgress.totalBytes) * 100
        );
      }
      if (now - this.lastProgressOutput >= 1000) {
        const speed = `${(this.downloadProgress.speed / 1024 / 1024).toFixed(2)} MB/s`;
        this.instance.println(
          "INFO",
          $t("TXT_CODE_modpack.downloading", {
            percentage: this.downloadProgress.percentage,
            speed
          })
        );
        this.lastProgressOutput = now;
      }
    });

    await new Promise<void>((resolve, reject) => {
      pipeline(response.data, this.writeStream!, (err) => (err ? reject(err) : resolve()));
    });
    this.downloadProgress.percentage = 100;
  }

  private async installCurseForge(): Promise<{ mc: string; loader: ModLoader; loaderVersion: string }> {
    if (!this.descriptor.serverPackUrl) throw new Error($t("TXT_CODE_modpack.noServerPack"));
    const cwd = this.instance.absoluteCwdPath();
    const tmp = path.join(cwd, ".mcsm_serverpack.zip");
    this.tmpFiles.push(tmp);

    this.phase = "download";
    await this.downloadWithProgress(this.descriptor.serverPackUrl, tmp);

    this.phase = "extract";
    this.instance.println("INFO", $t("TXT_CODE_modpack.extracting"));
    await extractZipOverwrite(tmp, cwd);
    await maybeFlatten(cwd, [".mcsm_serverpack.zip"]);

    return {
      mc: this.descriptor.mcVersion || "",
      loader: this.descriptor.loader || "forge",
      loaderVersion: this.descriptor.loaderVersion || ""
    };
  }

  private async installModrinth(): Promise<{ mc: string; loader: ModLoader; loaderVersion: string }> {
    if (!this.descriptor.mrpackUrl) throw new Error($t("TXT_CODE_modpack.noMrpack"));
    const cwd = this.instance.absoluteCwdPath();
    const tmp = path.join(cwd, ".mcsm_modpack.mrpack");
    this.tmpFiles.push(tmp);

    this.phase = "download";
    await this.downloadWithProgress(this.descriptor.mrpackUrl, tmp);

    this.phase = "files";
    const index = await parseMrpackIndex(tmp);
    const { loader, loaderVersion } = resolveLoader(index.dependencies || {});
    const mc = index.dependencies?.["minecraft"] || this.descriptor.mcVersion || "";

    await downloadMrpackFiles(index, cwd, (done, total) => {
      this.downloadProgress.percentage = total ? Math.round((done / total) * 100) : 0;
      const now = Date.now();
      if (now - this.lastProgressOutput >= 1000) {
        this.instance.println("INFO", $t("TXT_CODE_modpack.files", { done, total }));
        this.lastProgressOutput = now;
      }
    });
    this.instance.println("INFO", $t("TXT_CODE_modpack.extracting"));
    await extractMrpackOverrides(tmp, cwd);

    return { mc, loader, loaderVersion };
  }

  async onStart() {
    const inst = this.instance;
    inst.print("\n");
    if (
      inst.config.processType === "docker" &&
      this.descriptor.buildParams?.processType !== "docker"
    ) {
      // modpack bootstrap runs java on the host; docker-mode is a follow-up
      inst.println("WARN", $t("TXT_CODE_modpack.dockerWarn"));
    }
    try {
      inst.status(Instance.STATUS_BUSY);
      if (this.isInitInstance) {
        if (inst.asynchronousTask) throw new Error($t("TXT_CODE_5b0e93b5"));
        inst.asynchronousTask = this;
      }
      inst.println("INFO", $t("TXT_CODE_modpack.start"));

      const resolved =
        this.descriptor.source === "curseforge"
          ? await this.installCurseForge()
          : await this.installModrinth();

      // Accept the Minecraft EULA on the user's behalf (they checked the box).
      if (this.descriptor.acceptEula) {
        try {
          fs.writeFileSync(path.join(inst.absoluteCwdPath(), "eula.txt"), "eula=true\n");
        } catch {
          // ignore
        }
      }

      this.phase = "bootstrap";
      this.bootstrap = new ModloaderBootstrap({
        instance: inst,
        mcVersion: resolved.mc,
        loader: resolved.loader,
        loaderVersion: resolved.loaderVersion,
        maxMemoryMB: this.descriptor.maxMemoryMB
      });
      const { startCommand } = await this.bootstrap.run();

      inst.parameters(
        {
          startCommand,
          stopCommand: "stop",
          packInfo: {
            ...this.descriptor.packInfo,
            mcVersion: resolved.mc,
            loader: resolved.loader,
            loaderVersion: resolved.loaderVersion,
            installedAt: Date.now()
          }
        },
        true
      );

      this.phase = "done";
      inst.println("INFO", $t("TXT_CODE_modpack.installDone"));
      this.stop();
    } catch (error: any) {
      this.error(error);
    } finally {
      inst.status(Instance.STATUS_STOP);
      if (this.isInitInstance && inst.asynchronousTask === this) inst.asynchronousTask = undefined;
      for (const f of this.tmpFiles) {
        try {
          await fs.remove(f);
        } catch {
          // ignore
        }
      }
    }
  }

  async onStop() {
    try {
      this.abortController?.abort();
      this.writeStream?.destroy();
      this.bootstrap?.cancel();
      this.abortController = undefined;
      this.writeStream = undefined;
    } catch {
      // ignore
    }
  }

  async onError(err: Error) {
    this.instance.println("ERROR", err?.message);
  }

  toObject(): IAsyncTaskJSON {
    return JSON.parse(
      JSON.stringify({
        taskId: this.taskId,
        status: this.status(),
        instanceUuid: this.instance.instanceUuid,
        instanceStatus: this.instance.status(),
        instanceConfig: this.instance.config,
        phase: this.phase,
        downloadProgress: this.downloadProgress
      })
    );
  }
}

export function createModpackInstallTask(
  instanceName: string,
  descriptor: IModpackInstallDescriptor
) {
  const task = new ModpackInstallTask(instanceName, descriptor);
  return task;
}
