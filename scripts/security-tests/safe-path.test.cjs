const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
require("../../daemon/node_modules/ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs", esModuleInterop: true, target: "ES2022" } });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "nexcraft-boundary-"));
after(() => fs.rmSync(temp, { recursive: true, force: true }));
const root = path.join(temp, "instance");
const outside = path.join(temp, "instance-sibling");
fs.mkdirSync(root); fs.mkdirSync(outside);
fs.writeFileSync(path.join(outside, "sentinel"), "untouched");
const { assertSafePath, validateWorldName } = require("../../daemon/src/utils/safe_path.ts");
// Stub daemon singletons only: all filesystem operations and archive I/O are real.
const load = Module._load;
let backupRoot = path.join(temp, "backups");
Module._load = function(request, parent, main) {
  if (request === "../i18n") return { $t: (s) => s, i18next: { language: "en" } };
  if (request === "./backup_service") return { backupDir: () => backupRoot };
  if (request === "./download_manager") return { downloadFromUrl: async () => { throw Error("network forbidden in test"); } };
  if (request === "mcsmanager-common") return {};
  if (request === "../entity/config" || request === "./config") return { globalConfiguration: { config: {} }, globalEnv: {} };
  if (request === "../common/compress") return {};
  if (request === "../service/log") return { info() {}, error() {} };
  if (request === "../service/upload_manager") return { delete() {} };
  return load.call(this, request, parent, main);
};
const world = require("../../daemon/src/service/world_service.ts");
const { readLevelName } = require("../../daemon/src/service/modpack_files.ts");
const FileManager = require("../../daemon/src/service/system_file.ts").default;
const FileWriter = require("../../daemon/src/entity/file_writer.ts").default;
const { setServerProperty } = require("../../daemon/src/service/mc_motd.ts");
Module._load = load;
const instance = { absoluteCwdPath: () => root, config: {}, instanceUuid: "test" };

test("portable basenames retain spaces/unicode and reject malicious names", () => {
  for (const name of ["world", "My World", "κόσμος 世界", "world_nether"]) assert.equal(validateWorldName(name), name);
  for (const name of ["", " ", ".", "..", "../world", "..\\world", "a/b", "a\\b", "/tmp", "C:\\world", "C:world", "\\\\host\\share", "a\0b", "world\nlevel-name=.."]) assert.throws(() => validateWorldName(name));
});
test("lexical boundaries, siblings, nonexistent children and native absolute paths", () => {
  assert.equal(assertSafePath(root, "new/nested/file"), path.join(root, "new/nested/file"));
  assert.equal(assertSafePath(root, root), root);
  assert.equal(assertSafePath(root, path.join(root, "file")), path.join(root, "file"));
  for (const target of ["../escape", "..\\escape", outside, "C:escape", "a\0b"]) assert.throws(() => assertSafePath(root, target));
});
test("real directory symlinks/junctions, linked root, leaf and dangling links", (t) => {
  const link = path.join(root, "link");
  fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
  for (const target of [link, path.join(link, "sentinel"), path.join(link, "new")]) assert.throws(() => assertSafePath(root, target));
  assert.throws(() => assertSafePath(link, link));
  const dangling = path.join(root, "dangling");
  fs.symlinkSync(path.join(temp, "missing"), dangling, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => assertSafePath(root, dangling));
  if (process.platform !== "win32") {
    fs.symlinkSync(path.join(outside, "sentinel"), path.join(root, "leaf"));
    assert.throws(() => assertSafePath(root, "leaf"));
  }
});
test("FileManager checks reads/writes/delete/download paths, allows cwd parents within root", async () => {
  const fm = new FileManager(root);
  if (fm.checkPath(outside)) {
    assert.equal(assertSafePath(root, fm.toAbsolutePath(outside)), fm.toAbsolutePath(outside));
    assert.notEqual(fm.toAbsolutePath(outside), outside);
  }
  for (const target of ["../escape", "..\\escape", "/../escape", "/../../escape", "\\..\\escape"])
    assert.equal(fm.checkPath(target), false);
  for (const operation of [() => fm.readFile("link/sentinel"), () => fm.writeFile("link/sentinel", "bad"), () => fm.delete("link"), () => fm.toAbsolutePath("link/sentinel")]) await assert.rejects(async () => operation());
  fs.mkdirSync(path.join(root, "sub")); fm.cd("sub");
  assert.equal(fm.toAbsolutePath("../normal.txt"), path.join(root, "normal.txt"));
  assert.equal(new FileManager("/").checkPath(outside), true);
});
test("frontend virtual paths work through real cd/list and preserve cwd-relative joins", async () => {
  fs.mkdirSync(path.join(root, "mods", "nested"), { recursive: true });
  fs.writeFileSync(path.join(root, "mods", "example.jar"), "mod");
  const initial = new FileManager(root);
  initial.cd("/");
  assert.equal((await initial.list(0)).absolutePath, root);
  assert.ok((await initial.list(0)).items.some((item) => item.name === "mods"));
  const mods = new FileManager(root);
  mods.cd("/mods/");
  const listing = await mods.list(0);
  assert.equal(listing.absolutePath, path.join(root, "mods"));
  assert.ok(listing.items.some((item) => item.name === "example.jar" && item.size === 3));
  assert.equal(mods.toAbsolutePath("/nested/"), path.join(root, "mods", "nested"));
  mods.cd("nested");
  mods.cd("..");
  assert.equal(mods.toAbsolutePath(), path.join(root, "mods"));
  assert.equal(mods.toAbsolutePath(path.join(root, "mods", "example.jar")), path.join(root, "mods", "example.jar"));
  assert.equal(initial.toAbsolutePath("/etc"), path.join(root, "etc"));
  assert.equal(initial.checkPath("/link/sentinel"), false);
  assert.equal(initial.checkPath("/dangling/new"), false);
  assert.equal(new FileManager("/").toAbsolutePath(outside), outside);
});

