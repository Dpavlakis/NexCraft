import net from "net";
import { resolveGameEndpoint } from "./game_endpoint";
import Instance from "../entity/instance/instance";
import logger from "./log";
import { buildLoginDisconnect, buildStatusResponse, parseHandshake } from "./wake_slp";

function isJava(instance: Instance): boolean {
  return String(instance.config?.type || "").includes("java");
}

class WakeListenerService {
  private servers = new Map<string, net.Server>();
  private wired = new Set<string>();
  private waking = new Set<string>();
  private refreshTimers = new Map<string, ReturnType<typeof setInterval>>();

  private suspensions = new Map<string, number>();
  private retryTimers = new Map<string, Set<ReturnType<typeof setTimeout>>>();
  private connections = new Map<string, Set<net.Socket>>();
  private closing = new Map<string, Set<Promise<void>>>();

  // Hold only this UUID off through validation and task cleanup.
  public async suspendForInstance(instance: Instance): Promise<() => void> {
    const uuid = instance.instanceUuid;
    this.suspensions.set(uuid, (this.suspensions.get(uuid) || 0) + 1);
    let released = false;
    const resume = () => {
      if (released) return;
      released = true;
      const remaining = (this.suspensions.get(uuid) || 1) - 1;
      if (remaining) this.suspensions.set(uuid, remaining);
      else this.suspensions.delete(uuid);
      this.applyForInstance(instance);
    };
    try {
      for (const socket of this.connections.get(uuid) || []) socket.destroy();
      this.closeListener(uuid);
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.all(this.closing.get(uuid) || []),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error("[wake] " + uuid + " listener close timed out")),
              1500
            );
          })
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
      return resume;
    } catch (error) {
      resume();
      throw error;
    }
  }

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
      !this.suspensions.has(uuid) &&
      !!cfg &&
      cfg.enabled &&
      cfg.wakeOnJoin &&
      isJava(instance) &&
      instance.status() === Instance.STATUS_STOP;
    if (shouldListen) {
      this.openListener(instance);
      if (!this.refreshTimers.has(uuid)) {
        const timer = setInterval(() => this.evaluate(instance), 3000);
        timer.unref();
        this.refreshTimers.set(uuid, timer);
      }
    } else {
      this.closeListener(uuid);
    }
  }

  private openListener(instance: Instance, attempt = 0) {
    const uuid = instance.instanceUuid;
    const cfg = instance.config?.sleepOnEmpty;
    if (
      this.suspensions.has(uuid) ||
      !cfg?.enabled ||
      !cfg.wakeOnJoin ||
      !isJava(instance) ||
      instance.status() !== Instance.STATUS_STOP
    )
      return;
    const port = resolveGameEndpoint(instance).port;
    const current = this.servers.get(uuid);
    const address = current?.address();
    if (port && address && typeof address !== "string" && address.port === port) return;
    if (current) this.closeListener(uuid);
    if (!port) return;

    const server = net.createServer((socket) => {
      if (this.suspensions.has(uuid) || this.servers.get(uuid) !== server) {
        socket.destroy();
        return;
      }
      const connections = this.connections.get(uuid) || new Set<net.Socket>();
      this.connections.set(uuid, connections);
      connections.add(socket);
      socket.once("close", () => {
        connections.delete(socket);
        if (!connections.size && this.connections.get(uuid) === connections)
          this.connections.delete(uuid);
      });
      socket.setTimeout(5000, () => socket.destroy());
      let buf = Buffer.alloc(0);
      let handled = false;
      socket.on("data", (chunk) => {
        try {
          if (this.suspensions.has(uuid)) {
            socket.destroy();
            return;
          }
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
      if (this.servers.get(uuid) !== server) return;
      this.servers.delete(uuid);
      if (
        attempt < 5 &&
        !this.suspensions.has(uuid) &&
        instance.status() === Instance.STATUS_STOP
      ) {
        const timers = this.retryTimers.get(uuid) || new Set<ReturnType<typeof setTimeout>>();
        this.retryTimers.set(uuid, timers);
        const timer = setTimeout(() => {
          timers.delete(timer);
          if (!timers.size && this.retryTimers.get(uuid) === timers) this.retryTimers.delete(uuid);
          this.openListener(instance, attempt + 1);
        }, 1000);
        timer.unref();
        timers.add(timer);
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
    if (this.suspensions.has(uuid) || this.waking.has(uuid)) return;
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
    for (const retry of this.retryTimers.get(uuid) || []) clearTimeout(retry);
    this.retryTimers.delete(uuid);
    const timer = this.refreshTimers.get(uuid);
    if (timer) clearInterval(timer);
    this.refreshTimers.delete(uuid);
    const s = this.servers.get(uuid);
    if (s) {
      this.servers.delete(uuid);
      const pending = this.closing.get(uuid) || new Set<Promise<void>>();
      this.closing.set(uuid, pending);
      const closed = new Promise<void>((resolve, reject) => {
        const done = (error?: Error) => {
          if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING")
            reject(error);
          else resolve();
        };
        try {
          s.close(done);
        } catch (error) {
          done(error as Error);
        }
      });
      pending.add(closed);
      closed
        .catch((error) =>
          logger.error("[wake] " + uuid + " listener close failed: " + error?.message)
        )
        .finally(() => {
          pending.delete(closed);
          if (!pending.size && this.closing.get(uuid) === pending) this.closing.delete(uuid);
        });
    }
  }
}

export default new WakeListenerService();
