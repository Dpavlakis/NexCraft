"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const root = path.resolve(__dirname, "../..");
require(path.join(root, "panel/node_modules/ts-node")).register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", esModuleInterop: true, target: "ES2022" }
});
const source = path.join(root, "panel/src/app/service/frontend_layout.ts");
let stored,
  writes,
  nextId = 0;
const globals = new Map();
const storage = {
  fileExists: () => stored !== undefined,
  readFile: () => stored,
  writeFile: (_name, value) => {
    writes++;
    stored = value;
  }
};
// Isolate all storage/import side effects. These tests never read or write user data.
const originalLoad = Module._load;
Module._load = function (name, parent, ...args) {
  if (parent?.filename === source) {
    if (name === "fs-extra") return {};
    if (name === "mcsmanager-common")
      return {
        GlobalVariable: {
          get: (key) => globals.get(key),
          set: (key, value) => globals.set(key, value)
        }
      };
    if (name === "uuid") return { v4: () => `quick-test-${++nextId}` };
    if (name === "../common/system_storage") return { __esModule: true, default: storage };
    if (name === "../const") return { SAVE_DIR_PATH: "unused" };
    if (name === "../i18n") return { $t: (key) => key };
  }
  return originalLoad.call(this, name, parent, ...args);
};
const layout = require(source);
Module._load = originalLoad;
const stock = () => ({
  page: "/instances/terminal",
  extraPageMetadata: "keep",
  items: [
    {
      id: "console-id",
      type: "Terminal",
      title: "My console",
      width: 12,
      height: "600px",
      disableDelete: true,
      meta: { viewType: "inner", retained: "console" }
    },
    {
      id: "base-id",
      type: "InstanceBaseInfo",
      title: "My info",
      width: 4,
      height: "200px",
      meta: { retained: "info" }
    },
    {
      id: "manage-id",
      type: "InstanceManagerBtns",
      title: "My tools",
      width: 8,
      height: "200px",
      disableDelete: true,
      meta: { retained: "manage" }
    }
  ]
});
beforeEach(() => {
  stored = undefined;
  writes = 0;
  globals.clear();
});

