"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "../..");
const load = createRequire(path.join(root, "frontend/package.json"));
const ts = load("typescript");
function evaluate(source, mocks, globals = {}) {
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const result = { exports: {} };
  vm.runInNewContext(output, { exports: result.exports, module: result, require: id => id in mocks ? mocks[id] : load(id), console, ...globals });
  return result.exports;
}
test("actual i18n initializer: catalog loading, fallback, interpolation, saved switching and useI18n", async () => {
  const { JSDOM } = load("jsdom"), dom = new JSDOM("<div id='app'></div>", { url: "http://localhost" });
  const saved = Object.fromEntries(["window", "document", "SVGElement", "Element", "Node"].map(k => [k, global[k]]));
  Object.assign(global, { window: dom.window, document: dom.window.document, SVGElement: dom.window.SVGElement, Element: dom.window.Element, Node: dom.window.Node });
  const vue = load("vue"), intl = load("vue-i18n");
  try {
    const glob = {};
    for (const file of fs.readdirSync(path.join(root, "languages")).filter(f => f.endsWith(".json")))
      glob["../../../languages/" + file] = async () => ({ default: JSON.parse(fs.readFileSync(path.join(root, "languages", file))) });
    let source = fs.readFileSync(path.join(root, "frontend/src/lang/i18n.ts"), "utf8");
    source = source.replace(/import\.meta\.glob\([^)]*\)/, "__catalogs");
    const api = evaluate(source, {
      "@/services/apis": { updateSettings() { throw Error("unexpected API write"); } },
      "@/stores/useAppStateStore": { useAppStateStore: () => ({ state: { isInstall: true } }) },
      "vue-i18n": intl
    }, { window: dom.window, localStorage: dom.window.localStorage, __catalogs: glob });
    await api.initI18n("zh-CN");
    const i18n = api.getI18nInstance();
    // Add a namespaced fixture without replacing the real catalogs.
    i18n.global.mergeLocaleMessage("en_us", { dependencyFixture: { fallback: "Hello {name}" } });
    i18n.global.mergeLocaleMessage("zh_cn", { dependencyFixture: { selected: "Selected {name}" } });
    assert.equal(api.getCurrentLang(), "zh_cn");
    assert.equal(api.t("dependencyFixture.fallback", { name: "Steve" }), "Hello Steve");
    const app = vue.createApp({ setup() { const { t } = intl.useI18n(); return () => vue.h("p", t("dependencyFixture.fallback", { name: "Alex" })); } });
    app.use(i18n); app.mount(dom.window.document.querySelector("#app"));
    assert.equal(dom.window.document.querySelector("p").textContent, "Hello Alex");
    api.setLanguage("en-US", false); await vue.nextTick();
    assert.equal(dom.window.localStorage.getItem(api.LANGUAGE_KEY), "en_us");
    assert.equal(api.getCurrentLang(), "en_us");
    assert.equal(dom.window.document.querySelector("p").textContent, "Hello Alex");
    app.unmount();
  } finally { Object.assign(global, saved); dom.window.close(); }
});
test("actual Overview chart options: SVG desktop/mobile resize, axes, tooltip, zoom and theme", () => {
  const echarts = load("echarts"), vue = load("vue");
  let source = fs.readFileSync(path.join(root, "frontend/src/hooks/useOverviewChart.ts"), "utf8");
  source += "\nexport { getChartDefaultOption, getSimpleChartDefaultOption };\n";
  const options = evaluate(source, { echarts, vue });
  for (const theme of [undefined, "dark"]) for (const width of [1200, 390]) {
    const chart = echarts.init(null, theme, { renderer: "svg", ssr: true, width, height: 260 });
    try {
      const option = options.getChartDefaultOption();
      option.xAxis.data = ["12:00", "12:01"]; option.series[0].data = [10, 20]; option.dataZoom = [{ type: "inside" }];
      chart.setOption(option); assert.match(chart.renderToSVGString(), /<svg/);
      chart.dispatchAction({ type: "dataZoom", start: 25, end: 75 });
      assert.equal(chart.getOption().dataZoom[0].start, 25);
      chart.resize({ width: width - 20, height: 240 }); assert.equal(chart.getWidth(), width - 20);
      assert.match(option.tooltip.formatter([{ data: 12, value: 12, axisValue: "12:00" }]), /12:00/);
      assert.match(options.getSimpleChartDefaultOption().tooltip.formatter([{ data: 10, value: 10, axisValue: "12:00" }]), /10.0/);
    } finally { chart.dispose(); }
  }
});
