<script setup lang="ts">
import ServerSourceBadge from "./ServerSourceBadge.vue";
import InstanceVersionInfo from "@/components/InstanceVersionInfo.vue";
import InstanceSecondaryActions from "@/components/InstanceSecondaryActions.vue";
import type { ServerLayout } from "@/components/ServerLayoutSwitch.vue";
import { useGameEndpoint } from "@/hooks/useGameEndpoint";
import { useAppRouters } from "@/hooks/useAppRouters";
import { useLayoutCardTools } from "@/hooks/useCardTools";
import { getFileConfigAddr } from "@/hooks/useFileManager";
import { useInstanceInfo, verifyEULA } from "@/hooks/useInstance";
import { t } from "@/lang/i18n";
import { downloadAddress } from "@/services/apis/fileManager";
import { parseForwardAddress } from "@/tools/protocol";
import { loaderIconFor } from "@/tools/loaderIcon";
import {
  killInstance,
  openInstance,
  restartInstance,
  stopInstance,
  updateInstance
} from "@/services/apis/instance";
import { useLayoutContainerStore } from "@/stores/useLayoutContainerStore";
import { formatMemoryUsage } from "@/tools/memory";
import { parseTimestamp } from "@/tools/time";
import { reportErrorMsg } from "@/tools/validator";
import type { InstanceDetail, LayoutCard, NodeStatus } from "@/types/index";
import {
  CloseOutlined,
  CloudDownloadOutlined,
  CodeOutlined,
  PlayCircleOutlined,
  PoweroffOutlined,
  RedoOutlined,
  UserOutlined
} from "@ant-design/icons-vue";
import { message, Modal } from "ant-design-vue";
import prettyBytes from "pretty-bytes";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { INSTANCE_STATUS_CODE } from "@/types/const";

const props = withDefaults(
  defineProps<{
    card: LayoutCard;
    targetInstanceInfo?: InstanceDetail;
    targetDaemonId?: string;
    targetNode?: NodeStatus;
    layout?: ServerLayout;
    disabled?: boolean;
  }>(),
  { layout: "compact" }
);
const emits = defineEmits(["refreshList", "click"]);
const { containerState } = useLayoutContainerStore();
const { getMetaOrRouteValue } = useLayoutCardTools(props.card);
const { toPage } = useAppRouters();
const instanceId = computed(
  () => props.targetInstanceInfo?.instanceUuid || getMetaOrRouteValue("instanceId")
);
const daemonId = computed(() => props.targetDaemonId || getMetaOrRouteValue("daemonId"));
const { statusText, isRunning, isStopped, instanceTypeText, instanceInfo, isStarting } =
  useInstanceInfo({
    instanceId: props.targetInstanceInfo ? undefined : instanceId.value,
    daemonId: props.targetInstanceInfo ? undefined : daemonId.value,
    autoRefresh: !props.targetInstanceInfo,
    instanceInfo: props.targetInstanceInfo ? computed(() => props.targetInstanceInfo!) : undefined
  });
const gameEndpoint = useGameEndpoint(
  () => instanceInfo.value,
  () => props.targetNode
);
const unavailable = computed(
  () => props.disabled || containerState.isDesignMode || !instanceId.value || !daemonId.value
);
let active = true;
let generation = 0;
let sawStarting = false;
const snapshot = () => ({
  instanceId: instanceId.value || "",
  daemonId: daemonId.value || "",
  generation
});
type Target = ReturnType<typeof snapshot>;
const current = (target: Target) =>
  active &&
  generation === target.generation &&
  instanceId.value === target.instanceId &&
  daemonId.value === target.daemonId &&
  !unavailable.value;
watch(
  [instanceId, daemonId, () => props.disabled, () => containerState.isDesignMode],
  () => {
    generation++;
    sawStarting = false;
  },
  { flush: "sync" }
);
onBeforeUnmount(() => {
  active = false;
  generation++;
});
watch(
  () => instanceInfo.value?.status,
  (status) => {
    if (status === INSTANCE_STATUS_CODE.STARTING) sawStarting = true;
    else if (status === INSTANCE_STATUS_CODE.RUNNING && sawStarting) {
      sawStarting = false;
      message.success(t("TXT_CODE_instance_started"));
    } else if (status === INSTANCE_STATUS_CODE.STOPPED) sawStarting = false;
  }
);