test("new defaults place Console 12, Base 4 + Quick 8, then Manage 12 and provide a full page", () => {
  const defaults = JSON.parse(layout.getFrontendLayoutConfig());
  const page = defaults.find((page) => page.page === "/instances/terminal");
  assert.deepEqual(
    page.items.map((card) => [card.type, card.width]),
    [
      ["Terminal", 12],
      ["InstanceBaseInfo", 4],
      ["InstanceQuickSettings", 8],
      ["InstanceManagerBtns", 12]
    ]
  );
  assert.equal(page.items.find((card) => card.type === "InstanceManagerBtns").height, "470px");
  const fullPage = defaults.find((page) => page.page === "/instances/quickSettings");
  assert.equal(fullPage.items[0].type, "InstanceQuickSettings");
  assert.equal(fullPage.items[0].width, 12);
  assert.equal(writes, 0);
});
test("stock migration preserves IDs/titles/meta and all original attributes except Manage width/height", () => {
  const page = stock();
  const before = structuredClone(page);
  assert.equal(layout.migrateQuickSettingsLayout([page]), true);
  assert.deepEqual(page.items[0], before.items[0]);
  assert.deepEqual(page.items[1], before.items[1]);
  assert.deepEqual(page.items[3], { ...before.items[2], width: 12, height: "470px" });
  assert.equal(page.items[2].type, "InstanceQuickSettings");
  assert.equal(page.items[2].width, 8);
  assert.equal(page.extraPageMetadata, "keep");
  assert.ok(!before.items.some((card) => card.id === page.items[2].id));
});
test("migration is idempotent and never inserts a second Quick card", () => {
  const page = stock();
  layout.migrateQuickSettingsLayout([page]);
  const after = structuredClone(page);
  assert.equal(layout.migrateQuickSettingsLayout([page]), false);
  assert.deepEqual(page, after);
  assert.equal(page.items.filter((card) => card.type === "InstanceQuickSettings").length, 1);
});
test("stored stock layouts migrate and merge the full page once", () => {
  stored = JSON.stringify([stock()]);
  globals.set("versionChange", true);
  const first = JSON.parse(layout.getFrontendLayoutConfig());
  assert.equal(writes, 1);
  assert.equal(globals.get("versionChange"), null);
  assert.equal(
    first.find((page) => page.page === "/instances/terminal").items[2].type,
    "InstanceQuickSettings"
  );
  assert.equal(first.filter((page) => page.page === "/instances/quickSettings").length, 1);
  assert.equal(first.find((page) => page.page === "/instances/terminal").items[3].height, "470px");
  const next = JSON.parse(layout.getFrontendLayoutConfig());
  assert.deepEqual(next, first);
  assert.equal(writes, 1);
});
for (const [label, customize] of [
  [
    "custom width",
    (page) => {
      page.items[1].width = 6;
    }
  ],
  [
    "custom height",
    (page) => {
      page.items[2].height = "345px";
    }
  ],
  [
    "custom order",
    (page) => {
      page.items.reverse();
    }
  ],
  [
    "extra card",
    (page) => {
      page.items.push({ id: "custom", type: "ClockCard" });
    }
  ],
  [
    "existing Quick",
    (page) => {
      page.items[1].type = "InstanceQuickSettings";
    }
  ],
  [
    "different terminal mode",
    (page) => {
      page.items[0].meta.viewType = "full";
    }
  ],
  [
    "custom deletion flag",
    (page) => {
      page.items[2].disableDelete = false;
    }
  ],
  [
    "missing metadata",
    (page) => {
      delete page.items[1].meta;
    }
  ],
  [
    "duplicate IDs",
    (page) => {
      page.items[1].id = page.items[0].id;
    }
  ]
]) {
  test(`${label} retains placement while still receiving the missing full-page entry`, () => {
    const page = stock();
    customize(page);
    const before = structuredClone(page);
    assert.equal(layout.migrateQuickSettingsLayout([page]), false);
    assert.deepEqual(page, before);
    stored = JSON.stringify([page]);
    const merged = JSON.parse(layout.getFrontendLayoutConfig());
    assert.deepEqual(
      merged.find((item) => item.page === page.page),
      before
    );
    assert.equal(merged.filter((item) => item.page === "/instances/quickSettings").length, 1);
  });
}
test("an existing customised full-page entry is preserved without duplicates", () => {
  const page = {
    page: "/instances/quickSettings",
    items: [{ id: "mine", type: "InstanceQuickSettings", width: 6, meta: { saved: true } }]
  };
  stored = JSON.stringify([stock(), page]);
  const merged = JSON.parse(layout.getFrontendLayoutConfig());
  assert.deepEqual(
    merged.find((item) => item.page === page.page),
    page
  );
  assert.equal(merged.filter((item) => item.page === page.page).length, 1);
});
test("ambiguous duplicated terminal pages are not migrated", () => {
  const pages = [stock(), stock()];
  const before = structuredClone(pages);
  assert.equal(layout.migrateQuickSettingsLayout(pages), false);
  assert.deepEqual(pages, before);
});
for (const malformed of [
  null,
  {},
  "broken",
  [null],
  [{ page: "/instances/terminal", items: null }],
  [{ page: "/instances/terminal", items: [null, {}, []] }],
  [{ page: "/instances/terminal", items: {} }]
]) {
  test(`migration safely ignores malformed structure ${JSON.stringify(malformed)}`, () => {
    const before = structuredClone(malformed);
    assert.equal(layout.migrateQuickSettingsLayout(malformed), false);
    assert.deepEqual(malformed, before);
  });
}
for (const malformed of ["{bad json", "null", "{}", "[null]"]) {
  test(`malformed stored data ${malformed} is returned unchanged without persistence`, () => {
    stored = malformed;
    assert.equal(layout.getFrontendLayoutConfig(), malformed);
    assert.equal(writes, 0);
  });
}
