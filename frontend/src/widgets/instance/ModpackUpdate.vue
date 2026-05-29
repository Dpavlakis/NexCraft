<script setup lang="ts">
import BetweenMenus from "@/components/BetweenMenus.vue";
import CardPanel from "@/components/CardPanel.vue";
import { useAppRouters } from "@/hooks/useAppRouters";
import { useLayoutCardTools } from "@/hooks/useCardTools";
import { useScreen } from "@/hooks/useScreen";
import { t } from "@/lang/i18n";
import { getInstanceInfo } from "@/services/apis/instance";
import {
  modpackVersions,
  modpackTaskStatus,
  reinstallServer,
  serverVersionsGet,
  updateModpack,
  type ModpackVersion
} from "@/services/apis/modpack";
import { reportErrorMsg } from "@/tools/validator";
import type { LayoutCard } from "@/types/index";
import {
  CloudDownloadOutlined,
  ReloadOutlined,
  RollbackOutlined,
  TagOutlined
} from "@ant-design/icons-vue";
import { message } from "ant-design-vue";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

const props = defineProps<{
  card: LayoutCard;
}>();

const { isPhone } = useScreen();
const { toPage } = useAppRouters();
const { getMetaOrRouteValue } = useLayoutCardTools(props.card);
const instanceId = String(getMetaOrRouteValue("instanceId") ?? "");
const daemonId = String(getMetaOrRouteValue("daemonId") ?? "");

const toConsole = () => {
  toPage({
    path: "/instances/terminal",
    query: { daemonId, instanceId }
  });
};

// ---- Current pack info (from instance config.packInfo) ----
const packInfo = ref<IModpackInfo>();
const infoLoading = ref(false);

const isBedrock = computed(() => packInfo.value?.source === "bedrock");
// CurseForge/Modrinth packs update from their source; Bedrock updates to a new
// Bedrock Dedicated Server release. Other custom (vanilla/loader) builds have no
// single "update" target.
const isUpdatable = computed(
  () =>
    packInfo.value?.source === "curseforge" ||
    packInfo.value?.source === "modrinth" ||
    isBedrock.value
);
// Bedrock is a server version, not a modpack — relabel the card accordingly.
const cardTitle = computed(() =>
  isBedrock.value ? t("TXT_CODE_version_update_card_title") : t("TXT_CODE_modpack_update_card_title")
);

const loadInfo = async () => {
  const { execute } = getInstanceInfo();
  try {
    infoLoading.value = true;
    const res = await execute({
      params: { uuid: instanceId, daemonId },
      forceRequest: true
    });
    packInfo.value = res.value?.config?.packInfo;
    if (isUpdatable.value) await loadVersions();
  } catch (err: any) {
    reportErrorMsg(err.message);
  } finally {
    infoLoading.value = false;
  }
};

// ---- Available versions ----
const versions = ref<ModpackVersion[]>([]);
const versionsLoading = ref(false);
const selectedVersion = ref<string>("");

const versionId = (v: ModpackVersion) => String(v.fileId || v.id || "");
const versionLabel = (v: ModpackVersion) =>
  v.displayName || v.name || v.version_number || versionId(v);
// CurseForge packs without a server pack file can't be installed/updated.
const isInstallable = (v: ModpackVersion) =>
  packInfo.value?.source === "curseforge" ? v.hasServerPack !== false && !!v.fileId : true;

// What identifies the currently-installed version: Bedrock keys off the MC
// version string, modpacks key off the file id.
const currentVersionKey = computed(() =>
  isBedrock.value ? packInfo.value?.mcVersion : packInfo.value?.fileId
);

const versionOptions = computed(() =>
  versions.value.filter(isInstallable).map((v) => {
    const id = versionId(v);
    const isCurrent = id === currentVersionKey.value;
    const mc = v.mcVersion || (v.game_versions && v.game_versions[0]) || "";
    return {
      value: id,
      label: `${versionLabel(v)}${mc ? `  ·  ${mc}` : ""}${
        isCurrent ? `  (${t("TXT_CODE_modpack_update_current")})` : ""
      }`
    };
  })
);

