import { describe, expect, it, vi } from "vitest";
import {
  createQuickSettings,
  mergeQuickSettings,
  quickEdition,
  quickFields,
  quickValidation,
  QuickConflict,
  type QuickTarget
} from "@/tools/quickSettings";

const java = "minecraft/java";
const bedrock = "minecraft/bedrock/bds";
const original = () => ({
  gamemode: 0,
  difficulty: "0",
  pvp: "false",
  "white-list": false,
  "max-players": 20,
  "view-distance": 10,
  "simulation-distance": 10,
  motd: "Hello 世界",
  "server-port": 25565,
  "level-seed": "<__long__>9223372036854775807"
});
const target = (uuid = "alpha", type = java): QuickTarget => ({ uuid, daemonId: "node-a", type });
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const setup = () => {
  const deps = {
    readType: vi.fn(async (context: QuickTarget, _signal: AbortSignal) => context.type),
    read: vi.fn(
      async (_context: QuickTarget, _signal: AbortSignal): Promise<unknown> => original()
    ),
    write: vi.fn(async (_context: QuickTarget, _data: unknown): Promise<unknown> => true),
    confirm: vi.fn(async () => true)
  };
  return { deps, model: createQuickSettings(deps) };
};

describe("Quick Settings capabilities and representation", () => {
  it.each([
    "universal",
    "universal/mcdr",
    "minecraft/bedrock/nukkit",
    "minecraft/java/velocity",
    "minecraft/java/bungeecord",
    "minecraft/java/geyser",
    "minecraft/javaish"
  ])("does not invent native support for %s", (type) => {
    expect(quickEdition(type)).toBeUndefined();
    expect(quickFields(type, original())).toEqual([]);
  });
  it.each([java, "minecraft/java/paper", "minecraft/java/forge", "minecraft/java/fabric"])(
    "offers present Java fields for %s",
    (type) => {
      const fields = quickFields(type, original());
      expect(fields).toHaveLength(7);
      expect(fields.find((field) => field.key === "gamemode")?.value).toBe("survival");
      expect(fields.find((field) => field.key === "difficulty")?.value).toBe("peaceful");
      expect(fields.find((field) => field.key === "pvp")?.value).toBe(false);
    }
  );
  it("requires own file keys and hides absent/unsupported properties", () => {
    const file = Object.assign(Object.create({ pvp: true }), {
      difficulty: "hard",
      gamemode: "custom",
      "view-distance": "<__float__>10.5"
    });
    expect(quickFields(java, file).map((field) => field.key)).toEqual(["difficulty"]);
    expect(quickFields(java, { "white-list": "false" })[0].value).toBe(false);
  });
  it.each(["minecraft/bedrock", bedrock])(
    "maps native Bedrock fields for %s without PvP or spectator",
    (type) => {
      const fields = quickFields(type, { ...original(), "allow-list": "0", "tick-distance": 4 });
      expect(fields.map((field) => field.key)).toEqual([
        "gamemode",
        "difficulty",
        "allow-list",
        "max-players",
        "view-distance",
        "tick-distance"
      ]);
      expect(quickFields(type, { gamemode: "spectator" })).toEqual([]);
      expect(quickFields(type, { gamemode: 3 })).toEqual([]);
      expect(() =>
        mergeQuickSettings(type, { pvp: true }, { pvp: true }, { pvp: false })
      ).toThrow();
    }
  );
  it.each([false, "false", "FALSE", "0", 0])(
    "preserves false representation %s on change",
    (value) => {
      const file = { pvp: value };
      const on = mergeQuickSettings(java, file, file, { pvp: true });
      const expected =
        value === false
          ? true
          : value === 0
          ? 1
          : value === "0"
          ? "1"
          : value === "FALSE"
          ? "TRUE"
          : "true";
      expect(on.pvp).toBe(expected);
    }
  );
  it("preserves numeric enum zero and numeric-string formats", () => {
    const file = original();
    const changed = mergeQuickSettings(java, file, file, {
      gamemode: "spectator",
      difficulty: "easy"
    });
    expect(changed.gamemode).toBe(3);
    expect(changed.difficulty).toBe("1");
    expect(
      mergeQuickSettings(java, changed, changed, { gamemode: "survival", difficulty: "peaceful" })
    ).toMatchObject({ gamemode: 0, difficulty: "0" });
  });
  it("merges only approved edited keys into the fresh file, preserving unknown values", () => {
    const file = original();
    const fresh = {
      ...file,
      motd: "Changed 中文",
      "server-port": 25566,
      "new-plugin-key": { enabled: true },
      "white-list": true
    };
    const merged = mergeQuickSettings(java, file, fresh, { difficulty: "hard" });
    expect(merged).toEqual({ ...fresh, difficulty: "3" });
    expect(file.difficulty).toBe("0");
    expect(fresh.difficulty).toBe("0");
    expect(() => mergeQuickSettings(java, file, fresh, { "server-port": "12345" })).toThrow();
  });
  it("keeps unknown Java strings literal in the raw merge for the lossless formatter", () => {
    const file = {
      motd: "世界 café 🙂",
      "level-name": "世界",
      "unknown-key": "C:\\backups\\world",
      pvp: false
    };
    expect(mergeQuickSettings(java, { ...file, pvp: false }, file, { pvp: true })).toEqual({
      ...file,
      pvp: true
    });
    expect(file["level-name"]).toBe("世界");
  });
  it("keeps fresh unknown Bedrock world/server names and unrelated Unicode as UTF-8", () => {
    const file = { "max-players": 20, "level-name": "旧世界", "server-name": "旧服务器" };
    const fresh = {
      ...file,
      "level-name": "新世界 café 🙂",
      "server-name": "服务器 日本語",
      extension: "世界"
    };
    const merged = mergeQuickSettings(bedrock, file, fresh, { "max-players": "45" });
    expect(merged).toEqual({ ...fresh, "max-players": 45 });
    expect(JSON.stringify(merged)).not.toContain("\\u");
  });
  it.each([{}, { ...original(), difficulty: "normal" }])(
    "rejects removed or concurrently changed dirty fields",
    (fresh) => {
      try {
        mergeQuickSettings(java, original(), fresh, { difficulty: "hard" });
        throw new Error("expected conflict");
      } catch (error) {
        expect(error).toBeInstanceOf(QuickConflict);
        expect((error as QuickConflict).keys).toEqual(["difficulty"]);
      }
    }
  );
  it.each(["", "1.5", "1e2", "NaN", "4x", "<__float__>1.5"])(
    "rejects invalid integer %s",
    (value) => {
      const field = quickFields(java, original()).find((field) => field.key === "max-players")!;
      expect(quickValidation(java, field, value)).toBe("integer");
    }
  );
  it.each(["0", "-1"])("rejects nonpositive max players %s", (value) => {
    const field = quickFields(java, original()).find((field) => field.key === "max-players")!;
    expect(quickValidation(java, field, value)).toBe("positive");
  });
  it("sets no player upper cap and retains lossless long integer representation", () => {
    const file = { "max-players": "<__long__>9223372036854775807" };
    const field = quickFields(java, file)[0];
    expect(field.value).toBe("9223372036854775807");
    expect(quickValidation(java, field, "99999999999999999999999999")).toBeUndefined();
    expect(
      mergeQuickSettings(java, file, file, { "max-players": "99999999999999999999999999" })[
        "max-players"
      ]
    ).toBe("<__long__>99999999999999999999999999");
  });
  it.each([
    [bedrock, "view-distance", "4", "bedrockView"],
    [bedrock, "view-distance", "5", undefined],
    [bedrock, "tick-distance", "3", "bedrockSimulation"],
    [bedrock, "tick-distance", "4", undefined],
    [bedrock, "tick-distance", "12", undefined],
    [bedrock, "tick-distance", "13", "bedrockSimulation"],
    ["minecraft/java/paper", "view-distance", "2", "paperDistance"],
    ["minecraft/java/paper", "simulation-distance", "32", undefined],
    ["minecraft/java/paper", "simulation-distance", "33", "paperDistance"],
    ["minecraft/java/forge", "view-distance", "64", undefined]
  ])("validates %s %s=%s without universal modded limits", (type, key, value, error) => {
    const field = quickFields(type!, { [key!]: 10 })[0];
    expect(quickValidation(type!, field, value!)).toBe(error);
  });
});

