<script setup lang="ts">
import CardPanel from "@/components/CardPanel.vue";
import InstanceSecondaryActions from "@/components/InstanceSecondaryActions.vue";
import InstanceVersionInfo from "@/components/InstanceVersionInfo.vue";
import { useAppRouters } from "@/hooks/useAppRouters";
import { useGameEndpoint } from "@/hooks/useGameEndpoint";
import { getFileConfigAddr } from "@/hooks/useFileManager";
import { useInstanceInfo } from "@/hooks/useInstance";
import { t } from "@/lang/i18n";
import { downloadAddress } from "@/services/apis/fileManager";
import { useLayoutContainerStore } from "@/stores/useLayoutContainerStore";
import { loaderIconFor } from "@/tools/loaderIcon";
import { formatMemoryUsage } from "@/tools/memory";
import { parseForwardAddress } from "@/tools/protocol";
import { reportErrorMsg } from "@/tools/validator";
import type { LayoutCard } from "@/types";
import {
  CheckCircleOutlined,
  DatabaseOutlined,
  ExclamationCircleOutlined
} from "@ant-design/icons-vue";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { GLOBAL_INSTANCE_NAME } from "../../config/const";
import { useLayoutCardTools } from "../../hooks/useCardTools";
import { parseTimestamp } from "../../tools/time";
import DockerInfo from "./dialogs/DockerInfo.vue";

const props = defineProps<{ card: LayoutCard }>();
const DockerInfoDialog = ref<InstanceType<typeof DockerInfo>>();
const { getMetaOrRouteValue } = useLayoutCardTools(props.card);
const instanceId = getMetaOrRouteValue("instanceId");
const daemonId = getMetaOrRouteValue("daemonId");
const initialCard = props.card;
const { containerState } = useLayoutContainerStore();
const { toPage } = useAppRouters();
const { statusText, isRunning, isStopped, instanceTypeText, instanceInfo, execute } =
  useInstanceInfo({ instanceId, daemonId, autoRefresh: true });
let active = true;
let generation = 0;
watch(
  () => [
    props.card,
    getMetaOrRouteValue("instanceId", false),
    getMetaOrRouteValue("daemonId", false)
  ],
  () => {
    generation++;
  },
  { flush: "sync" }
);
onBeforeUnmount(() => {
  active = false;
  generation++;
});
const ownsTarget = () =>
  active &&
  props.card === initialCard &&
  getMetaOrRouteValue("instanceId", false) === instanceId &&
  getMetaOrRouteValue("daemonId", false) === daemonId;
