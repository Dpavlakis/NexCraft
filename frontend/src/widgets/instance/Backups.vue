<script setup lang="ts">
import { inject } from "vue";
import { useRoute } from "vue-router";
const embeddedInManageModal = inject<boolean>("embeddedInManageModal", false);
import BetweenMenus from "@/components/BetweenMenus.vue";
import CardPanel from "@/components/CardPanel.vue";
import OperationProgress from "@/components/OperationProgress.vue";
import { useOperationProgress } from "@/hooks/useOperationProgress";
import { useAppRouters } from "@/hooks/useAppRouters";
import { getFileConfigAddr } from "@/hooks/useFileManager";
import { useScreen } from "@/hooks/useScreen";
import { t } from "@/lang/i18n";
import BackupList from "./BackupList.vue";
import BackupExclusions from "@/widgets/instance/dialogs/BackupExclusions.vue";
import {
  backupDownloadAddress,
  backupList,
  backupTaskStatus,
  createBackup,
  deleteBackup,
  getBackupConfig,
  restoreBackup,
  setBackupConfig,
  type BackupItem
} from "@/services/apis/backup";
import { parseForwardAddress } from "@/tools/protocol";
import { reportErrorMsg } from "@/tools/validator";
import type { LayoutCard } from "@/types/index";
import {
  CloudUploadOutlined,
  FolderOpenOutlined,
  RollbackOutlined,
  SaveOutlined
} from "@ant-design/icons-vue";
import { message } from "ant-design-vue";
import { onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";

const props = defineProps<{
  card: LayoutCard;
}>();

const { isPhone } = useScreen();
const { toPage } = useAppRouters();
const route = useRoute();
const getMetaOrRouteValue = (key: string) => props.card.meta[key] ?? route.query[key];
let instanceId = String(getMetaOrRouteValue("instanceId") ?? "");
let daemonId = String(getMetaOrRouteValue("daemonId") ?? "");

const targetKey = () =>
  JSON.stringify([getMetaOrRouteValue("daemonId"), getMetaOrRouteValue("instanceId")]);
let disposed = false;
let targetGeneration = 0;
let listRequest = 0;
let configRequest = 0;

const exclusionsDialog = ref<InstanceType<typeof BackupExclusions>>();

const toConsole = () => {
  toPage({
    path: "/instances/terminal",
    query: { daemonId, instanceId }
  });
};

const openExclusionsPicker = () => {
  const current = exclusionsText.value
    .split("\n")
    .map((v) => v.trim())
    .filter((v) => v !== "");
  exclusionsDialog.value?.openDialog(current);
};

const onExclusionsUpdate = (patterns: string[]) => {
  exclusionsText.value = patterns.join("\n");
};

// ---- Backup configuration form ----
const config = reactive({
  compress: true,
  maxBackups: 0,
  shutdown: false,
  preCommand: "",
  postCommand: ""
});
const exclusionsText = ref("");
const configLoading = ref(false);
const savingConfig = ref(false);

const loadConfig = async () => {
  const generation = targetGeneration;
  const request = ++configRequest;
  const current = () => !disposed && generation === targetGeneration && request === configRequest;
  const { execute } = getBackupConfig();
  try {
    configLoading.value = true;
    const res = await execute({ params: { daemonId, uuid: instanceId } });
    if (!current()) return;
    if (res.value) {
      config.compress = res.value.compress;
      config.maxBackups = res.value.maxBackups;
      config.shutdown = res.value.shutdown;
      config.preCommand = res.value.preCommand;
      config.postCommand = res.value.postCommand;
      exclusionsText.value = (res.value.exclusions || []).join("\n");
    }
  } catch (err: any) {
    if (current()) reportErrorMsg(err.message);
  } finally {
    if (current()) configLoading.value = false;
  }
};

const saveConfig = async () => {
  const generation = targetGeneration;
  if (disposed || savingConfig.value) return;
  const { execute } = setBackupConfig();
  try {
    savingConfig.value = true;
    const exclusions = exclusionsText.value
      .split("\n")
      .map((v) => v.trim())
      .filter((v) => v !== "");
    await execute({
      params: { daemonId, uuid: instanceId },
      data: {
        compress: config.compress,
        maxBackups: Number(config.maxBackups) || 0,
        shutdown: config.shutdown,
        preCommand: config.preCommand,
        postCommand: config.postCommand,
        exclusions
      }
    });
    if (!disposed && generation === targetGeneration)
      message.success(t("TXT_CODE_backup_config_saved"));
  } catch (err: any) {
    if (!disposed && generation === targetGeneration) reportErrorMsg(err.message);
  } finally {
    if (!disposed && generation === targetGeneration) savingConfig.value = false;
  }
};

// ---- Backup list ----
const backups = ref<BackupItem[]>([]);
const listLoading = ref(false);

const loadBackups = async () => {
  const generation = targetGeneration;
  const request = ++listRequest;
  const current = () => !disposed && generation === targetGeneration && request === listRequest;
  const { execute } = backupList();
  try {
    listLoading.value = true;
    const res = await execute({ params: { daemonId, uuid: instanceId }, forceRequest: true });
    if (current()) backups.value = res.value || [];
  } catch (err: any) {
    if (current()) reportErrorMsg(err.message);
  } finally {
    if (current()) listLoading.value = false;
  }
};

// ---- Backup and restore share one operation, including the pending start request. ----
const {
  busy: taskRunning,
  task,
  failure: taskFailure,
  start: startTask
} = useOperationProgress(
  targetKey,
  async (taskId) =>
    (
      await backupTaskStatus().execute({
        params: { daemonId, uuid: instanceId, task_id: taskId },
        forceRequest: true
      })
    ).value
);
const taskLabel = ref("");

const runBackup = async () => {
  if (disposed || taskRunning.value) return;
  taskLabel.value = t("TXT_CODE_backup_running_label");
  await startTask(
    async () => {
      const res = await createBackup().execute({
        params: { daemonId, uuid: instanceId },
        forceRequest: true
      });
      return res.value?.taskId || "";
    },
    {
      onStarted: () => message.success(t("TXT_CODE_backup_started")),
      onSuccess: () => {
        message.success(t("TXT_CODE_backup_created"));
        void loadBackups();
      }
    }
  );
};

const restore = async (record: BackupItem) => {
  if (disposed || taskRunning.value) return;
  taskLabel.value = t("TXT_CODE_backup_restoring");
  await startTask(
    async () => {
      const res = await restoreBackup().execute({
        params: { daemonId, uuid: instanceId },
        data: { file_name: record.name },
        forceRequest: true
      });
      return res.value?.taskId || "";
    },
    {
      onSuccess: () => message.success(t("TXT_CODE_backup_restore_done"))
    }
  );
};

const remove = async (record: BackupItem) => {
  const { execute } = deleteBackup();
  try {
    await execute({ params: { daemonId, uuid: instanceId, file_name: record.name } });
    message.success(t("TXT_CODE_backup_deleted"));
    loadBackups();
  } catch (err: any) {
    reportErrorMsg(err.message);
  }
};

const download = async (record: BackupItem) => {
  const { execute } = backupDownloadAddress();
  try {
    const res = await execute({
      params: { daemonId, uuid: instanceId, file_name: record.name }
    });
    if (!res.value) throw new Error(t("TXT_CODE_backup_task_failed"));
    const addr = parseForwardAddress(getFileConfigAddr(res.value), "http");
    window.open(`${addr}/backup-download/${res.value.password}/${record.name}`);
  } catch (err: any) {
    reportErrorMsg(err.message);
  }
};

watch(
  targetKey,
  () => {
    instanceId = String(getMetaOrRouteValue("instanceId") ?? "");
    daemonId = String(getMetaOrRouteValue("daemonId") ?? "");
    ++targetGeneration;
    backups.value = [];
    savingConfig.value = false;
    exclusionsText.value = "";
    Object.assign(config, {
      compress: true,
      maxBackups: 0,
      shutdown: false,
      preCommand: "",
      postCommand: ""
    });
    void loadConfig();
    void loadBackups();
  },
  { flush: "sync" }
);

onMounted(() => {
  loadConfig();
  loadBackups();
});

onBeforeUnmount(() => {
  disposed = true;
  ++targetGeneration;
});
</script>

<template>
  <div style="height: 100%" class="container">
    <a-row :gutter="[24, 24]" style="height: 100%">
      <a-col :span="24">
        <BetweenMenus>
          <template v-if="!isPhone && !embeddedInManageModal" #left>
            <a-typography-title class="mb-0" :level="4">
              <CloudUploadOutlined />
              {{ card.title }}
            </a-typography-title>
          </template>
          <template #right>
            <a-button v-if="!embeddedInManageModal" @click="toConsole">
              <template #icon><RollbackOutlined /></template>
              {{ t("TXT_CODE_backup_to_console") }}
            </a-button>
            <a-button @click="loadBackups">
              {{ t("TXT_CODE_b76d94e0") }}
            </a-button>
            <a-button type="primary" :loading="taskRunning" @click="runBackup">
              {{ t("TXT_CODE_backup_now") }}
            </a-button>
          </template>
        </BetweenMenus>
      </a-col>

      <a-col v-if="taskRunning || taskFailure" :span="24">
        <CardPanel>
          <template #body>
            <OperationProgress
              :task="task"
              kind="backup"
              :label="taskLabel"
              :failure="taskFailure"
            />
          </template>
        </CardPanel>
      </a-col>

      <!-- Left: configuration form -->
      <a-col :xs="24" :lg="9">
        <CardPanel style="height: 100%">
          <template #title>{{ t("TXT_CODE_backup_settings") }}</template>
          <template #body>
            <a-spin :spinning="configLoading">
              <a-form layout="vertical">
                <a-form-item>
                  <template #label>{{ t("TXT_CODE_backup_compress") }}</template>
                  <a-switch v-model:checked="config.compress" />
                  <a-typography-text type="secondary" class="ml-8">
                    {{ t("TXT_CODE_backup_compress_desc") }}
                  </a-typography-text>
                </a-form-item>
                <a-form-item>
                  <template #label>{{ t("TXT_CODE_backup_max") }}</template>
                  <a-input-number v-model:value="config.maxBackups" :min="0" style="width: 100%" />
                </a-form-item>
                <a-form-item>
                  <template #label>{{ t("TXT_CODE_backup_shutdown") }}</template>
                  <a-switch v-model:checked="config.shutdown" />
                </a-form-item>
                <a-form-item>
                  <template #label>{{ t("TXT_CODE_backup_pre_cmd") }}</template>
                  <a-input v-model:value="config.preCommand" />
                </a-form-item>
                <a-form-item>
                  <template #label>{{ t("TXT_CODE_backup_post_cmd") }}</template>
                  <a-input v-model:value="config.postCommand" />
                </a-form-item>
                <a-form-item>
                  <template #label>{{ t("TXT_CODE_backup_exclusions") }}</template>
                  <a-button class="mb-8" @click="openExclusionsPicker">
                    <FolderOpenOutlined />
                    {{ t("TXT_CODE_backup_exclusions_select") }}
                  </a-button>
                  <a-textarea
                    v-model:value="exclusionsText"
                    :rows="3"
                    :placeholder="t('TXT_CODE_backup_exclusions_ph')"
                  />
                </a-form-item>
                <a-button type="primary" :loading="savingConfig" @click="saveConfig">
                  <SaveOutlined />
                  {{ t("TXT_CODE_backup_save") }}
                </a-button>
              </a-form>
            </a-spin>
          </template>
        </CardPanel>
      </a-col>

      <!-- Right: backup list -->
      <a-col :xs="24" :lg="15">
        <CardPanel style="height: 100%">
          <template #title>{{ t("TXT_CODE_backup_list") }}</template>
          <template #body>
            <a-spin :spinning="listLoading">
              <BackupList
                :backups="backups"
                :task-running="taskRunning"
                @download="download"
                @restore="restore"
                @remove="remove"
              />
            </a-spin>
          </template>
        </CardPanel>
      </a-col>
    </a-row>
  </div>

  <BackupExclusions
    ref="exclusionsDialog"
    :daemon-id="daemonId"
    :instance-id="instanceId"
    @update="onExclusionsUpdate"
  />
</template>

<style lang="scss" scoped>
.ml-8 {
  margin-left: 8px;
}

// Tighten the settings form so the dialog fits without scrolling.
:deep(.ant-form-item) {
  margin-bottom: 12px;
}
:deep(.ant-form-item-label) {
  padding-bottom: 2px;
}
</style>
