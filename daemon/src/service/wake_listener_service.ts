import net from "net";
import fs from "fs-extra";
import path from "path";
import Instance from "../entity/instance/instance";
import logger from "./log";
import { buildLoginDisconnect, buildStatusResponse, parseHandshake } from "./wake_slp";

function isJava(instance: Instance): boolean {
  return String(instance.config?.type || "").includes("java");
}

// Resolve the Java server's TCP port: prefer pingConfig.port, else server.properties.
function resolvePort(instance: Instance): number {
  const p = Number(instance.config?.pingConfig?.port);
  if (p && p > 0) return p;
  try {
    const file = path.join(instance.absoluteCwdPath(), "server.properties");
    if (fs.existsSync(file)) {
      const txt = fs.readFileSync(file, "utf-8");
      const m = txt.match(/^server-port\s*=\s*(\d+)/m);
      if (m) return Number(m[1]);
    }
  } catch {
    // ignore
  }
  return 25565;
}

class WakeListenerService {
  private servers = new Map<string, net.Server>();
  private wired = new Set<string>();
  private waking = new Set<string>();

  // Wire lifecycle hooks once, then evaluate current state.
  public applyForInstance(instance: Instance) {
    const uuid = instance.instanceUuid;
    if (!this.wired.has(uuid)) {
      this.wired.add(uuid);
      // When the server starts, free the port for the real server.
      instance.on("open", () => this.closeListener(uuid));
      // When the server stops, (re)open the wake listener if applicable.
      instance.on("exit", () => {
        this.waking.delete(uuid);
        this.evaluate(instance);
      });
    }
    this.evaluate(instance);
  }

  // Open or close the listener to match current status + config.
  private evaluate(instance: Instance) {
    const uuid = instance.instanceUuid;
    const cfg = instance.config?.sleepOnEmpty;
    const shouldListen =
      !!cfg &&
      cfg.enabled &&
      cfg.wakeOnJoin &&
      isJava(instance) &&
      instance.status() === Instance.STATUS_STOP;
    if (shouldListen) {
      this.openListener(instance);
    } else {
      this.closeListener(uuid);
    }
  }

  private openListener(instance: Instance, attempt = 0) {
    const uuid = instance.instanceUuid;
    if (this.servers.has(uuid)) return; // already open
    const port = resolvePort(instance);

    const server = net.createServer((socket) => {
      socket.setTimeout(5000, () => socket.destroy());
      let buf = Buffer.alloc(0);
      let handled = false;
      socket.on("data", (chunk) => {
        try {
          buf = Buffer.concat([buf, chunk]);
          if (buf.length > 4096) {
            socket.destroy();
            return;
          }
          if (handled) return;
          const hs = parseHandshake(buf);
          if (!hs) return; // wait for more
          handled = true;
          const motd = instance.config?.sleepOnEmpty?.wakeMotd || "Server is waking up...";
          if (hs.nextState === 2) {
            // Login attempt -> send a disconnect carrying the wake message.
            socket.write(buildLoginDisconnect(motd));
          } else {
            // Status ping -> respond with a "Sleeping" status showing the MOTD.
            socket.write(buildStatusResponse({ motd, protocol: hs.protocolVersion }));
          }
          // Wake regardless of state, then free the port and close.
          this.triggerWake(instance);
          socket.end();
        } catch (e: any) {
          socket.destroy();
        }
      });
      socket.on("error", () => socket.destroy());
    });

    server.on("error", (err: any) => {
      // Port likely still releasing from the previous run; retry a few times.
      this.servers.delete(uuid);
      if (attempt < 5 && instance.status() === Instance.STATUS_STOP) {
        setTimeout(() => this.openListener(instance, attempt + 1), 1000);
      } else {
        logger.warn(`[wake] ${uuid} listener bind failed on :${port}: ${err?.message ?? err}`);
      }
    });

    server.listen(port, () => {
      logger.info(`[wake] ${uuid} listening on :${port} (asleep)`);
    });
    this.servers.set(uuid, server);
  }

  private triggerWake(instance: Instance) {
    const uuid = instance.instanceUuid;
    if (this.waking.has(uuid)) return;
    this.waking.add(uuid);
    logger.info(`[wake] ${uuid} connection received — waking`);
    // Free the port FIRST so the real server can bind, then start.
    this.closeListener(uuid);
    instance.execPreset("start").catch((e) => {
      logger.error(`[wake] ${uuid} start failed: ${e?.message ?? e}`);
      this.waking.delete(uuid);
      // start failed -> instance stays STOPPED; reopen to catch the next attempt.
      this.evaluate(instance);
    });
  }

  public closeListener(uuid: string) {
    const s = this.servers.get(uuid);
    if (s) {
      try {
        s.close();
      } catch {}
      this.servers.delete(uuid);
    }
  }
}

export default new WakeListenerService();