const info = computed(() => (ownsTarget() ? instanceInfo.value : undefined));
const gameEndpoint = useGameEndpoint(() => info.value);
const isMinecraft = computed(() => info.value?.config.type.includes("minecraft"));
const edition = computed(() =>
  info.value?.config.type.startsWith("minecraft/bedrock")
    ? t("TXT_CODE_7f1aef9f")
    : info.value?.config.type.startsWith("minecraft/java")
    ? t("TXT_CODE_97f779b3")
    : instanceTypeText.value
);
const pack = computed(() => info.value?.config.packInfo);
const isModpack = computed(() =>
  ["curseforge", "modrinth", "ftb"].includes(pack.value?.source || "")
);
const nickname = computed(() =>
  info.value?.config.nickname === GLOBAL_INSTANCE_NAME
    ? t("TXT_CODE_5bdaf23d")
    : info.value?.config.nickname || t("TXT_CODE_info_unnamed")
);
const unknown = () => t("TXT_CODE_info_unavailable");
const players = computed(() => {
  if (isStopped.value) return t("TXT_CODE_info_stopped_metrics");
  const runtime = info.value?.info;
  if (!isRunning.value || !runtime?.mcPingOnline) return unknown();
  const count = (n: unknown) =>
    typeof n === "number" && Number.isInteger(n) && n >= 0 ? String(n) : unknown();
  return count(runtime.currentPlayers) + " / " + count(runtime.maxPlayers);
});
const memory = computed(() => {
  if (isStopped.value) return t("TXT_CODE_info_stopped_metrics");
  const usage = info.value?.info?.memoryUsage;
  const limit = info.value?.info?.memoryLimit;
  if (!isRunning.value || typeof usage !== "number" || !Number.isFinite(usage) || usage < 0)
    return unknown();
  return formatMemoryUsage(
    usage,
    typeof limit === "number" && Number.isFinite(limit) && limit > 0 ? limit : undefined
  );
});
// Ping data is runtime evidence only while the server is running.
const versionInstance = computed(
  () =>
    info.value && {
      ...info.value,
      info: { ...info.value.info, mcPingOnline: isRunning.value && !!info.value.info?.mcPingOnline }
    }
);
const distinctRunningVersion = computed(() => {
  // The native version component already shows reported data when installed MC is absent.
  if (!pack.value?.mcVersion) return "";
  const installed =
    pack.value?.source === "bedrock"
      ? pack.value.versionName || pack.value.mcVersion
      : pack.value?.mcVersion;
  const reported = info.value?.info?.version;
  return isRunning.value &&
    info.value?.info?.mcPingOnline &&
    installed &&
    reported &&
    installed.trim() !== reported.trim()
    ? reported
    : "";
});
const activity = computed(() => [
  { label: t("TXT_CODE_ad30f3c5"), value: info.value?.started ?? unknown() },
  { label: t("TXT_CODE_6420023d"), value: info.value?.autoRestarted ?? unknown() },
  {
    label: t("TXT_CODE_8b8e08a6"),
    value: parseTimestamp(info.value?.config.createDatetime) || unknown()
  },
  {
    label: t("TXT_CODE_46f575ae"),
    value: parseTimestamp(info.value?.config.lastDatetime) || unknown()
  },
  {
    label: t("TXT_CODE_ae747cc0"),
    value: info.value
      ? parseTimestamp(info.value.config.endTime) || t("TXT_CODE_e3a77a77")
      : unknown()
  }
]);
const technical = computed(() => [
  { label: t("TXT_CODE_30051f9b"), value: info.value?.instanceUuid || instanceId },
  { label: t("TXT_CODE_5f2d2e30"), value: daemonId },
  { label: t("TXT_CODE_info_directory"), value: info.value?.config.cwd }
]);
// Capture handlers per context; delayed dialogs cannot refresh or navigate another target.
const actionHandlers = computed(() => {
  // Register reactive dependencies even when the captured card is replaced.
  void props.card;
  void getMetaOrRouteValue("instanceId", false);
  void getMetaOrRouteValue("daemonId", false);
  const ownerGeneration = generation;
  const target = { instanceId, daemonId };
  const current = () =>
    ownsTarget() && generation === ownerGeneration && !containerState.isDesignMode;
  return {
    changed: async () => {
      if (!current() || !target.instanceId || !target.daemonId) return;
      try {
        await execute({
          params: { uuid: target.instanceId, daemonId: target.daemonId },
          forceRequest: true
        });
      } catch (error) {
        if (current()) reportErrorMsg(error);
      }
    },
    deleted: () => {
      if (!current()) return;
      toPage({ path: "/", query: { instanceId: undefined, daemonId: undefined } });
    }
  };
});

const serverIconUrl = ref("");
const failedIcon = ref("");
const displayIcon = computed(() => {
  const icon = serverIconUrl.value || loaderIconFor(pack.value);
  return icon === failedIcon.value ? "" : icon;
});
let iconRequested = false;
watch(
  isMinecraft,
  async (minecraft) => {
    if (!minecraft || iconRequested || !instanceId || !daemonId || !ownsTarget()) return;
    iconRequested = true;
    const ownerGeneration = generation;
    try {
      const res = await downloadAddress().execute({
        params: { file_name: "server-icon.png", daemonId, uuid: instanceId }
      });
      if (!res.value || !ownsTarget() || generation !== ownerGeneration) return;
      const addr = parseForwardAddress(getFileConfigAddr(res.value), "http");
      serverIconUrl.value = `${addr}/download/${res.value.password}/server-icon.png`;
    } catch {
      // Missing custom icon keeps the bundled software logo.
    }
  },
  { immediate: true }
);
const iconFailed = () => {
  failedIcon.value = displayIcon.value;
  serverIconUrl.value = "";
};
</script>

