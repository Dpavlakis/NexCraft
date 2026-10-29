import { IStorage } from "../common/storage/storage_interface";
import bcrypt from "bcryptjs";
import { t } from "i18next";
import { LocalFileSource, QueryWrapper } from "mcsmanager-common";
import md5 from "md5";
import { authenticator } from "otplib";
import { v4 } from "uuid";
import Storage from "../common/storage/sys_storage";
import { IUser } from "../entity/entity_interface";
import { IUserApp, User, UserPassWordType } from "../entity/user";
import { $t } from "../i18n";
import { logger } from "./log";
import { credentialFingerprint } from "./security_fingerprint";
import { SecurityError, UserWriteError } from "./security_error";
import { userOperation } from "./user_operations";

// Avatars are stored as small base64 data URLs on the user record. Reject
// anything that is not an image data URL or exceeds the size cap (~256 KB
// binary ≈ 400k base64 chars). Empty string clears the avatar.
const AVATAR_DATA_URL_RE = /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/=]+$/;
const AVATAR_MAX_LEN = 400_000;
export function validateAvatarString(avatar: string): void {
  if (avatar === "") return;
  if (
    typeof avatar !== "string" ||
    avatar.length > AVATAR_MAX_LEN ||
    !AVATAR_DATA_URL_RE.test(avatar)
  ) {
    throw new Error($t("TXT_CODE_avatar.invalid"));
  }
}

// Known theme ids — kept in sync with the frontend registry
// (frontend/src/config/themes.ts). The panel can't import frontend code, so
// this list is duplicated intentionally; update both when adding a theme.
const THEME_IDS = ["nexcraft", "crafty", "nether", "emerald", "amethyst", "diamond"];
export function isValidThemeId(id: string): boolean {
  return THEME_IDS.includes(id);
}

export class TwoFactorError extends Error {}

class UserSubsystem {
  public readonly objects: Map<string, User> = new Map();

  public onSecurityChange: (uuid: string) => void = () => {};
  private readonly quarantined = new Map<string, IStorage>();

  async initialize() {
    for (const uuid of await Storage.getStorage().list("User")) {
      const user = (await Storage.getStorage().load("User", User, uuid)) as User;
      if (!user || user.uuid !== uuid || !user.passWord || (user.open2FA && !user.secret))
        throw new Error("Invalid committed user record");
      this.objects.set(uuid, user);
    }
    logger.info($t("TXT_CODE_systemUser.userCount", { n: this.objects.size }));
  }

  async create(config: IUser): Promise<User> {
    const newUuid = v4().replace(/-/gim, "");
    // Initialize necessary user data
    const instance = new User();
    instance.uuid = newUuid;
    instance.registerTime = new Date().toLocaleString();
    // add to the user system
    this.setInstance(newUuid, instance);
    try {
      await this.edit(instance.uuid, config);
    } catch (error) {
      this.objects.delete(newUuid);
      throw error;
    }
    // Persistently save user information
    return this.getInstance(newUuid)!;
  }

  // All persistent User writers share this narrow operation boundary.
  async withUser<T>(
    uuid: string,
    work: (user: User, save: (config: any) => Promise<void>) => Promise<T>
  ): Promise<T> {
    return userOperation(uuid, async () => {
      const backend = this.quarantined.get(uuid) || Storage.getStorage();
      if (this.quarantined.has(uuid)) {
        try {
          const loaded = await backend.load("User", User, uuid);
          if (loaded == null) {
            // A successful authoritative read can confirm an uncertain deletion.
            this.objects.delete(uuid);
            this.quarantined.delete(uuid);
          } else if (loaded.uuid !== uuid || !loaded.passWord || (loaded.open2FA && !loaded.secret))
            throw new Error("Invalid user record");
          else {
            this.objects.set(uuid, loaded);
            this.quarantined.delete(uuid);
          }
        } catch {
          throw new SecurityError(503, "Account persistence unavailable");
        }
      }
      const current = this.getInstance(uuid);
      if (!current) throw new SecurityError(403, "Account unavailable");
      return work(current, (config) => this.persistEdit(uuid, config, backend));
    });
  }
  async recoverAuthentication(uuid: string): Promise<void> {
    if (this.quarantined.has(uuid)) await this.withUser(uuid, async () => {});
  }
  async edit(uuid: string, config: any) {
    if (!this.objects.has(uuid)) return;
    return this.withUser(uuid, async (_user, save) => save(config));
  }
  private async persistEdit(uuid: string, config: any, backend: IStorage) {
    const original = this.getInstance(uuid)!;
    const instance: User = Object.assign(new User(), JSON.parse(JSON.stringify(original)));
    if (config.userName) instance.userName = config.userName;
    if (config.isInit != null) instance.isInit = Boolean(config.isInit);
    if (config.permission) instance.permission = config.permission;
    if (config.registerTime) instance.registerTime = config.registerTime;
    if (config.loginTime) instance.loginTime = config.loginTime;
    if (config.apiKey != null) instance.apiKey = config.apiKey;
    if (config.secret != null) instance.secret = String(config.secret);
    if (config.open2FA != null) instance.open2FA = Boolean(config.open2FA);
    if (config.ssoSub != null) instance.ssoSub = String(config.ssoSub);
    if (config.ssoBound != null) instance.ssoBound = Boolean(config.ssoBound);
    if (config.avatar != null) {
      validateAvatarString(String(config.avatar));
      instance.avatar = String(config.avatar);
    }
    if (config.theme != null) {
      const themeId = String(config.theme);
      if (themeId === "" || isValidThemeId(themeId)) instance.theme = themeId;
    }
    if (config.instances) {
      config.instances.forEach((value: IUserApp) => {
        if (!value.daemonId || !value.instanceUuid) throw new Error("Invalid user instance");
      });
      instance.instances = config.instances.map((value: IUserApp) => ({
        instanceUuid: String(value.instanceUuid),
        daemonId: String(value.daemonId)
      }));
    }
    if (config.passWord) {
      instance.passWordType = UserPassWordType.bcrypt;
      instance.passWord = bcrypt.hashSync(config.passWord, 10);
    }

    try {
      await backend.store("User", uuid, instance);
    } catch (error) {
      if (!(error instanceof UserWriteError && error.definite)) {
        this.quarantined.set(uuid, backend);
        this.onSecurityChange(uuid);
      }
      throw new SecurityError(503, "Account persistence unavailable");
    }
    this.objects.set(uuid, instance);
    if (credentialFingerprint(original) !== credentialFingerprint(instance))
      this.onSecurityChange(uuid);
  }

