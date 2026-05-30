<script setup lang="ts">
import { inject } from "vue";
const embeddedInManageModal = inject<boolean>("embeddedInManageModal", false);
import BetweenMenus from "@/components/BetweenMenus.vue";
import CardPanel from "@/components/CardPanel.vue";
import { useAppRouters } from "@/hooks/useAppRouters";
import { useLayoutCardTools } from "@/hooks/useCardTools";
import { useScreen } from "@/hooks/useScreen";
import { t } from "@/lang/i18n";
import { metricsGet, type MetricSample } from "@/services/apis/metrics";
import { getRandomId } from "@/tools/randId";
import { reportErrorMsg } from "@/tools/validator";
import type { LayoutCard } from "@/types/index";
import { InfoCircleOutlined, LineChartOutlined, RollbackOutlined } from "@ant-design/icons-vue";
import { init, type ECharts } from "echarts";
import { onBeforeUnmount, onMounted, ref } from "vue";

const props = defineProps<{ card: LayoutCard }>();

const { isPhone } = useScreen();
const { getMetaOrRouteValue } = useLayoutCardTools(props.card);
const instanceId = String(getMetaOrRouteValue("instanceId") ?? "");
const daemonId = String(getMetaOrRouteValue("daemonId") ?? "");

const { toPage } = useAppRouters();
const toConsole = () => {
  toPage({ path: "/instances/terminal", query: { daemonId, instanceId } });
};

// Match the chart text to the rest of the UI instead of echarts' default font.
const APP_FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif';

const domId = "metrics-" + getRandomId();
let chart: ECharts | undefined;
let chartReady = false;
const loading = ref(false);
const MIN = 60 * 1000;
const HOUR = 3600 * 1000;
const range = ref(6 * HOUR); // default 6h
const rangeOptions = [
  { value: 1 * MIN, label: t("TXT_CODE_metrics_1m") },
  { value: 5 * MIN, label: t("TXT_CODE_metrics_5m") },
  { value: 15 * MIN, label: t("TXT_CODE_metrics_15m") },
  { value: 30 * MIN, label: t("TXT_CODE_metrics_30m") },
  { value: 1 * HOUR, label: t("TXT_CODE_metrics_1h") },
  { value: 3 * HOUR, label: t("TXT_CODE_metrics_3h") },
  { value: 6 * HOUR, label: t("TXT_CODE_metrics_6h") },
  { value: 12 * HOUR, label: t("TXT_CODE_metrics_12h") },
  { value: 24 * HOUR, label: t("TXT_CODE_metrics_24h") }
];

const fmt = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
};

// Static chart configuration — set once so the current zoom level survives the
// 60s auto-refresh (data is merged in separately by updateData()).
const setupChart = () => {
  if (!chart) return;
  chart.setOption({
    textStyle: { fontFamily: APP_FONT },
    tooltip: { trigger: "axis", textStyle: { fontFamily: APP_FONT } },
    legend: {
      data: [t("TXT_CODE_metrics_cpu"), t("TXT_CODE_metrics_ram"), t("TXT_CODE_metrics_players")],
      top: 0,
      textStyle: { fontFamily: APP_FONT }
    },
    toolbox: {
      right: 12,
      top: 0,
      feature: {
        dataZoom: {
          yAxisIndex: "none",
          title: { zoom: t("TXT_CODE_metrics_area_zoom"), back: t("TXT_CODE_metrics_reset_zoom") }
        },
        restore: { title: t("TXT_CODE_metrics_reset_zoom") }
      }
    },
    grid: { top: 44, bottom: 70, left: 56, right: 64 },
    xAxis: { type: "category", boundaryGap: false, data: [] },
    yAxis: [
      {
        type: "value",
        name: "%",
        min: 0,
        max: 100,
        nameLocation: "middle",
        nameGap: 40
      },
      {
        type: "value",
        name: t("TXT_CODE_metrics_count_gb"),
        min: 0,
        nameLocation: "middle",
        nameGap: 44,
        nameRotate: 270
      }
    ],
    dataZoom: [
      {
        type: "inside",
        xAxisIndex: 0,
        zoomOnMouseWheel: "shift",
        moveOnMouseMove: true,
        moveOnMouseWheel: false
      },
      { type: "slider", xAxisIndex: 0, bottom: 12, height: 22 }
    ],
    series: [
      { name: t("TXT_CODE_metrics_cpu"), type: "line", smooth: true, showSymbol: false, yAxisIndex: 0, data: [] },
      { name: t("TXT_CODE_metrics_ram"), type: "line", smooth: true, showSymbol: false, yAxisIndex: 1, data: [] },
      { name: t("TXT_CODE_metrics_players"), type: "line", step: "end", showSymbol: false, yAxisIndex: 1, data: [] }
    ]
  });
  chartReady = true;
};