<template>
  <CardPanel class="basic-info" :full-height="false">
    <template #body>
      <header class="basic-header">
        <img
          v-if="displayIcon"
          :src="displayIcon"
          class="basic-icon"
          alt=""
          width="44"
          height="44"
          @error="iconFailed"
        />
        <span v-else class="basic-icon basic-icon-fallback" aria-hidden="true"><DatabaseOutlined /></span>
        <div class="basic-heading">
          <h2>{{ nickname }}</h2>
          <p>{{ card.title }}</p>
        </div>
        <span class="basic-status" :class="{ running: isRunning }" role="status">
          <CheckCircleOutlined v-if="isRunning" /><ExclamationCircleOutlined v-else />
          {{ info ? statusText : unknown() }}
        </span>
        <InstanceSecondaryActions
          v-if="instanceId && daemonId"
          :instance-id="instanceId"
          :daemon-id="daemonId"
          :nickname="info?.config.nickname"
          :tags="info?.config.tag"
          :menu="true"
          :disabled="containerState.isDesignMode || !info"
          v-on="actionHandlers"
        />
      </header>

      <div v-if="isMinecraft" class="basic-endpoint">
        <div class="basic-endpoint-label">
          {{ t("TXT_CODE_game_endpoint_configured_address_label") }}
          <span v-if="gameEndpoint.protocol" class="basic-protocol">{{
            gameEndpoint.protocol.toUpperCase()
          }}</span>
        </div>
        <a-typography-text
          v-if="gameEndpoint.address"
          class="basic-address"
          :copyable="{ text: gameEndpoint.address }"
        >
          {{ gameEndpoint.address }}
        </a-typography-text>
        <p v-else class="basic-unavailable">
          {{
            info && !info.gameEndpoint
              ? t("TXT_CODE_game_endpoint_daemon_update_hint")
              : t(gameEndpoint.unknown)
          }}
        </p>
      </div>

      <div class="basic-groups">
        <section>
          <h3>{{ t("TXT_CODE_info_server") }}</h3>
          <dl class="bounded-dl">
            <dt>{{ t("TXT_CODE_info_software") }}</dt>
            <dd>{{ pack?.loader || instanceTypeText }}</dd>
            <dt>{{ t("TXT_CODE_68831be6") }}</dt>
            <dd>{{ edition }}</dd>
            <dt>{{ t("TXT_CODE_eaabd222") }}</dt>
            <dd class="basic-tags">
              <template v-if="info?.config.tag?.length">
                <a-tag v-for="tag in info.config.tag" :key="tag">{{ tag }}</a-tag>
              </template>
              <span v-else>{{ t("TXT_CODE_info_no_tags") }}</span>
            </dd>
          </dl>
          <dl class="basic-stats">
            <div v-if="isMinecraft">
              <dt>{{ t("TXT_CODE_855c4a1c") }}</dt>
              <dd>{{ players }}</dd>
            </div>
            <div>
              <dt>{{ t("TXT_CODE_info_memory") }}</dt>
              <dd>{{ memory }}</dd>
            </div>
          </dl>
        </section>
        <section v-if="isMinecraft && versionInstance">
          <h3>{{ t("TXT_CODE_info_game") }}</h3>
          <dl v-if="isModpack" class="bounded-dl pack-name">
            <dt>{{ t("TXT_CODE_info_modpack") }}</dt>
            <dd>{{ pack?.projectName || unknown() }}</dd>
          </dl>
          <InstanceVersionInfo :instance="versionInstance" :daemon-id="String(daemonId)" />
          <dl v-if="distinctRunningVersion" class="bounded-dl running-version">
            <dt>{{ t("TXT_CODE_info_running_version") }}</dt>
            <dd>{{ distinctRunningVersion }}</dd>
          </dl>
        </section>
      </div>

      <details class="basic-details">
        <summary>{{ t("TXT_CODE_info_activity") }}</summary>
        <dl class="bounded-dl">
          <template v-for="row in activity" :key="row.label">
            <dt>{{ row.label }}</dt>
            <dd>{{ row.value }}</dd>
          </template>
        </dl>
      </details>
      <details class="basic-details">
        <summary>{{ t("TXT_CODE_info_technical") }}</summary>
        <dl class="bounded-dl basic-technical">
          <template v-for="row in technical" :key="row.label">
            <dt>{{ row.label }}</dt>
            <dd>
              <a-typography-text v-if="row.value" :copyable="{ text: row.value }">
                <code>{{ row.value }}</code>
              </a-typography-text><span v-else>{{ unknown() }}</span>
            </dd>
          </template>
          <template v-if="info?.config.processType === 'docker'">
            <dt>{{ t("TXT_CODE_4f917a65") }}</dt>
            <dd>
              <a-button type="link" @click="DockerInfoDialog?.openDialog()">
                {{
                  t("TXT_CODE_530f5951")
                }}
              </a-button>
            </dd>
          </template>
          <template v-if="info?.info?.allocatedPorts?.length">
            <dt>{{ t("TXT_CODE_2e4469f6") }}</dt>
            <dd class="legacy-ports">
              <div v-for="(port, index) in info.info.allocatedPorts" :key="index">
                <a-tag>{{ port.protocol.toUpperCase() }}</a-tag>
                {{ t("TXT_CODE_8dfc41ef") }}: {{ port.host }} · {{ t("TXT_CODE_8f8103b7") }}:
                {{ port.container }}
              </div>
            </dd>
          </template>
        </dl>
      </details>
    </template>
  </CardPanel>
  <DockerInfo ref="DockerInfoDialog" :docker-info="info?.config.docker" />