const { isLoading: openLoading, execute: executeOpen } = openInstance();
const { isLoading: stopLoading, execute: executeStop } = stopInstance();
const { isLoading: restartLoading, execute: executeRestart } = restartInstance();
const { isLoading: killLoading, execute: executeKill } = killInstance();
const { isLoading: updateLoading, execute: executeUpdate } = updateInstance();
const powerBusy = computed(
  () =>
    openLoading.value ||
    stopLoading.value ||
    restartLoading.value ||
    killLoading.value ||
    updateLoading.value
);
type Action = "start" | "stop" | "restart" | "kill" | "update";
const applicable = (action: Action) =>
  action === "start"
    ? isStopped.value
    : action === "update"
    ? isStopped.value && !!instanceInfo.value?.config.updateCommand
    : action === "kill"
    ? !isStopped.value
    : isRunning.value;
const refreshList = () => {
  if (active && !unavailable.value) emits("refreshList");
};
async function executeAction(action: Action, target: Target) {
  if (!current(target) || !applicable(action)) return;
  try {
    if (action === "start") {
      const accepted = await verifyEULA(target.instanceId, target.daemonId);
      if (!accepted || !current(target) || !applicable(action)) return;
    }
    const params = { uuid: target.instanceId, daemonId: target.daemonId };
    if (action === "update")
      await executeUpdate({
        params: { ...params, task_name: "update" },
        data: { time: Date.now() }
      });
    else
      await { start: executeOpen, stop: executeStop, restart: executeRestart, kill: executeKill }[
        action
      ]({ params });
    if (!current(target)) return;
    message.success(
      t(
        action === "start"
          ? "TXT_CODE_instance_starting"
          : action === "update"
          ? "TXT_CODE_b1600db0"
          : "TXT_CODE_efb6d377"
      )
    );
    refreshList();
  } catch (error) {
    if (current(target)) reportErrorMsg(error);
  }
}
function requestAction(action: Action) {
  if (unavailable.value || powerBusy.value || !applicable(action)) return;
  const target = snapshot();
  if (action === "start" || action === "update") return executeAction(action, target);
  Modal.confirm({
    title: t("TXT_CODE_893567ac"),
    content: t(
      action === "stop"
        ? "TXT_CODE_6da85509"
        : action === "restart"
        ? "TXT_CODE_f6bd907d"
        : "TXT_CODE_ec08484"
    ),
    onOk: () => executeAction(action, target)
  });
}
const secondaryPower = computed(() =>
  [
    { action: "restart" as const, title: t("TXT_CODE_47dcfa5"), icon: RedoOutlined },
    { action: "update" as const, title: t("TXT_CODE_40ca4f2"), icon: CloudDownloadOutlined },
    { action: "kill" as const, title: t("TXT_CODE_7b67813a"), icon: CloseOutlined }
  ].filter((item) => applicable(item.action))
);
// Delegate only card-surface clicks to the list. Static metadata and spacing
// remain clickable in every layout; nested native controls keep their own actions.
function onCardClick(event: MouseEvent) {
  if (
    !active ||
    containerState.isDesignMode ||
    !instanceId.value ||
    !daemonId.value ||
    event.defaultPrevented
  )
    return;
  const target = event.target;
  if (
    target instanceof Element &&
    target.closest(
      "a, button, input, textarea, select, summary, [role='button'], [role='menuitem'], [contenteditable='true']"
    )
  )
    return;
  // In batch mode the list owns selection instead of navigation.
  emits("click", event);
}

function openConsole() {
  if (unavailable.value) return;
  toPage({
    path: "/instances/terminal",
    query: { daemonId: daemonId.value, instanceId: instanceId.value }
  });
}