test("imported level-name fails at use, setters cannot bypass validation", () => {
  const properties = path.join(root, "server.properties");
  for (const value of ["../escape", "..\\escape", "", "/absolute"]) {
    fs.writeFileSync(properties, `level-name=${value}\n`);
    assert.throws(() => readLevelName(root));
    assert.throws(() => world.getActiveWorldPaths(root, "java", value));
    assert.throws(() => setServerProperty(instance, "level-name", value));
  }
  fs.writeFileSync(properties, "level-name=My World\n");
  assert.equal(readLevelName(root), "My World");
});
test("world placement and wipe reject linked destinations and nested linked sources", async () => {
  const source = path.join(temp, "source"); fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, "level.dat"), "test");
  await assert.rejects(world.placeWorld(source, root, "java", "link"));
  await assert.rejects(world.wipeActiveWorld(root, "java", "link"));
  fs.symlinkSync(outside, path.join(source, "linked-child"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(world.placeWorld(source, root, "java", "safe-world"));
  assert.equal(fs.readFileSync(path.join(outside, "sentinel"), "utf8"), "untouched");
});
test("chunk upload supports missing parents, existing files and rejects link swapped before init", { timeout: 5000 }, async () => {
  const dest = await FileWriter.getPath(root, "/uploads/new", "upload.bin", true);
  assert.equal(dest, path.join(root, "uploads", "new", "upload.bin"));
  await assert.rejects(FileWriter.getPath(root, "../escape", "upload.bin", true));
  await assert.rejects(FileWriter.getPath(root, "/link", "upload.bin", true));
  const writer = new FileWriter(instance, "upload.bin", 4, false, "utf8", dest);
  await writer.init(); await writer.write(0, Buffer.from("ab")); await writer.write(2, Buffer.from("cd"));
  // Completion releases the descriptor asynchronously.
  while (await require("../../daemon/node_modules/proper-lockfile").check(dest)) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(fs.readFileSync(dest, "utf8"), "abcd");
  const replacement = new FileWriter(instance, "upload.bin", 2, false, "utf8", dest);
  await replacement.init(); await replacement.write(0, Buffer.from("xy"));
  while (await require("../../daemon/node_modules/proper-lockfile").check(dest)) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(fs.readFileSync(dest, "utf8"), "xy");
  const pending = new FileWriter(instance, "later", 1, false, "utf8", path.join(root, "race", "later"));
  fs.symlinkSync(outside, path.join(root, "race"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(pending.init());
});
test("world backups are unique during one timestamp and produce real archives", async () => {
  fs.writeFileSync(path.join(root, "server.properties"), "level-name=backup-world\n");
  fs.mkdirSync(path.join(root, "backup-world")); fs.writeFileSync(path.join(root, "backup-world", "level.dat"), "world");
  const [a,b] = await Promise.all([world.backupActiveWorld(instance), world.backupActiveWorld(instance)]);
  assert.notEqual(a,b); assert.ok(fs.statSync(a).size > 0); assert.ok(fs.statSync(b).size > 0);
});

test("world archives reject nested links, and FileManager rejects recursive linked destinations", async () => {
  const linkedWorld = path.join(root, "linked-world"); fs.mkdirSync(linkedWorld);
  fs.symlinkSync(outside, path.join(linkedWorld, "nested"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(world.zipWorld(root, "java", "linked-world", path.join(root, "download.zip")));
  const fm = new FileManager(root);
  const source = path.join(root, "copy-source"); fs.mkdirSync(source); fs.writeFileSync(path.join(source, "test"), "test");
  await assert.rejects(fm.copy(source, linkedWorld));
  await assert.rejects(fm.zip("linked.zip", [linkedWorld]));
  assert.equal(fs.readFileSync(path.join(outside, "sentinel"), "utf8"), "untouched");
});