</template>

<style lang="scss" scoped>
.basic-info {
  container: instance-info / inline-size;
  min-width: 0;
  height: auto !important;
  padding: 24px;
  font-size: 14px;
  line-height: 1.6;
  :deep(.card-panel-content) {
    word-break: normal;
  }
}
.basic-header {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  margin-bottom: 24px;
}
.basic-icon {
  width: 44px;
  height: 44px;
  flex: none;
  object-fit: contain;
  border-radius: 5px;
}
.basic-icon-fallback {
  display: grid;
  place-items: center;
  color: var(--color-gray-8);
  background: var(--color-gray-3);
  font-size: 24px;
}
.basic-heading {
  flex: 1;
  min-width: 0;
  h2 {
    margin: 0;
    font-size: 19px;
    font-weight: 600;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
  p {
    margin: 2px 0 0;
    color: var(--color-gray-8);
  }
}
.basic-status {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 7px;
  font-size: 13px;
  color: var(--color-gray-8);
  white-space: nowrap;
  &.running {
    color: var(--color-green-7);
  }
}
.basic-endpoint {
  max-width: 760px;
  margin-bottom: 28px;
}
.basic-endpoint-label {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--color-gray-8);
  font-size: 13px;
  margin-bottom: 2px;
}
.basic-protocol {
  font-size: 11px;
  letter-spacing: 0.4px;
}
.basic-address {
  font-size: 22px;
  font-weight: 600;
  line-height: 1.5;
  overflow-wrap: anywhere;
  font-variant-numeric: tabular-nums;
}
.basic-unavailable {
  color: var(--color-gray-8);
  margin: 0;
}
.basic-groups {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 440px));
  column-gap: 56px;
  row-gap: 28px;
}
.basic-groups > section {
  min-width: 0;
}
h3 {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 12px;
}
.bounded-dl {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr);
  gap: 9px 16px;
  max-width: 520px;
  margin: 0;
  dt {
    color: var(--color-gray-8);
    overflow-wrap: anywhere;
  }
  dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
    font-variant-numeric: tabular-nums;
  }
}
.basic-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  :deep(.ant-tag) {
    margin: 0;
    max-width: 100%;
    white-space: normal;
    overflow-wrap: anywhere;
  }
}
.basic-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  margin: 20px 0 0;
  > div {
    min-width: 0;
    max-width: 100%;
  }
  dt {
    font-size: 13px;
    color: var(--color-gray-8);
  }
  dd {
    margin: 3px 0 0;
    overflow-wrap: anywhere;
    font-variant-numeric: tabular-nums;
  }
}
.pack-name {
  margin-bottom: 9px;
}
.running-version {
  margin-top: 12px;
}
.basic-groups :deep(.version-row) {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr);
  gap: 9px 16px;
  padding: 0;
  margin-bottom: 9px;
  dt {
    max-width: none;
  }
  dd {
    margin: 0;
    text-align: start;
    white-space: normal;
    overflow-wrap: anywhere;
  }
}
.basic-groups :deep(.version-status) {
  margin-top: 16px;
}
.basic-details {
  border-top: 1px solid var(--card-border-color);
  margin-top: 24px;
  + .basic-details {
    margin-top: 0;
  }
  summary {
    padding: 13px 0;
    min-height: 48px;
    box-sizing: border-box;
    cursor: pointer;
    color: var(--color-gray-8);
    &:focus-visible {
      outline: 2px solid var(--color-primary);
      outline-offset: 2px;
    }
  }
  &[open] summary {
    color: var(--text-color);
  }
  .bounded-dl {
    max-width: 800px;
    padding-bottom: 20px;
  }
}
.basic-technical {
  code {
    font-size: 13px;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  :deep(.ant-typography) {
    color: inherit;
  }
}
.legacy-ports > div {
  margin-bottom: 6px;
}
@container instance-info (max-width: 620px) {
  .basic-header {
    flex-wrap: wrap;
    gap: 10px;
  }
  .basic-heading h2 {
    font-size: 17px;
  }
  .basic-status {
    order: 3;
    flex-basis: 100%;
    padding-left: 54px;
    margin-top: -5px;
  }
  .basic-address {
    font-size: 19px;
  }
  .basic-groups {
    grid-template-columns: minmax(0, 1fr);
    gap: 24px;
  }
  .bounded-dl,
  .basic-groups :deep(.version-row) {
    grid-template-columns: 105px minmax(0, 1fr);
    gap: 9px 12px;
  }
  :deep(.ant-typography-copy) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
  }
}
@media (max-width: 560px) {
  .basic-info {
    padding: 18px 16px;
  }
}
</style>