const serverIconUrl = ref("");
const displayIcon = computed(
  () => serverIconUrl.value || loaderIconFor(instanceInfo.value?.config?.packInfo)
);
const instanceEdition = computed(() => {
  const type = String(instanceInfo.value?.config.type || "");
  return type.includes("bedrock") ? "bedrock" : type.includes("minecraft") ? "java" : "";
});
async function loadServerIcon() {
  serverIconUrl.value = "";
  const target = snapshot();
  if (
    !target.instanceId ||
    !target.daemonId ||
    !instanceInfo.value?.config.type.includes("minecraft")
  )
    return;
  try {
    const result = await downloadAddress().execute({
      params: { file_name: "server-icon.png", daemonId: target.daemonId, uuid: target.instanceId }
    });
    if (!active || generation !== target.generation || !result.value) return;
    const address = parseForwardAddress(getFileConfigAddr(result.value), "http");
    serverIconUrl.value = address + "/download/" + result.value.password + "/server-icon.png";
  } catch {
    /* The loader icon remains available when the server has no icon. */
  }
}
onMounted(loadServerIcon);
watch([instanceId, daemonId], loadServerIcon);
const memory = computed(() => {
  const usage = instanceInfo.value?.info.memoryUsage;
  return !isStopped.value && typeof usage === "number" && Number.isFinite(usage) && usage >= 0
    ? usage
    : undefined;
});
const memoryLimit = computed(() => {
  const limit = instanceInfo.value?.info.memoryLimit;
  return typeof limit === "number" && Number.isFinite(limit) && limit > 0 ? limit : undefined;
});
const memoryRatio = computed(() => {
  return memory.value != null && memoryLimit.value != null
    ? Math.min(100, (memory.value / memoryLimit.value) * 100)
    : undefined;
});
const players = computed(() => {
  const runtime = instanceInfo.value?.info;
  if (!isRunning.value || !runtime?.mcPingOnline) return undefined;
  const { currentPlayers, maxPlayers } = runtime;
  return Number.isInteger(currentPlayers) &&
    currentPlayers >= 0 &&
    Number.isInteger(maxPlayers) &&
    maxPlayers >= 0
    ? `${currentPlayers} / ${maxPlayers}`
    : undefined;
});
// Installed metadata stays authoritative; a retained ping is not live evidence
// after the instance leaves Running. Keep the source snapshot untouched.
const versionInstance = computed(
  () =>
    instanceInfo.value && {
      ...instanceInfo.value,
      info: {
        ...instanceInfo.value.info,
        mcPingOnline: isRunning.value && !!instanceInfo.value.info?.mcPingOnline
      }
    }
);
const formatStorage = (usage?: number, limit?: number) => {
  const options = { minimumFractionDigits: 2, maximumFractionDigits: 2, binary: true };
  return limit
    ? prettyBytes(usage ?? 0, options) + " / " + prettyBytes(limit, options)
    : prettyBytes(usage ?? 0, options);
};
const formatSpeed = (value?: number) =>
  prettyBytes(value ?? 0, { maximumFractionDigits: 2 }) + "/s";
</script>

