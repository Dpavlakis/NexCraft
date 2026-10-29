import { IStorage } from "./storage_interface";
import { StorageSubsystem } from "mcsmanager-common";
import fs from "fs-extra";
import path from "path";
import { randomBytes } from "crypto";
import { UserWriteError } from "../../service/security_error";
const storage = new StorageSubsystem();
class FileStorageSubsystemAdapter implements IStorage {
  public async store(category: string, uuid: string, object: any) {
    if (category !== "User") return storage.store(category, uuid, object);
    if (!uuid || /[\\/]/.test(uuid) || uuid.includes("..")) throw new UserWriteError(true);
    const directory = path.join(StorageSubsystem.DATA_PATH, "User");
    const temporary = path.join(directory, uuid + "." + randomBytes(12).toString("hex") + ".tmp");
    try {
      const data = JSON.stringify(object, null, 4);
      await fs.ensureDir(directory);
      await fs.writeFile(temporary, data, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await fs.rename(temporary, path.join(directory, uuid + ".json"));
    } catch {
      await fs.remove(temporary).catch(() => {});
      throw new UserWriteError(true);
    }
  }
  public async load(category: string, classz: any, uuid: string) {
    return storage.load(category, classz, uuid);
  }
  public async list(category: string) {
    if (category !== "User") return storage.list(category);
    const directory = path.join(StorageSubsystem.DATA_PATH, "User");
    await fs.ensureDir(directory);
    return (await fs.readdir(directory))
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -5));
  }
  public async delete(category: string, uuid: string) {
    return storage.delete(category, uuid);
  }
}
export default new FileStorageSubsystemAdapter();
