import { randomBytes } from "crypto";
import Koa from "koa";
import session from "koa-session";
import { User } from "../entity/user";
import { credentialFingerprint } from "./security_fingerprint";
import { SecurityError, SessionError } from "./security_error";

type Payload = Record<string, any>;
type Entry = {
  id: string;
  revision: number;
  data: Payload;
  expires: number;
  uuid?: string;
  fingerprint?: string;
  providerAt?: number;
  requestTimes?: number[];
  requestBucket?: { credit: number; at: number };
};
type RequestState = {
  id: string;
  entry?: Entry;
  baseline: string;
  revision: number;
  create?: boolean;
  skipCookie?: boolean;
};
const owners = new WeakMap<Koa.Context, SessionStore>();
const copy = <T>(data: T): T => JSON.parse(JSON.stringify(data));
const id = () => randomBytes(32).toString("hex");
// Everything except this explicitly non-security bookkeeping participates in conflict checks.
function protectedData(data: Payload): string {
  const clean = { ...data };
  delete clean.SESSION_REQ_TIMES;
  delete clean._expire;
  delete clean._maxAge;
  return JSON.stringify(
    Object.keys(clean)
      .sort()
      .map((key) => [key, clean[key]])
  );
}
export function sessionStore(ctx: Koa.Context): SessionStore {
  const store = owners.get(ctx);
  if (!store) throw new SessionError(403, "Browser session required");
  return store;
}
export function liveBrowserUser(ctx: Koa.Context): User | undefined {
  return owners.get(ctx)?.user(ctx);
}
export function browserRequestAdmission(ctx: Koa.Context): boolean | undefined {
  const store = owners.get(ctx);
  // Anonymous newly generated sessions retain the existing per-request fallback.
  return store?.hasEntry(ctx) ? store.admitRequest(ctx) : undefined;
}
export class SessionStore {
  private readonly entries = new Map<string, Entry>();
  private readonly requests = new WeakMap<Koa.Context, RequestState>();
  private readonly timer: ReturnType<typeof setInterval>;
  public onSweep: (now: number) => void = () => {};
  public onDestroy: (entryId: string) => void = () => {};
  constructor(
    private readonly lookup: (uuid: string) => User | undefined,
    public readonly now: () => number = Date.now,
    private readonly limits = { total: 2048, anonymous: 1024, perUser: 10, bytes: 32768 }
  ) {
    this.timer = setInterval(() => this.sweep(), 60000);
    this.timer.unref();
  }
  close() {
    clearInterval(this.timer);
    for (const key of this.entries.keys()) this.drop(key);
  }
  get size() {
    this.sweep();
    return this.entries.size;
  }
  private drop(key: string) {
    if (this.entries.delete(key)) this.onDestroy(key);
  }
  revoke(uuid: string) {
    for (const [key, entry] of this.entries) if (entry.uuid === uuid) this.drop(key);
  }
  private valid(entry: Entry): boolean {
    const user = entry.uuid ? this.lookup(entry.uuid) : undefined;
    if (
      entry.expires <= this.now() ||
      (entry.uuid &&
        (!user || user.permission < 0 || credentialFingerprint(user) !== entry.fingerprint))
    ) {
      this.drop(entry.id);
      return false;
    }
    return this.entries.get(entry.id) === entry;
  }
  sweep() {
    for (const entry of this.entries.values()) this.valid(entry);
    this.onSweep(this.now());
  }
  private state(ctx: Koa.Context): RequestState {
    const state = this.requests.get(ctx);
    if (!state) throw new SessionError(403, "Browser session required");
    return state;
  }
  // genid is the sole admission capability for an anonymous record. No JSON field grants it.
  genid(ctx: Koa.Context): string {
    owners.set(ctx, this);
    const key = id();
    this.requests.set(ctx, { id: key, revision: 0, baseline: protectedData({}), create: true });
    return key;
  }
  async get(key: string, _age: unknown, { ctx }: { ctx: Koa.Context }) {
    owners.set(ctx, this);
    const entry = this.entries.get(key);
    if (!entry || !this.valid(entry)) return undefined;
    const data = copy(entry.data);
    if (entry.uuid) {
      const user = this.lookup(entry.uuid)!;
      data.userName = user.userName;
      data.role = user.permission === 10 ? 10 : 1;
      // Refresh the authoritative identity without trusting older request JSON.
      if (entry.data.userName !== data.userName || entry.data.role !== data.role) entry.revision++;
      entry.data.userName = data.userName;
      entry.data.role = data.role;
    }
    this.requests.set(ctx, {
      id: key,
      entry,
      revision: entry.revision,
      baseline: protectedData(data)
    });
    return { ...data, _expire: entry.expires };
  }
  private admit(entry: Entry, replacing?: Entry) {
    this.sweep();
    if (entry.uuid) {
      const own = Array.from(this.entries.values()).filter((e) => e.uuid === entry.uuid);
      while (own.length >= this.limits.perUser) this.drop(own.shift()!.id);
    } else if (
      Array.from(this.entries.values()).filter((e) => !e.uuid).length >= this.limits.anonymous
    ) {
      throw new SessionError(503, "Session capacity reached");
    }
    const replacesLiveEntry = replacing && this.entries.get(replacing.id) === replacing;
    if (this.entries.size - (replacesLiveEntry ? 1 : 0) >= this.limits.total)
      throw new SessionError(503, "Session capacity reached");
    if (replacesLiveEntry) this.drop(replacing!.id);
    this.entries.set(entry.id, entry);
  }
  private payload(ctx: Koa.Context): Payload {
    return copy(ctx.session?.toJSON() || {});
  }
  // Used before consuming SSO flow/binding data and before sensitive side effects.
  checkpoint(ctx: Koa.Context) {
    const state = this.state(ctx);
    const entry = state.entry;
    if (!entry || !this.valid(entry)) throw new SessionError(403, "Session expired; sign in again");
    if (entry.revision !== state.revision)
      throw new SessionError(409, "Session security state changed");
    const data = this.payload(ctx);
    delete data._expire;
    delete data._maxAge;
    this.checkSize(data);
    if (protectedData(data) !== state.baseline) entry.revision++;
    entry.data = data;
    state.baseline = protectedData(data);
    state.revision = entry.revision;
  }
  hasEntry(ctx: Koa.Context) {
    return !!this.requests.get(ctx)?.entry;
  }
  admitRequest(ctx: Koa.Context): boolean {
    const entry = this.requests.get(ctx)?.entry;
    if (!entry || !this.valid(entry)) return false;
    const now = this.now();
    if (entry.uuid) {
      // Six seconds of idle credit cover the default 20-card page and navigation.
      // Ordinary saves cannot reset this store-owned bucket; equal-clock calls debit it.
      // Millitokens avoid fractional drift: refill 8/sec, spend 1000, cap at 48.
      const bucket = entry.requestBucket ?? { credit: 48000, at: now };
      const at = Math.max(now, bucket.at); // clock rollback must not mint credit
      bucket.credit = Math.min(48000, bucket.credit + (at - bucket.at) * 8);
      bucket.at = at;
      entry.requestBucket = bucket;
      if (bucket.credit < 1000) return false;
      bucket.credit -= 1000;
      return true;
    }
    const times = (entry.requestTimes || []).filter((time) => now - time < 1000);
    entry.requestTimes = times;
    if (times.length >= 8) return false;
    times.push(now); // each call counts, including equal-millisecond requests
    return true;
  }
  user(ctx: Koa.Context): User | undefined {
    const entry = this.requests.get(ctx)?.entry;
    if (
      !entry?.uuid ||
      !this.valid(entry) ||
      ctx.session?.uuid !== entry.uuid ||
      ctx.session?.login !== true
    )
      return undefined;
    return this.lookup(entry.uuid);
  }
  identity(ctx: Koa.Context): string {
    if (!this.user(ctx)) throw new SessionError(403, "Browser session required");
    return this.state(ctx).id;
  }
  recentProvider(ctx: Koa.Context): boolean {
    const entry = this.state(ctx).entry;
    return (
      !!this.user(ctx) &&
      entry?.providerAt != null &&
      this.now() >= entry.providerAt &&
      this.now() - entry.providerAt <= 300000
    );
  }
  issue(ctx: Koa.Context, user: User, providerAt?: number): string {
    const state = this.state(ctx);
    if (state.entry) this.checkpoint(ctx);
    if (user.permission < 0 || this.lookup(user.uuid) !== user)
      throw new SessionError(403, "Account unavailable");
    const key = id();
    const token = id();
    const data = {
      login: true,
      uuid: user.uuid,
      userName: user.userName,
      role: user.permission === 10 ? 10 : 1,
      token
    };
    const entry: Entry = {
      id: key,
      revision: 0,
      data,
      uuid: user.uuid,
      fingerprint: credentialFingerprint(user),
      expires: this.now() + 86400000,
      providerAt
    };
    this.checkSize(data);
    this.admit(entry, state.entry);
    if (state.entry) this.drop(state.entry.id);
    this.requests.set(ctx, {
      id: key,
      entry,
      revision: entry.revision,
      baseline: protectedData(data)
    });
    ctx.session = copy(data) as any;
    return token;
  }
  logout(ctx: Koa.Context) {
    const state = this.requests.get(ctx);
    if (state) {
      this.drop(state.id);
      state.create = false;
      state.skipCookie = true;
    }
    ctx.session = null;
  }
  private checkSize(data: Payload) {
    if (Buffer.byteLength(JSON.stringify(data)) > this.limits.bytes)
      throw new SessionError(503, "Session state too large");
  }
  async set(_libraryKey: string, value: Payload, _age: unknown, { ctx }: { ctx: Koa.Context }) {
    const state = this.state(ctx);
    const data = copy(value);
    delete data._expire;
    delete data._maxAge;
    this.checkSize(data);
    let entry = state.entry;
    const changed = protectedData(data) !== state.baseline;
    if (!entry) {
      // Stateless API clients have no browser flow to retain. Preserve permission's
      // existing checks without filling anonymous capacity with rate bookkeeping.
      if (
        (ctx.query.apikey || ctx.get("x-request-api-key")) &&
        protectedData(data) === protectedData({})
      ) {
        state.skipCookie = true;
        return;
      }
      if (!state.create || data.login || data.uuid || data.token)
        throw new SessionError(403, "Session issuance required");
      entry = {
        id: state.id,
        revision: 0,
        data,
        expires: this.now() + 600000,
        requestTimes: Array.isArray(data.SESSION_REQ_TIMES)
          ? data.SESSION_REQ_TIMES.filter(
              (time: unknown) => typeof time === "number" && this.now() - time < 1000
            ).slice(-8)
          : []
      };
      this.admit(entry);
      state.entry = entry;
      state.create = false;
    } else {
      if (!this.valid(entry)) {
        state.skipCookie = true;
        if (changed) throw new SessionError(409, "Session revoked");
        return; // ordinary late bookkeeping never recreates a missing generation
      }
      if (changed) {
        if (entry.revision !== state.revision)
          throw new SessionError(409, "Session security state changed");
        entry.data = data;
        entry.revision++;
      } else {
        // Ordinary saves have no authority over protected data or admission counters.
        // Drop stale bookkeeping; request admission is atomic and store-owned.
      }
    }
    // Do not advance a stale ordinary request to a revision it never observed.
    if (changed) {
      state.baseline = protectedData(data);
      state.revision = entry.revision;
    }
  }
  async destroy(_key: string, { ctx }: { ctx: Koa.Context }) {
    this.logout(ctx);
  }
  cookieId(ctx: Koa.Context): string | undefined {
    const state = this.state(ctx);
    if (state.skipCookie || !state.entry || !this.valid(state.entry)) return undefined;
    return state.id;
  }
  cookieAge(ctx: Koa.Context) {
    return Math.max(0, this.state(ctx).entry!.expires - this.now());
  }
}

