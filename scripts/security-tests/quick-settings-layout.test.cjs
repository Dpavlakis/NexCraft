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
      id: "quick-id",
      type: "InstanceQuickSettings",
      title: "Previously translated Quick Settings",
      width: 8,
      height: "unset",
      meta: {}
    },
    {
      id: "manage-id",
      type: "InstanceManagerBtns",
      title: "My tools",
      width: 12,
      height: "470px",
      disableDelete: true,
      meta: { retained: "manage" },
      retainedAttribute: "keep"
    }
  ]
});
const oldStock = () => {
  const page = stock();
  page.items.splice(2, 1);
  Object.assign(page.items[2], { width: 8, height: "200px" });
  return page;
};
beforeEach(() => {
  stored = undefined;
  writes = 0;
  globals.clear();
});

test("new defaults place Console 12, then Base 4 beside Manage 8, and retain standalone Quick Settings", () => {
  const defaults = JSON.parse(layout.getFrontendLayoutConfig());
  const page = defaults.find((page) => page.page === "/instances/terminal");
  assert.deepEqual(
    page.items.map((card) => [card.type, card.width, card.height]),
    [
      ["Terminal", 12, "600px"],
      ["InstanceBaseInfo", 4, "200px"],
      ["InstanceManagerBtns", 8, "200px"]
    ]
  );
  const fullPage = defaults.find((page) => page.page === "/instances/quickSettings");
  assert.equal(fullPage.items.length, 1);
  assert.equal(fullPage.items[0].type, "InstanceQuickSettings");
  assert.equal(fullPage.items[0].width, 12);
  assert.equal(fullPage.items[0].disableDelete, true);
  assert.equal(writes, 0);
});

test("stock migration removes only generated inline Quick and preserves retained IDs/titles/meta/attributes", () => {
  const page = stock();
  const before = structuredClone(page);
  const [terminal, base, , manager] = page.items;
  const idsBefore = nextId;
  assert.equal(layout.migrateQuickSettingsLayout([page]), true);
  assert.deepEqual(page, {
    ...before,
    items: [before.items[0], before.items[1], { ...before.items[3], width: 8, height: "200px" }]
  });
  assert.equal(page.items[0], terminal);
  assert.equal(page.items[1], base);
  assert.equal(page.items[2].meta, manager.meta);
  assert.equal(nextId, idsBefore);
});

test("migration is idempotent and never re-adds inline Quick", () => {
  const page = stock();
  assert.equal(layout.migrateQuickSettingsLayout([page]), true);
  const after = structuredClone(page);
  assert.equal(layout.migrateQuickSettingsLayout([page]), false);
  assert.deepEqual(page, after);
  assert.equal(
    page.items.some((card) => card.type === "InstanceQuickSettings"),
    false
  );
});

test("older three-widget stock layouts stay unchanged and never receive inline Quick", () => {
  const page = oldStock();
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

test("stored generated stock migrates and merges the standalone page once", () => {
  stored = JSON.stringify([stock()]);
  globals.set("versionChange", true);
  const first = JSON.parse(layout.getFrontendLayoutConfig());
  assert.equal(writes, 1);
  assert.equal(globals.get("versionChange"), null);
  const terminal = first.find((page) => page.page === "/instances/terminal");
  assert.deepEqual(
    terminal.items.map((card) => card.type),
    ["Terminal", "InstanceBaseInfo", "InstanceManagerBtns"]
  );
  assert.equal(terminal.items[2].width, 8);
  assert.equal(terminal.items[2].height, "200px");
  assert.equal(first.filter((page) => page.page === "/instances/quickSettings").length, 1);
  assert.deepEqual(JSON.parse(layout.getFrontendLayoutConfig()), first);
  assert.equal(writes, 1);
});

test("older stock with all default pages already present causes no persistence", () => {
  const defaults = JSON.parse(layout.getFrontendLayoutConfig());
  const index = defaults.findIndex((page) => page.page === "/instances/terminal");
  defaults[index] = oldStock();
  stored = JSON.stringify(defaults);
  assert.deepEqual(JSON.parse(layout.getFrontendLayoutConfig()), defaults);
  assert.equal(writes, 0);
});

const customizations = [
  ["custom order", (page) => page.items.reverse()],
  ["extra card", (page) => page.items.push({ id: "custom", type: "ClockCard" })],
  [
    "only a Quick widget",
    (page) => {
      page.items = [page.items[2]];
    }
  ],
  [
    "another Quick widget",
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
      page.items[3].disableDelete = false;
    }
  ],
  [
    "custom Quick deletion flag",
    (page) => {
      page.items[2].disableDelete = true;
    }
  ],
  [
    "custom Quick target",
    (page) => {
      page.items[2].meta = { instanceId: "custom-instance", daemonId: "custom-node" };
    }
  ],
  [
    "custom Quick metadata",
    (page) => {
      page.items[2].meta = { retained: true };
    }
  ],
  [
    "custom Quick attribute",
    (page) => {
      page.items[2].description = "My custom Quick widget";
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
];
for (let index = 0; index < 4; index++) {
  customizations.push(
    [
      "custom width on widget " + index,
      (page) => {
        page.items[index].width = 6;
      }
    ],
    [
      "custom height on widget " + index,
      (page) => {
        page.items[index].height = "345px";
      }
    ]
  );
}
for (const [label, customize] of customizations) {
  test(label + " retains placement and data while receiving the missing standalone entry", () => {
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

test("an existing customised standalone entry is preserved without duplicates", () => {
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
  [{ page: "/instances/terminal", items: [null, {}, [], {}] }],
  [{ page: "/instances/terminal", items: {} }]
]) {
  test("migration safely ignores malformed structure " + JSON.stringify(malformed), () => {
    const before = structuredClone(malformed);
    assert.equal(layout.migrateQuickSettingsLayout(malformed), false);
    assert.deepEqual(malformed, before);
  });
}
for (const malformed of ["{bad json", "null", "{}", "[null]"]) {
  test("malformed stored data " + malformed + " is returned unchanged without persistence", () => {
    stored = malformed;
    assert.equal(layout.getFrontendLayoutConfig(), malformed);
    assert.equal(writes, 0);
  });
}