const loadVersions = async () => {
  if (!packInfo.value) return;
  try {
    versionsLoading.value = true;
    if (isBedrock.value) {
      // Bedrock: list the available Bedrock Dedicated Server releases.
      const res = await serverVersionsGet().execute({
        params: { software: "bedrock" },
        forceRequest: true
      });
      versions.value = (res.value || []).map((v) => ({ id: v.id, name: v.id }));
    } else {
      const res = await modpackVersions().execute({
        params: { source: packInfo.value.source, projectId: packInfo.value.projectId },
        forceRequest: true
      });
      versions.value = res.value || [];
    }
    // Default the picker to the newest installable version
    const first = versions.value.find(isInstallable);
    selectedVersion.value = first ? versionId(first) : "";
  } catch (err: any) {
    reportErrorMsg(err.message);
  } finally {
    versionsLoading.value = false;
  }
};

const isCurrentSelected = computed(
  () => !!selectedVersion.value && selectedVersion.value === currentVersionKey.value
);

const formatTime = (ms?: number) => (ms ? new Date(ms).toLocaleString() : "-");

// ---- Update task polling ----
let pollTimer: ReturnType<typeof setInterval> | undefined;
const taskRunning = ref(false);
const taskProgress = ref(0);
const taskLabel = ref("");

const stopPolling = () => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }
};

const pollTask = (taskId: string, onDone: () => void) => {
  taskRunning.value = true;
  taskProgress.value = 0;
  taskLabel.value = t("TXT_CODE_modpack_update_running");
  stopPolling();
  pollTimer = setInterval(async () => {
    const { execute } = modpackTaskStatus();
    try {
      const res = await execute({
        params: { daemonId, task_id: taskId },
        forceRequest: true
      });
      const task = res.value;
      if (!task) {
        stopPolling();
        taskRunning.value = false;
        onDone();
        return;
      }
      if (task.phase) taskLabel.value = task.phase;
      if (task.downloadProgress) taskProgress.value = task.downloadProgress.percentage || 0;
      // status: 1 running, 0 stopped/done, -1 error
      if (task.status !== 1) {
        stopPolling();
        taskRunning.value = false;
        if (task.status === -1) {
          reportErrorMsg(t("TXT_CODE_modpack_update_failed"));
        } else {
          onDone();
        }
      }
    } catch (err: any) {
      stopPolling();
      taskRunning.value = false;
      reportErrorMsg(err.message);
    }
  }, 1500);
};

const runUpdate = async () => {
  if (taskRunning.value || !packInfo.value || !selectedVersion.value) return;
  try {
    let taskId = "";
    if (isBedrock.value) {
      // Reinstall the new Bedrock Dedicated Server, preserving the world.
      const res = await reinstallServer().execute({
        params: { daemonId, uuid: instanceId },
        data: {
          mcVersion: selectedVersion.value,
          loader: "bedrock",
          acceptEula: true,
          resetMode: "preserve_world"
        }
      });
      taskId = res.value?.taskId || "";
    } else {
      const chosen = versions.value.find((v) => versionId(v) === selectedVersion.value);
      const res = await updateModpack().execute({
        params: { daemonId, uuid: instanceId },
        data: {
          source: packInfo.value.source,
          projectId: packInfo.value.projectId,
          projectName: packInfo.value.projectName,
          fileId: selectedVersion.value,
          versionName: chosen ? versionLabel(chosen) : ""
        }
      });
      taskId = res.value?.taskId || "";
    }
    if (!taskId) throw new Error(t("TXT_CODE_modpack_update_failed"));
    message.success(t("TXT_CODE_modpack_update_started"));
    pollTask(taskId, () => {
      message.success(t("TXT_CODE_modpack_update_done"));
      loadInfo();
    });
  } catch (err: any) {
    reportErrorMsg(err.message);
  }
};

onMounted(() => {
  loadInfo();
});

onBeforeUnmount(() => {
  stopPolling();
});
</script>