  validatePassword(password = "") {
    if (password.length < 9 || password.length > 36) return false;
    const reg = /(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])/;
    return reg.test(password);
  }

  check2FA(code: string, user: IUser, totpDriftToleranceSteps: number = 0) {
    if (!user.secret)
      throw new Error("Please contact the administrator to reset the account password");
    const isolated = authenticator.clone({ window: totpDriftToleranceSteps });
    const delta = isolated.checkDelta(code, user.secret);
    return delta != null;
  }

  checkUser(info: IUser, code2FA?: string, totpDriftToleranceSteps: number = 0) {
    const inputPassword = info.passWord || "";
    for (const [uuid, user] of this.objects) {
      if (user.userName === info.userName) {
        if (
          user.open2FA &&
          user.secret &&
          !this.check2FA(code2FA || "", user, totpDriftToleranceSteps)
        )
          throw new TwoFactorError(t("TXT_CODE_3d68e43b"));
        if (user.passWordType === UserPassWordType.bcrypt) {
          if (!bcrypt.compareSync(inputPassword, user.passWord))
            throw new Error($t("TXT_CODE_fefbb457"));
        } else {
          if (!(md5(inputPassword) === user.passWord)) throw new Error($t("TXT_CODE_fefbb457"));
        }
      }
    }
  }

  existUserName(userName: string): boolean {
    let flag = false;
    this.objects.forEach((user) => {
      if (user.userName === userName) return (flag = true);
    });
    return flag;
  }

  async setUserInstances(uuid: string, instanceIds: IUserApp[]) {
    await this.edit(uuid, { instances: instanceIds });
  }
  async deleteUserInstances(uuid: string | null, instanceIds: IUserApp[], allUsers = false) {
    if (uuid && allUsers) throw new Error("The uuid and allUsers cannot both be set");
    const uuids = allUsers ? Array.from(this.objects.keys()) : uuid ? [uuid] : [];
    for (const userUuid of uuids) {
      await this.withUser(userUuid, async (user, save) => {
        instanceIds.forEach((value) => {
          if (!value.daemonId || !value.instanceUuid) throw new Error("Invalid user instance");
        });
        await save({
          instances: user.instances.filter(
            (value) =>
              !instanceIds.some(
                (instance) =>
                  instance.daemonId === value.daemonId &&
                  instance.instanceUuid === value.instanceUuid
              )
          )
        });
      });
    }
  }

  getUserByUserName(userName: string) {
    for (const map of this.objects) {
      const user = map[1];
      if (user.userName === userName && !this.quarantined.has(user.uuid)) return user;
    }
    return null;
  }

  getUserByUuid(uuid: string) {
    return this.getInstance(uuid) || null;
  }

  getInstance(uuid: string) {
    return this.quarantined.has(uuid) ? undefined : this.objects.get(uuid);
  }

  setInstance(uuid: string, object: User) {
    this.objects.set(uuid, object);
  }

  hasInstance(uuid: string) {
    return this.objects.has(uuid);
  }

  async deleteInstance(uuid: string) {
    return userOperation(uuid, async () => {
      const wasQuarantined = this.quarantined.has(uuid);
      const backend = this.quarantined.get(uuid) || Storage.getStorage();
      this.onSecurityChange(uuid);
      // Fence new authentication while deletion is in flight, as well as on lost ack.
      this.quarantined.set(uuid, backend);
      try {
        await backend.delete("User", uuid);
      } catch (error) {
        if (error instanceof UserWriteError && error.definite && !wasQuarantined)
          this.quarantined.delete(uuid);
        throw new SecurityError(503, "Account deletion could not be confirmed");
      }
      this.objects.delete(uuid);
      this.quarantined.delete(uuid);
    });
  }

  getUserBySsoSub(ssoSub: string): User | null {
    for (const [, user] of this.objects) {
      if (user.ssoSub && user.ssoSub === ssoSub && !this.quarantined.has(user.uuid)) return user;
    }
    return null;
  }

  async unbindSso(uuid: string) {
    await this.edit(uuid, { ssoSub: "", ssoBound: false });
  }
  async unbindAllSso(): Promise<number> {
    let count = 0;
    for (const [uuid, user] of this.objects) {
      if (user.ssoBound || user.ssoSub) {
        await this.unbindSso(uuid);
        count++;
      }
    }
    return count;
  }
  async bindSso(uuid: string, ssoSub: string) {
    await this.edit(uuid, { ssoSub, ssoBound: true });
  }

  getQueryWrapper() {
    return new QueryWrapper(
      new LocalFileSource<User>(
        new Map(Array.from(this.objects).filter(([uuid]) => !this.quarantined.has(uuid)))
      )
    );
  }
}

export default new UserSubsystem();