describe("Quick Settings save lifecycle", () => {
  it.each([java, bedrock])(
    "sends %s fresh literal backslash-u values unchanged to the lossless formatter",
    async (type) => {
      const { model, deps } = setup();
      await model.setTarget(target("alpha", type));
      model.edit("max-players", "40");
      const fresh = {
        ...original(),
        "level-name": "C:\\users\\world",
        unknown: "literal \\u4e16",
        "literal\\u4e16": "unknown property"
      };
      deps.read.mockResolvedValue(fresh);
      await model.save();
      expect(model.state.error).toBe("");
      expect(model.state.saved).toBe(true);
      expect(model.changes.value).toEqual({});
      expect(deps.write).toHaveBeenCalledExactlyOnceWith(target("alpha", type), {
        ...fresh,
        "max-players": 40
      });
    }
  );
  it("loads without clamping current values, confirmation or writes", async () => {
    const { model, deps } = setup();
    deps.read.mockResolvedValue({ "max-players": 0, "view-distance": 99, difficulty: 0 });
    await model.setTarget(target("alpha", "minecraft/java/paper"));
    expect(model.state.draft).toEqual({
      "max-players": "0",
      "view-distance": "99",
      difficulty: "peaceful"
    });
    expect(model.validation.value).toEqual({});
    await model.save();
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.write).not.toHaveBeenCalled();
  });
  it("only confirms dirty fields, refreshes the baseline after acknowledged data, and no-ops next save", async () => {
    const { model, deps } = setup();
    await model.setTarget(target());
    model.edit("pvp", true);
    deps.read.mockResolvedValue({ ...original(), "new-key": "Fresh 世界" });
    await model.save();
    expect(deps.confirm).toHaveBeenCalledOnce();
    expect(deps.read).toHaveBeenCalledTimes(2);
    expect(deps.write).toHaveBeenCalledExactlyOnceWith(target(), {
      ...original(),
      "new-key": "Fresh 世界",
      pvp: "true"
    });
    expect(model.state.baseline["new-key"]).toBe("Fresh 世界");
    expect(model.state.saved).toBe(true);
    expect(model.changes.value).toEqual({});
    await model.save();
    expect(deps.write).toHaveBeenCalledTimes(1);
  });
  it("cancels confirmation with no fresh read or write and preserves drafts", async () => {
    const { model, deps } = setup();
    await model.setTarget(target());
    model.edit("difficulty", "hard");
    deps.confirm.mockResolvedValue(false);
    await model.save();
    expect(deps.read).toHaveBeenCalledTimes(1);
    expect(deps.write).not.toHaveBeenCalled();
    expect(model.state.draft.difficulty).toBe("hard");
    expect(model.busy.value).toBe(false);
  });
  it("rejects invalid edited inputs without opening confirmation", async () => {
    const { model, deps } = setup();
    await model.setTarget(target());
    model.edit("max-players", "1.5");
    await model.save();
    expect(model.validation.value).toEqual({ "max-players": "integer" });
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.write).not.toHaveBeenCalled();
  });
  it("rejects same-field conflicts while retaining edits", async () => {
    const { model, deps } = setup();
    await model.setTarget(target());
    model.edit("difficulty", "hard");
    deps.read.mockResolvedValue({ ...original(), difficulty: "normal" });
    await model.save();
    expect(model.state.error).toBe("conflict");
    expect(model.state.conflicts).toEqual(["difficulty"]);
    expect(model.state.draft.difficulty).toBe("hard");
    expect(deps.write).not.toHaveBeenCalled();
    expect(model.busy.value).toBe(false);
  });
  it.each([false, undefined, "true", 1])(
    "requires literal true acknowledgement, got %s",
    async (ack) => {
      const { model, deps } = setup();
      await model.setTarget(target());
      model.edit("pvp", true);
      deps.write.mockResolvedValue(ack);
      await model.save();
      expect(model.state.error).toBe("ack");
      expect(model.state.saved).toBe(false);
      expect(model.state.baseline.pvp).toBe("false");
      expect(model.changes.value).toEqual({ pvp: true });
    }
  );
  it("guards the whole confirmation/read/write against double save, refresh and editing", async () => {
    const { model, deps } = setup();
    await model.setTarget(target());
    model.edit("pvp", true);
    const pending = deferred<boolean>();
    deps.confirm.mockReturnValue(pending.promise);
    const saving = model.save();
    await model.save();
    await model.load();
    model.edit("pvp", false);
    expect(deps.confirm).toHaveBeenCalledOnce();
    expect(deps.read).toHaveBeenCalledTimes(1);
    expect(model.state.draft.pvp).toBe(true);
    pending.resolve(true);
    await saving;
    expect(deps.write).toHaveBeenCalledOnce();
  });
  it.each(["uuid", "daemonId", "type"] as const)(
    "abandons confirmation when %s context changes",
    async (key) => {
      const { model, deps } = setup();
      await model.setTarget(target());
      model.edit("pvp", true);
      const pending = deferred<boolean>();
      deps.confirm.mockReturnValue(pending.promise);
      const saving = model.save();
      await model.setTarget({ ...target(), [key]: key === "type" ? bedrock : "beta" });
      pending.resolve(true);
      await saving;
      expect(deps.write).not.toHaveBeenCalled();
      expect(model.state.saved).toBe(false);
      expect(model.busy.value).toBe(false);
    }
  );
  it("abandons a fresh read on A→B→A and ignores stale finalizers during a newer load", async () => {
    const { model, deps } = setup();
    await model.setTarget(target());
    model.edit("pvp", true);
    const fresh = deferred<unknown>();
    deps.read.mockReturnValueOnce(fresh.promise);
    const saving = model.save();
    await Promise.resolve();
    await Promise.resolve();
    await model.setTarget(target("beta"));
    const load = deferred<unknown>();
    deps.read.mockReturnValueOnce(load.promise);
    const reloading = model.setTarget(target());
    await Promise.resolve();
    fresh.resolve(original());
    await saving;
    expect(model.state.loading).toBe(true);
    expect(deps.write).not.toHaveBeenCalled();
    load.resolve({ difficulty: "easy" });
    await reloading;
    expect(model.state.draft).toEqual({ difficulty: "easy" });
  });
  it("aborts obsolete reads and rejects late load publication", async () => {
    const { model, deps } = setup();
    const old = deferred<unknown>();
    deps.read.mockReturnValueOnce(old.promise);
    const loading = model.setTarget(target());
    await Promise.resolve();
    const signal = deps.read.mock.calls[0][1];
    await model.setTarget(target("beta"));
    expect(signal.aborted).toBe(true);
    old.resolve({ difficulty: "hard" });
    await loading;
    expect(model.state.target?.uuid).toBe("beta");
    expect(model.state.draft.difficulty).toBe("peaceful");
  });
  it("ignores late acknowledgements on a new target", async () => {
    const { model, deps } = setup();
    await model.setTarget(target());
    model.edit("pvp", true);
    const ack = deferred<unknown>();
    deps.write.mockReturnValue(ack.promise);
    const saving = model.save();
    await vi.waitFor(() => expect(deps.write).toHaveBeenCalledOnce());
    await model.setTarget(target("beta"));
    ack.resolve(true);
    await saving;
    expect(model.state.saved).toBe(false);
    expect(model.state.baseline.pvp).toBe("false");
  });
  it("rechecks the authoritative edition before the fresh read and write", async () => {
    const { model, deps } = setup();
    await model.setTarget(target());
    model.edit("pvp", true);
    deps.readType.mockResolvedValue(bedrock);
    await model.save();
    expect(model.state.error).toBe("context");
    expect(model.state.ready).toBe(false);
    expect(deps.read).toHaveBeenCalledTimes(1);
    expect(deps.write).not.toHaveBeenCalled();
  });
  it.each([undefined, null, [], false, "properties", 0])(
    "handles malformed load %s without escaping",
    async (value) => {
      const { model, deps } = setup();
      deps.read.mockResolvedValue(value);
      await expect(model.setTarget(target())).resolves.toBeUndefined();
      expect(model.state.error).toBe("format");
      expect(model.busy.value).toBe(false);
    }
  );
  it("abandons Save on an undefined fresh read and requires a valid Refresh", async () => {
    const { model, deps } = setup();
    await model.setTarget(target());
    model.edit("pvp", true);
    deps.read.mockResolvedValueOnce(undefined);
    await model.save();
    expect(model.state.error).toBe("format");
    expect(model.state.ready).toBe(false);
    expect(model.changes.value).toEqual({ pvp: true });
    expect(deps.write).not.toHaveBeenCalled();
    await model.save();
    expect(deps.confirm).toHaveBeenCalledOnce();
    await model.load();
    expect(model.state.ready).toBe(true);
  });
  it("contains load failures and allows Refresh recovery", async () => {
    const { model, deps } = setup();
    deps.readType.mockRejectedValueOnce(new Error("No permission"));
    await model.setTarget(target());
    expect(model.state.error).toBe("load");
    expect(model.state.errorDetail).toBe("No permission");
    await model.load();
    expect(model.state.ready).toBe(true);
  });
  it.each(["read", "write"] as const)(
    "contains %s failure and keeps the dirty baseline",
    async (phase) => {
      const { model, deps } = setup();
      await model.setTarget(target());
      model.edit("pvp", true);
      deps[phase].mockRejectedValueOnce(new Error("offline"));
      await model.save();
      expect(model.state.error).toBe("save");
      expect(model.state.errorDetail).toBe("offline");
      expect(model.changes.value).toEqual({ pvp: true });
      expect(model.busy.value).toBe(false);
    }
  );
  it("abandons work when unmounted during confirmation", async () => {
    const { model, deps } = setup();
    await model.setTarget(target());
    model.edit("pvp", true);
    const confirm = deferred<boolean>();
    deps.confirm.mockReturnValue(confirm.promise);
    const saving = model.save();
    model.dispose();
    confirm.resolve(true);
    await saving;
    expect(deps.write).not.toHaveBeenCalled();
  });
});