<template>
  <div style="height: 100%" class="container">
    <a-row :gutter="[24, 24]" style="height: 100%">
      <a-col :span="24">
        <BetweenMenus>
          <template v-if="!isPhone" #left>
            <a-typography-title class="mb-0" :level="4">
              <CloudDownloadOutlined />
              {{ cardTitle }}
            </a-typography-title>
          </template>
          <template #right>
            <a-button @click="toConsole">
              <template #icon><RollbackOutlined /></template>
              {{ t("TXT_CODE_backup_to_console") }}
            </a-button>
            <a-button :disabled="!isUpdatable" :loading="versionsLoading" @click="loadInfo">
              <template #icon><ReloadOutlined /></template>
              {{ t("TXT_CODE_b76d94e0") }}
            </a-button>
          </template>
        </BetweenMenus>
      </a-col>

      <a-col v-if="taskRunning" :span="24">
        <CardPanel>
          <template #body>
            <div class="mb-8">{{ taskLabel }}</div>
            <a-progress :percent="taskProgress" status="active" />
          </template>
        </CardPanel>
      </a-col>

      <a-col :span="24">
        <CardPanel style="height: 100%">
          <template #title>{{ cardTitle }}</template>
          <template #body>
            <a-spin :spinning="infoLoading">
              <!-- Not a modpack instance -->
              <a-empty
                v-if="!infoLoading && !packInfo"
                :description="t('TXT_CODE_modpack_update_none')"
              />

              <template v-else-if="packInfo">
                <!-- Current pack header -->
                <div class="pack-header">
                  <a-avatar
                    v-if="packInfo.iconUrl"
                    :src="packInfo.iconUrl"
                    shape="square"
                    :size="56"
                  />
                  <div class="pack-meta">
                    <div class="pack-name">{{ packInfo.projectName }}</div>
                    <a-space :size="6" wrap>
                      <a-tag color="blue">{{ packInfo.source }}</a-tag>
                      <a-tag v-if="packInfo.loader">{{ packInfo.loader }}</a-tag>
                      <a-tag v-if="packInfo.mcVersion">MC {{ packInfo.mcVersion }}</a-tag>
                    </a-space>
                  </div>
                </div>

                <a-descriptions
                  class="mt-16"
                  :column="1"
                  size="small"
                  bordered
                >
                  <a-descriptions-item :label="t('TXT_CODE_modpack_update_installed_ver')">
                    <TagOutlined />
                    {{ packInfo.versionName || "-" }}
                  </a-descriptions-item>
                  <a-descriptions-item :label="t('TXT_CODE_modpack_update_installed_at')">
                    {{ formatTime(packInfo.installedAt) }}
                  </a-descriptions-item>
                </a-descriptions>

                <!-- Custom (vanilla) instances: no remote updates -->
                <a-alert
                  v-if="!isUpdatable"
                  class="mt-16"
                  type="info"
                  show-icon
                  :message="t('TXT_CODE_modpack_update_custom')"
                />

                <!-- Update picker -->
                <template v-else>
                  <div class="mt-16 mb-4">
                    <a-typography-text strong>
                      {{ t("TXT_CODE_modpack_update_pick") }}
                    </a-typography-text>
                  </div>
                  <a-space :size="8" wrap style="width: 100%">
                    <a-select
                      v-model:value="selectedVersion"
                      :loading="versionsLoading"
                      :options="versionOptions"
                      :placeholder="t('TXT_CODE_modpack_update_pick')"
                      style="min-width: 320px"
                      show-search
                      option-filter-prop="label"
                    />
                    <a-popconfirm
                      :title="
                        isBedrock
                          ? t('TXT_CODE_version_update_confirm')
                          : t('TXT_CODE_modpack_update_confirm')
                      "
                      :ok-text="t('TXT_CODE_modpack_update_btn')"
                      @confirm="runUpdate"
                    >
                      <a-button
                        type="primary"
                        :loading="taskRunning"
                        :disabled="!selectedVersion || isCurrentSelected || taskRunning"
                      >
                        <template #icon><CloudDownloadOutlined /></template>
                        {{ t("TXT_CODE_modpack_update_btn") }}
                      </a-button>
                    </a-popconfirm>
                  </a-space>
                  <div class="mt-8">
                    <a-typography-text type="secondary">
                      {{
                        isBedrock
                          ? t("TXT_CODE_version_update_note")
                          : t("TXT_CODE_modpack_update_backup_note")
                      }}
                    </a-typography-text>
                  </div>
                </template>
              </template>
            </a-spin>
          </template>
        </CardPanel>
      </a-col>
    </a-row>
  </div>
</template>

<style lang="scss" scoped>
.pack-header {
  display: flex;
  align-items: center;
  gap: 14px;
}
.pack-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pack-name {
  font-size: 18px;
  font-weight: 600;
}
.mt-16 {
  margin-top: 16px;
}
.mt-8 {
  margin-top: 8px;
}
.mb-8 {
  margin-bottom: 8px;
}
.mb-4 {
  margin-bottom: 4px;
}
</style>
