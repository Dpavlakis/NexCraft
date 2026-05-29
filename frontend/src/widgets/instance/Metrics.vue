<script setup lang="ts">
import BetweenMenus from "@/components/BetweenMenus.vue";
import CardPanel from "@/components/CardPanel.vue";
import { useLayoutCardTools } from "@/hooks/useCardTools";
import { useScreen } from "@/hooks/useScreen";
import { t } from "@/lang/i18n";
import { metricsGet, type MetricSample } from "@/services/apis/metrics";
import { getRandomId } from "@/tools/randId";
import { reportErrorMsg } from "@/tools/validator";
import type { LayoutCard } from "@/types/index";
import { LineChartOutlined } from "@ant-design/icons-vue";
import { init, type ECharts } from "echarts";
import { onBeforeUnmount, onMounted, ref } from "vue";

const props = defineProps<{ card: LayoutCard }>();

const { isPhone } = useScreen();
const { getMetaOrRouteValue } = useLayoutCardTools(props.card);
const instanceId = String(getMetaOrRouteValue("instanceId") ?? "");
const daemonId = String(getMetaOrRouteValue("daemonId") ?? "");

const domId = "metrics-" + getRandomId();
let chart: ECharts | undefined;
const loading = ref(false);
const range = ref(6 * 3600 * 1000); // default 6h
const rangeOptions = [
  { value: 3600 * 1000, label: t("TXT_CODE_metrics_1h") },
  { value: 6 * 3600 * 1000, label: t("TXT_CODE_metrics_6h") },
  { value: 24 * 3600 * 1000, label: t("TXT_CODE_metrics_24h") }
];

const fmt = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
};

const render = (samples: MetricSample[]) => {
  if (!chart) return;
  const times = samples.map((s) => fmt(s.t));
  chart.setOption({
    tooltip: { trigger: "axis" },
    legend: {
      data: [t("TXT_CODE_metrics_cpu"), t("TXT_CODE_metrics_ram"), t("TXT_CODE_metrics_players")],
      top: 0
    },
    grid: { top: 36, bottom: 36, left: 48, right: 48 },
    xAxis: { type: "category", boundaryGap: false, data: times },
    yAxis: [
      { type: "value", name: "%", min: 0, max: 100 },
      { type: "value", name: t("TXT_CODE_metrics_count_gb"), min: 0 }
    ],
    series: [
      {
        name: t("TXT_CODE_metrics_cpu"),
        type: "line",
        smooth: true,
        showSymbol: false,
        yAxisIndex: 0,
        data: samples.map((s) => +(s.cpu || 0).toFixed(1))
      },
      {
        name: t("TXT_CODE_metrics_ram"),
        type: "line",
        smooth: true,
        showSymbol: false,
        yAxisIndex: 1,
        data: samples.map((s) => +((s.memMB || 0) / 1024).toFixed(2))
      },
      {
        name: t("TXT_CODE_metrics_players"),
        type: "line",
        step: "end",
        showSymbol: false,
        yAxisIndex: 1,
        data: samples.map((s) => s.players || 0)
      }
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
    render(res.value || []);
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
  if (el) chart = init(el);
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
          <template v-if="!isPhone" #left>
            <a-typography-title class="mb-0" :level="4">
              <LineChartOutlined /> {{ card.title }}
            </a-typography-title>
          </template>
          <template #right>
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