<template>
  <article
    class="game-instance-card"
    :class="[
      'layout-' + layout,
      instanceEdition ? 'edition-' + instanceEdition : '',
      { 'status-running': isRunning, 'status-starting': isStarting }
    ]"
    :aria-label="instanceInfo?.config.nickname"
    @click="onCardClick"
  >
    <header class="server-identity" :class="{ 'has-server-icon': displayIcon }">
      <img
        v-if="displayIcon"
        :src="displayIcon"
        class="server-icon"
        alt=""
        @error="serverIconUrl = ''"
      />
      <div class="server-name">
        <h3>{{ instanceInfo?.config.nickname }}</h3>
        <div class="server-chips">
          <span class="server-status" :class="{ running: isRunning, starting: isStarting }"
            ><i aria-hidden="true" />{{ statusText }}</span
          >
          <a-tag v-if="instanceEdition" class="edition-tag">{{
            t(instanceEdition === "bedrock" ? "TXT_CODE_edition_bedrock" : "TXT_CODE_edition_java")
          }}</a-tag>
          <ServerSourceBadge :source="instanceInfo?.config.packInfo?.source" />
          <a-tag v-for="tag in instanceInfo?.config.tag" :key="tag" class="custom-tag">{{
            tag
          }}</a-tag>
        </div>
      </div>
      <InstanceSecondaryActions
        class="server-header-actions"
        :instance-id="instanceId || ''"
        :daemon-id="daemonId || ''"
        :nickname="instanceInfo?.config.nickname"
        :tags="instanceInfo?.config.tag"
        :disabled="unavailable"
        @changed="refreshList"
        @deleted="refreshList"
      />
    </header>
    <div v-if="instanceEdition" class="server-address">
      <span class="server-label">{{ t("TXT_CODE_game_endpoint_configured_address_label") }}</span>
      <a-tooltip
        :title="
          gameEndpoint.address
            ? t(gameEndpoint.hostHint) + ' ' + t(gameEndpoint.sourceHint)
            : gameEndpoint.source === 'server.properties'
            ? t(gameEndpoint.sourceHint)
            : undefined
        "
      >
        <a-typography-text v-if="gameEndpoint.address" :copyable="{ text: gameEndpoint.address }">{{
          gameEndpoint.address
        }}</a-typography-text>
        <a-typography-text v-else type="secondary">{{
          instanceInfo && !instanceInfo.gameEndpoint
            ? t("TXT_CODE_game_endpoint_daemon_update_hint")
            : t(gameEndpoint.unknown)
        }}</a-typography-text>
      </a-tooltip>
    </div>
    <div class="server-versions">
      <InstanceVersionInfo
        v-if="versionInstance && instanceEdition"
        :instance="versionInstance"
        :daemon-id="String(daemonId)"
        :compact="true"
      />
      <span v-else class="server-label">{{ instanceTypeText }}</span>
    </div>
    <dl class="server-metrics">
      <div>
        <dt>{{ t("TXT_CODE_593ee330") }}</dt>
        <dd>
          {{ memory != null ? formatMemoryUsage(memory, memoryLimit) : "—" }}
        </dd>
        <div
          v-if="layout === 'overview' && memoryRatio != null"
          class="memory-meter"
          aria-hidden="true"
        >
          <i :style="{ width: memoryRatio + '%' }" />
        </div>
      </div>
      <div>
        <dt>{{ t("TXT_CODE_server_layout_players") }}</dt>
        <dd>
          <template v-if="players != null"
            ><UserOutlined aria-hidden="true" /> {{ players }}</template
          ><template v-else>—</template>
        </dd>
      </div>
    </dl>
    <details class="server-details" @click.stop @keydown.stop>
      <summary>{{ t("TXT_CODE_server_layout_details") }}</summary>
      <dl>
        <dt>{{ t("TXT_CODE_2f291d8b") }}</dt>
        <dd>{{ instanceTypeText }}</dd>
        <dt>{{ t("TXT_CODE_34611898") }}</dt>
        <dd>{{ parseTimestamp(instanceInfo?.config.lastDatetime) }}</dd>
        <template v-if="instanceInfo?.config.endTime"
          ><dt>{{ t("TXT_CODE_fa920c0") }}</dt>
          <dd>{{ parseTimestamp(instanceInfo.config.endTime) }}</dd></template
        >
        <template v-if="instanceInfo?.config.processType === 'docker'">
          <template v-if="instanceInfo.info.cpuUsage != null"
            ><dt>{{ t("TXT_CODE_b862a158") }}</dt>
            <dd>{{ parseInt(String(instanceInfo.info.cpuUsage)) }}%</dd></template
          >
          <template v-if="instanceInfo.info.storageUsage != null"
            ><dt>{{ t("TXT_CODE_DISK_USAGE") }}</dt>
            <dd>
              {{ formatStorage(instanceInfo.info.storageUsage, instanceInfo.info.storageLimit) }}
            </dd></template
          >
          <template v-if="instanceInfo.info.rxRate != null || instanceInfo.info.txRate != null"
            ><dt>{{ t("TXT_CODE_network_bandwidth") }}</dt>
            <dd>
              ↓{{ formatSpeed(instanceInfo.info.rxRate) }} ↑{{
                formatSpeed(instanceInfo.info.txRate)
              }}
            </dd></template
          >
        </template>
      </dl>
    </details>
    <footer class="server-actions" @keydown.stop>
      <a-button class="console-action" :disabled="unavailable" @click="openConsole"
        ><CodeOutlined aria-hidden="true" /> {{ t("TXT_CODE_server_actions_console") }}</a-button
      >
      <div class="server-power">
        <a-button
          v-if="isStopped || isRunning"
          class="power-icon-action"
          :data-action="isStopped ? 'start' : 'stop'"
          :disabled="unavailable || powerBusy"
          :loading="openLoading || stopLoading"
          :aria-label="t(isStopped ? 'TXT_CODE_57245e94' : 'TXT_CODE_b1dedda3')"
          :title="t(isStopped ? 'TXT_CODE_57245e94' : 'TXT_CODE_b1dedda3')"
          @click="requestAction(isStopped ? 'start' : 'stop')"
        >
          <PlayCircleOutlined v-if="isStopped" aria-hidden="true" /><PoweroffOutlined
            v-else
            aria-hidden="true"
          />
          {{ t(isStopped ? "TXT_CODE_57245e94" : "TXT_CODE_b1dedda3") }}
        </a-button>
        <a-tooltip v-for="item in secondaryPower" :key="item.action" :title="item.title">
          <a-button
            class="power-icon-action"
            :class="{ 'terminate-action': item.action === 'kill' }"
            :data-action="item.action"
            :disabled="unavailable || powerBusy"
            :loading="
              item.action === 'restart'
                ? restartLoading
                : item.action === 'update'
                ? updateLoading
                : killLoading
            "
            :aria-label="item.title"
            :title="item.title"
            @click="requestAction(item.action)"
            ><component :is="item.icon" aria-hidden="true" /> {{ item.title }}</a-button
          >
        </a-tooltip>
      </div>
    </footer>
  </article>