const updateData = (samples: MetricSample[]) => {
  if (!chart) return;
  if (!chartReady) setupChart();
  chart.setOption({
    xAxis: { data: samples.map((s) => fmt(s.t)) },
    series: [
      { data: samples.map((s) => +(s.cpu || 0).toFixed(1)) },
      { data: samples.map((s) => +((s.memMB || 0) / 1024).toFixed(2)) },
      { data: samples.map((s) => s.players || 0) }
    ]
  });
};

const load = async () => {
  const { execute } = metricsGet();
  try {
    loading.value = true;
    const res = await execute({
      params: { daemonId, uuid: instanceId, since: Date.now() - range.value }
    });
    updateData(res.value || []);
  } catch (err: any) {
    reportErrorMsg(err.message);
  } finally {
    loading.value = false;
  }
};

const onResize = () => chart?.resize();

let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  const el = document.getElementById(domId);
  if (el) {
    chart = init(el);
    setupChart();
  }
  load();
  timer = setInterval(load, 60000);
  window.addEventListener("resize", onResize);
});
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  window.removeEventListener("resize", onResize);
  chart?.dispose();
  chart = undefined;
});
</script>

<template>
  <div style="height: 100%" class="container">
    <a-row :gutter="[24, 24]" style="height: 100%">
      <a-col :span="24">
        <BetweenMenus>
          <template v-if="!isPhone && !embeddedInManageModal" #left>
            <a-typography-title class="mb-0" :level="4">
              <LineChartOutlined /> {{ card.title }}
            </a-typography-title>
          </template>
          <template #right>
            <a-button v-if="!embeddedInManageModal" @click="toConsole">
              <template #icon><RollbackOutlined /></template>
              {{ t("TXT_CODE_backup_to_console") }}
            </a-button>
            <a-popover placement="bottomRight">
              <template #title>{{ t("TXT_CODE_metrics_zoom_title") }}</template>
              <template #content>
                <div style="max-width: 280px">
                  <p style="margin-bottom: 8px">{{ t("TXT_CODE_metrics_zoom_line1") }}</p>
                  <p style="margin-bottom: 8px">{{ t("TXT_CODE_metrics_zoom_line2") }}</p>
                  <p style="margin-bottom: 0">{{ t("TXT_CODE_metrics_zoom_line3") }}</p>
                </div>
              </template>
              <a-button type="text">
                <InfoCircleOutlined />
              </a-button>
            </a-popover>
            <a-select
              v-model:value="range"
              :options="rangeOptions"
              style="width: 140px"
              @change="load"
            />
            <a-button @click="load">{{ t("TXT_CODE_b76d94e0") }}</a-button>
          </template>
        </BetweenMenus>
      </a-col>
      <a-col :span="24">
        <CardPanel style="height: 100%">
          <template #body>
            <a-spin :spinning="loading">
              <div :id="domId" style="width: 100%; height: 460px"></div>
              <a-typography-text type="secondary">
                {{ t("TXT_CODE_metrics_hint") }}
              </a-typography-text>
            </a-spin>
          </template>
        </CardPanel>
      </a-col>
    </a-row>
  </div>
</template>
