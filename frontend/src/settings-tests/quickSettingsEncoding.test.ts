import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { mergeQuickSettings } from "@/tools/quickSettings";
import { toUnicode } from "@/tools/common";

// Execute the actual daemon source and installed serializer, isolating only i18n.
// Runtime loading keeps its separate TS project out of the frontend type graph.
const nodeRequire = createRequire(import.meta.url);
const compiler = nodeRequire("../../../panel/node_modules/typescript");
const sourcePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../daemon/src/entity/instance/process_config.ts"
);
const daemonRequire = createRequire(sourcePath);
const loaded = { exports: {} as Record<string, any> };
const emitted = compiler.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions: {
    module: compiler.ModuleKind.CommonJS,
    esModuleInterop: true,
    target: compiler.ScriptTarget.ES2022
  }
}).outputText;
new Function("require", "module", "exports", emitted)(
  (name: string) => (name === "../../i18n" ? { $t: (key: string) => key } : daemonRequire(name)),
  loaded,
  loaded.exports
);
const { ProcessConfig } = loaded.exports;

let directory: string | undefined;
afterEach(() => {
  if (directory) {
    const absolute = path.resolve(directory);
    if (
      !absolute.startsWith(path.resolve(os.tmpdir()) + path.sep) ||
      !path.basename(absolute).startsWith("nexcraft-quick-encoding-")
    )
      throw new Error("Unexpected test cleanup path");
    fs.rmSync(absolute, { recursive: true, force: true });
    directory = undefined;
  }
});
describe("Quick Settings real properties encoding", () => {
  it.each(["properties", "properties_not_unicode"])(
    "characterizes the inherited literal backslash-u corruption in actual %s writer",
    (format) => {
      directory = fs.mkdtempSync(path.join(os.tmpdir(), "nexcraft-quick-encoding-"));
      const filename = path.join(directory, "server.properties");
      const config = new ProcessConfig({
        fileName: "server.properties",
        path: filename,
        type: format,
        info: null,
        redirect: ""
      });
      // These old formats intentionally retain their bookmarked/client behavior.
      config.write({ "plugin-path": "C:\\users\\world", "literal-text": "literal \\u4e16 text" });
      expect(config.read()).toEqual({
        "plugin-path": "C:\u0000\\world",
        "literal-text": "literal 世 text"
      });
    }
  );
  it("fixes the shared native encoder without widening its intended ranges", () => {
    expect(toUnicode("世界 日本語 Ａ ︰ café 🙂 C:\\backups\\world")).toBe(
      "\\u4e16\\u754c \\u65e5\\u672c\\u8a9e \\uff21 \\ufe30 café 🙂 C:\\backups\\world"
    );
    expect(toUnicode("0 false \\n \\u4e16")).toBe("0 false \\n \\u4e16");
  });
  it.each([
    ["minecraft/java", "properties_lossless", true],
    ["minecraft/bedrock/bds", "properties_not_unicode_lossless", false]
  ] as const)(
    "round-trips %s unknown fresh values through actual ProcessConfig.write/read",
    (type, format, escaped) => {
      directory = fs.mkdtempSync(path.join(os.tmpdir(), "nexcraft-quick-encoding-"));
      const filename = path.join(directory, "server.properties");
      const config = new ProcessConfig({
        fileName: "server.properties",
        path: filename,
        type: format,
        info: null,
        redirect: ""
      });
      const baseline = { "max-players": 20, "level-name": "Old world", "server-name": "Old name" };
      const fresh = {
        ...baseline,
        "level-name": "世界 café 🙂",
        "server-name": "服务器 日本語 Ａ",
        "unknown-plugin-path": "C:\\backups\\世界\\save",
        "unknown-ascii-path": "C:\\backups\\new-folder",
        "windows-users-path": "C:\\users\\世界\\world",
        "literal-unicode-text": "literal \\u4e16 text",
        "literal\\u4e16": "literal key preserved",
        "literal-separator": "one = two = three",
        "odd = key": "value = stays literal",
        "unknown-message": "你好 🙂 \\ prefix",
        "unknown-number": 0,
        "unknown-boolean": false
      };
      const merged = mergeQuickSettings(type, baseline, fresh, { "max-players": "55" });
      // No frontend pre-encoding: the installed serializer owns all escaping.
      config.write(merged);
      const actual = fs.readFileSync(filename, "utf8");
      if (escaped) {
        expect(actual).toContain("\\u4e16\\u754c");
        expect(actual.split(/\r?\n/).find((line) => line.startsWith("level-name="))).not.toContain(
          "\\\\u4e16"
        );
      } else {
        expect(actual).toContain("世界 café 🙂");
        expect(actual).toContain("服务器 日本語 Ａ");
        expect(actual.split(/\r?\n/).find((line) => line.startsWith("level-name="))).not.toContain(
          "\\u4e16"
        );
      }
      expect(config.read()).toEqual({ ...fresh, "max-players": 55 });
      expect(config.read()["windows-users-path"]).not.toContain("\u0000");
      // The same parser reads all aliases, including files written by old clients.
      const legacyReader = new ProcessConfig({
        fileName: "server.properties",
        path: filename,
        type: escaped ? "properties" : "properties_not_unicode",
        info: null,
        redirect: ""
      });
      expect(legacyReader.read()).toEqual(config.read());
      // A second fresh merge/save must not add another layer of escaping.
      const reread = config.read();
      config.write(mergeQuickSettings(type, reread, reread, { "max-players": "56" }));
      expect(config.read()).toEqual({ ...fresh, "max-players": 56 });
      expect(
        fs
          .readFileSync(filename, "utf8")
          .split(/\r?\n/)
          .find((line) => line.startsWith("level-name="))
      ).not.toContain("\\\\u4e16");
      expect(fresh["level-name"]).toBe("世界 café 🙂");
    }
  );
  it("keeps legacy Java pre-encoded values compatible with legacy properties writes", () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "nexcraft-quick-encoding-"));
    const filename = path.join(directory, "server.properties");
    const config = new ProcessConfig({
      fileName: "server.properties",
      path: filename,
      type: "properties",
      info: null,
      redirect: ""
    });
    config.write({ motd: toUnicode("世界 🙂") });
    expect(config.read()).toEqual({ motd: "世界 🙂" });
  });
});