</template>

<style scoped lang="scss">
.game-instance-card {
  box-sizing: border-box;
  min-width: 0;
  height: 100%;
  position: relative;
  padding: 18px;
  padding-left: 15px;
  border: 1px solid var(--card-border-color);
  border-left: 4px solid var(--color-gray-6);
  border-radius: 7px;
  background: var(--background-color-white);
  color: var(--text-color);
  font-size: 13px;
  line-height: 1.5;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 14px;
  align-content: start;
  container-type: inline-size;
}
.game-instance-card.status-running {
  border-left-color: var(--color-green-7);
}
.game-instance-card.status-starting {
  border-left-color: var(--color-gold-6, #faad14);
}
.server-identity {
  --title-size: 15px;
  --utility-size: 36px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 7px 12px;
  min-width: 0;
}
.server-identity.has-server-icon {
  grid-template-columns: auto minmax(0, 1fr) auto;
}
.server-header-actions {
  grid-column: -2 / -1;
  grid-row: 1;
  justify-self: end;
  position: relative;
  top: calc((var(--title-size) * 1.45 - var(--utility-size)) / 2);
}
.server-icon {
  width: 36px;
  height: 36px;
  object-fit: contain;
  border-radius: 4px;
  flex: none;
}
.server-name {
  display: contents;
}
h3 {
  grid-column: 1;
  grid-row: 1;
  min-width: 0;
  margin: 0;
  font: inherit;
  font-size: var(--title-size);
  font-weight: 600;
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.has-server-icon h3 {
  grid-column: 2;
}
.server-chips {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.has-server-icon .server-chips {
  grid-column: 2 / -1;
}
.server-chips :deep(.ant-tag) {
  margin: 0;
  font-size: 11px;
  max-width: 100%;
  overflow-wrap: anywhere;
  white-space: normal;
}
.server-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--color-gray-9);
}
.server-status i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
}
.server-status.running {
  color: var(--color-green-7);
}
.server-status.starting {
  color: var(--color-orange-7);
}
.server-label,
dt {
  color: var(--color-gray-9);
  font-size: 12px;
}
.server-address {
  min-width: 0;
  overflow-wrap: anywhere;
}
.server-address > .server-label {
  display: block;
  margin-bottom: 2px;
  font-size: 11px;
}
.server-versions {
  min-width: 0;
}
.server-versions :deep(.version-metadata) {
  max-width: 340px;
}
.server-versions :deep(.version-row) {
  display: grid;
  grid-template-columns: minmax(80px, 100px) minmax(0, 1fr);
  gap: 4px 12px;
  font-size: 12px;
}
.server-versions :deep(.version-row dt) {
  max-width: 100%;
}
.server-versions :deep(.version-row dd) {
  margin: 0;
  text-align: left;
  white-space: normal;
  overflow-wrap: anywhere;
}
dl {
  margin: 0;
}
dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
  font-variant-numeric: tabular-nums;
}
.server-metrics {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
  gap: 18px;
  border-top: 1px solid var(--card-border-color);
  padding-top: 11px;
}
.server-metrics dt {
  font-size: 11px;
}
.server-metrics dd {
  font-weight: 600;
}
.server-details {
  min-width: 0;
  font-size: 12px;
}
summary {
  width: fit-content;
  cursor: pointer;
  color: var(--color-gray-9);
  min-height: 28px;
}
.server-details dl {
  display: grid;
  grid-template-columns: 100px minmax(0, 1fr);
  gap: 5px 12px;
  margin: 8px 0;
}
.server-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin-top: auto;
  align-self: end;
}
.server-actions :deep(.ant-btn) {
  font-size: 12px;
  padding-inline: 10px;
}
.console-action {
  color: var(--nx-accent, var(--color-blue-7));
  border-color: var(--nx-accent, var(--color-blue-5));
}
.server-power {
  // Each native action participates in the footer's natural wrapping.
  display: contents;
}
.server-power :deep(.power-icon-action) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  gap: 7px;
}
.terminate-action:not(:disabled) {
  color: var(--color-red-7);
}
.server-actions :deep(button:focus-visible) {
  outline: 2px solid var(--nx-accent, var(--color-blue-6));
  outline-offset: 3px;
}
summary:focus-visible {
  outline: 2px solid var(--nx-accent, var(--color-blue-6));
  outline-offset: 3px;
}
.layout-overview {
  padding: 22px;
  padding-left: 19px;
  gap: 20px;
}
.layout-overview .server-identity {
  --title-size: 17px;
}
.layout-overview .server-icon {
  width: 48px;
  height: 48px;
}
.layout-overview .server-versions {
  grid-row: 2;
}
.layout-overview .server-metrics {
  border: 0;
  padding: 0;
  gap: 12px;
}
.layout-overview .server-metrics > div {
  padding: 11px 12px;
  background: var(--background-color);
  border: 1px solid var(--card-border-color);
  border-radius: 5px;
}
.layout-overview .server-metrics dd {
  font-size: 18px;
  margin-top: 3px;
}
.layout-overview .server-actions {
  border-top: 1px solid var(--card-border-color);
  padding-top: 16px;
}
.layout-overview .console-action {
  flex: 1;
}
.memory-meter {
  height: 3px;
  background: var(--card-border-color);
  margin-top: 7px;
  border-radius: 2px;
}
.memory-meter i {
  display: block;
  height: 100%;
  background: var(--nx-accent, var(--color-blue-6));
  border-radius: 2px;
}
.layout-list {
  grid-template-columns:
    minmax(180px, 1.2fr) minmax(130px, 1fr) minmax(140px, 1fr) minmax(365px, max-content);
  align-items: center;
  gap: 16px;
  padding: 16px 18px;
  padding-left: 15px;
}
.layout-list .server-identity {
  --title-size: 14px;
  grid-column: 1 / -1;
}
.layout-list .server-icon {
  width: 30px;
  height: 30px;
}
.layout-list .server-metrics {
  border: 0;
  padding: 0;
  grid-template-columns: minmax(0, 1fr);
  gap: 5px;
}
.layout-list .server-metrics > div {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.layout-list .server-metrics dt {
  width: 46px;
  flex: none;
}
.layout-list .server-metrics dd {
  font-size: 12px;
}
.layout-list .server-actions {
  grid-column: 4 / -1;
  grid-row: 2;
  margin-top: 0;
  align-self: center;
}
.layout-list .server-details {
  grid-column: 1/-1;
}
@media (max-width: 1250px) {
  .layout-list {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr);
  }
  .layout-list .server-actions {
    grid-column: 1/-1;
    grid-row: 3;
    justify-self: end;
  }
  .layout-list .server-details {
    grid-column: 1/-1;
    grid-row: 4;
  }
}
@media (max-width: 760px) {
  .layout-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .layout-list .server-identity {
    grid-column: 1/-1;
  }
  .layout-list .server-actions {
    grid-column: 1/-1;
    grid-row: auto;
    justify-self: stretch;
  }
  .layout-list .server-details {
    grid-row: auto;
  }
  .layout-list .server-metrics {
    grid-column: 1/-1;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 560px) {
  .game-instance-card {
    padding: 16px;
    padding-left: 13px;
  }
  .server-actions {
    flex-wrap: wrap;
    gap: 6px;
  }
  .server-actions :deep(.ant-btn) {
    min-height: 44px;
  }
  .server-identity {
    --utility-size: 44px;
  }
  .layout-list .server-address,
  .layout-list .server-versions {
    grid-column: 1/-1;
  }
  summary {
    min-height: 36px;
  }
}
</style>
