import { isIP } from "net";
import { removeTrail } from "mcsmanager-common";
import { ManagerOptions, SocketOptions } from "socket.io-client";

export interface IPacket {
  uuid: string;
  status: number;
  event: string;
  data: any;
}

export interface IRequestPacket {
  uuid: string;
  data: any;
}

export interface IUser {
  uuid?: string;
  userName?: string;
  passWord?: string;
  salt?: string;
  permission?: number;
  registerTime?: string;
  loginTime?: string;
  instances?: Array<any>;
  isInit?: boolean;
  passWordType?: number;
  secret?: string;
  open2FA?: boolean;
  ssoSub?: string;
  ssoBound?: boolean;
  avatar?: string;
  theme?: string;
}

export interface ICompleteUser {
  uuid: string;
  userName: string;
  permission: number;
  instances: Array<any>;
  registerTime: string;
  loginTime: string;
}

type RemoteMappingEntry = {
  from: {
    ip: string;
    port: number;
    prefix: string;
  };
  to: {
    ip: string;
    port: number;
    prefix: string;
  };
};

export interface IRemoteService {
  gameHost?: string;
  uuid?: string;
  ip?: string;
  port?: number;
  prefix?: string;
  remarks?: string;
  apiKey?: string;
  remoteMappings?: RemoteMappingEntry[];
}

// @Entity
export class RemoteServiceConfig {
  public gameHost = "";
  public ip = "";
  public port = 24444;
  public prefix = "";
  public remarks = "";
  public apiKey = "";
  public remoteMappings: RemoteMappingEntry[] = [];

  connectOpts: Partial<SocketOptions & ManagerOptions> = {
    multiplex: false,
    reconnectionDelayMax: 1000 * 5,
    timeout: 1000 * 10,
    reconnection: true,
    reconnectionAttempts: 10,
    rejectUnauthorized: false
  };

  /**
   * To keep the remote mapping inside response consistent with other parts,
   * a simple conversion needs to be made.
   *
   * This is intentionally a method instead of a getter member, as the
   * conversion involves list operation.
   *
   * @returns converted remote mappings
   */
  public getConvertedRemoteMappings() {
    return this.remoteMappings.map((remote) => ({
      from: {
        addr: `${remote.from.ip}:${remote.from.port}`,
        prefix: remote.from.prefix
      },
      to: {
        addr: `${remote.to.ip}:${remote.to.port}`,
        prefix: remote.to.prefix
      }
    }));
  }

  /**
   * IP concatenated with port.
   */
  public get addr() {
    return `${this.ip}:${this.port}`;
  }

  /**
   * The prefix trimmed and removed trailing slash.
   */
  public get canonicalPrefix() {
    return removeTrail(this.prefix.trim(), "/");
  }

  /**
   * Full address containing IP, port and prefix.
   */
  public get fullAddr() {
    return this.addr + this.canonicalPrefix;
  }
}

/** A player-facing host only; never a URL, RPC port or arbitrary authority. */
export function normalizeGameHost(value: unknown): string {
  if (value === undefined || value === "") return "";
  if (
    typeof value !== "string" ||
    value.length > 253 ||
    /[\s\x00-\x20\x7f-\x9f/@\\?#%]/.test(value)
  )
    throw new Error("Player game host must be a hostname, IPv4 or IPv6 address without a port");
  let host = value;
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host.includes(":")) {
    if (isIP(host) !== 6) throw new Error("Invalid player IPv6 host");
    return new URL("http://[" + host + "]/").hostname.slice(1, -1);
  }
  if (value.includes("[") || value.includes("]")) throw new Error("Invalid player host");
  if (isIP(host) === 4) return host;
  if (
    /^[\d.]+$/.test(host) ||
    !host
      .replace(/\.$/, "")
      .split(".")
      .every((label) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label))
  )
    throw new Error("Invalid player hostname");
  return host.toLowerCase();
}