// Only documented hooks: identical store/externalKey contract in koa-session 6 and 7.
export function installSessions(app: Koa, store: SessionStore, key = id()) {
  if (!app.keys) app.keys = [id()];
  const cookie = { httpOnly: true, signed: true, overwrite: true, secure: false };
  app.use(async (ctx, next) => {
    try {
      await next();
    } catch (error) {
      if (!(error instanceof SecurityError)) throw error;
      if (error instanceof SessionError) {
        store.logout(ctx);
        ctx.cookies.set(key, "", { ...cookie, maxAge: 0 });
      }
      ctx.status = error.status;
      ctx.body = { status: error.status, data: error.message, time: store.now() };
    }
  });
  app.use(
    session(
      {
        key,
        maxAge: 86400000,
        ...cookie,
        rolling: false,
        renew: false,
        genid: ((ctx: Koa.Context) => store.genid(ctx)) as any,
        store: store as any,
        externalKey: {
          get: (ctx: Koa.Context) => ctx.cookies.get(key, cookie),
          set: (ctx: Koa.Context) => {
            const selected = store.cookieId(ctx);
            if (selected)
              ctx.cookies.set(key, selected, { ...cookie, maxAge: store.cookieAge(ctx) });
          }
        }
      },
      app
    )
  );
}
