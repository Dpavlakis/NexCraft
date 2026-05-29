<script setup lang="ts">
import BetweenMenus from "@/components/BetweenMenus.vue";
import CardPanel from "@/components/CardPanel.vue";
import { useAppRouters } from "@/hooks/useAppRouters";
import { useLayoutCardTools } from "@/hooks/useCardTools";
import { getFileConfigAddr } from "@/hooks/useFileManager";
import { useScreen } from "@/hooks/useScreen";
import { t } from "@/lang/i18n";
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
  DeleteOutlined,
  DownloadOutlined,
  FolderOpenOutlined,
  RedoOutlined,
  RollbackOutlined,
  SaveOutlined
} from "@ant-design/icons-vue";
import { message } from "ant-design-vue";
import { onBeforeUnmount, onMounted, reactive, ref } from "vue";
import type { AntColumnsType } from "../../types/ant";

const props = defineProps<{
  card: LayoutCard;
}>();

const { isPhone } = useScreen();
const { toPage } = useAppRouters();
const { getMetaOrRouteValue } = useLayoutCardTools(props.card);
const instanceId = String(getMetaOrRouteValue("instanceId") ?? "");
const daemonId = String(getMetaOrRouteValue("daemonId") ?? "");

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
  const { execute } = getBackupConfig();
  try {
    configLoading.value = true;
    const res = await execute({ params: { daemonId, uuid: instanceId } });
    if (res.value) {
      config.compress = res.value.compress;
      config.maxBackups = res.value.maxBackups;
      config.shutdown = res.value.shutdown;
      config.preCommand = res.value.preCommand;
      config.postCommand = res.value.postCommand;
      exclusionsText.value = (res.value.exclusions || []).join("\n");
    }
  } catch (err: any) {
    reportErrorMsg(err.message);
  } finally {
    configLoading.value = false;
  }
};

const saveConfig = async () => {
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
    message.success(t("TXT_CODE_backup_config_saved"));
  } catch (err: any) {
    reportErrorMsg(err.message);
  } finally {
    savingConfig.value = false;
  }
};

// ---- Backup list ----
const backups = ref<BackupItem[]>([]);
const listLoading = ref(false);

const loadBackups = async () => {
  const { execute } = backupList();
  try {
    listLoading.value = true;
    const res = await execute({ params: { daemonId, uuid: instanceId }, forceRequest: true });
    backups.value = res.value || [];
  } catch (err: any) {
    reportErrorMsg(err.message);
  } finally {
    listLoading.value = false;
  }
};

const formatSize = (bytes: number) => {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(2)} ${units[i]}`;
};

const formatTime = (ms: number) => (ms ? new Date(ms).toLocaleString() : "-");

// ---- Task polling (shared by backup & restore) ----
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

const pollTask = (taskId: string, label: string, onDone: () => void) => {
  taskRunning.value = true;
  taskProgress.value = 0;
  taskLabel.value = label;
  stopPolling();
  pollTimer = setInterval(async () => {
    const { execute } = backupTaskStatus();
    try {
      const res = await execute({
        params: { daemonId, uuid: instanceId, task_id: taskId },
        forceRequest: true
      });
      const task = res.value;
      // No task found (already cleaned up) -> treat as finished
      if (!task) {
        stopPolling();
        taskRunning.value = false;
        onDone();
        return;
      }
      if (task.progress) taskProgress.value = task.progress.percentage || 0;
      // status: 1 running, 0 stopped, -1 error
      if (task.status !== 1) {
        stopPolling();
        taskRunning.value = false;
        if (task.status === -1) {
          reportErrorMsg(t("TXT_CODE_backup_task_failed"));
        }
        onDone();
      }
    } catch (err: any) {
      stopPolling();
      taskRunning.value = false;
      reportErrorMsg(err.message);
    }
  }, 1500);
};

const runBackup = async () => {
  if (taskRunning.value) return;
  const { execute } = createBackup();
  try {
    const res = await execute({ params: { daemonId, uuid: instanceId } });
    if (!res.value?.taskId) throw new Error(t("TXT_CODE_backup_task_failed"));
    message.success(t("TXT_CODE_backup_started"));
    pollTask(res.value.taskId, t("TXT_CODE_backup_running_label"), () => {
      message.success(t("TXT_CODE_backup_created"));
      loadBackups();
    });
  } catch (err: any) {
    reportErrorMsg(err.message);
  }
};

const restore = async (record: BackupItem) => {
  if (taskRunning.value) return;
  const { execute } = restoreBackup();
  try {
    const res = await execute({
      params: { daemonId, uuid: instanceId },
      data: { file_name: record.name }
    });
    if (!res.value?.taskId) throw new Error(t("TXT_CODE_backup_task_failed"));
    message.loading({ content: t("TXT_CODE_backup_restoring"), key: "restore" });
    pollTask(res.value.taskId, t("TXT_CODE_backup_restoring"), () => {
      message.success({ content: t("TXT_CODE_backup_restore_done"), key: "restore" });
    });
  } catch (err: any) {
    reportErrorMsg(err.message);
  }
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

const columns: AntColumnsType[] = [
  {
    align: "center",
    title: t("TXT_CODE_backup_col_name"),
    dataIndex: "name",
    key: "name",
    minWidth: 220
  },
  {
    align: "center",
    title: t("TXT_CODE_backup_col_size"),
    dataIndex: "size",
    key: "size",
    minWidth: 100,
    customRender: (e: { text: number }) => formatSize(e.text)
  },
  {
    align: "center",
    title: t("TXT_CODE_backup_col_time"),
    dataIndex: "time",
    key: "time",
    minWidth: 160,
    customRender: (e: { text: number }) => formatTime(e.text)
  },
  {
    align: "center",
    title: t("TXT_CODE_82fbc5ad"),
    key: "actions",
    minWidth: 240
  }
];

onMounted(() => {
  loadConfig();
  loadBackups();
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
              <CloudUploadOutlined />
              {{ card.title }}
            </a-typography-title>
          </template>
          <template #right>
            <a-button @click="toConsole">
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

      <a-col v-if="taskRunning" :span="24">
        <CardPanel>
          <template #body>
            <div class="mb-8">{{ taskLabel }}</div>
            <a-progress :percent="taskProgress" status="active" />
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
                    :rows="4"
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
              <a-table
                :data-source="backups"
                :columns="columns"
                row-key="name"
                :scroll="{ x: 'max-content' }"
                :pagination="{ pageSize: 10 }"
              >
                <template #bodyCell="{ column, record }">
                  <template v-if="column.key === 'actions'">
                    <a-button class="mr-8" size="small" @click="download(record as BackupItem)">
                      <DownloadOutlined />
                      {{ t("TXT_CODE_backup_download") }}
                    </a-button>
                    <a-popconfirm
                      :title="t('TXT_CODE_backup_restore_confirm')"
                      @confirm="restore(record as BackupItem)"
                    >
                      <a-button class="mr-8" size="small" :disabled="taskRunning">
                        <RedoOutlined />
                        {{ t("TXT_CODE_backup_restore") }}
                      </a-button>
                    </a-popconfirm>
                    <a-popconfirm
                      :title="t('TXT_CODE_backup_delete_confirm')"
                      @confirm="remove(record as BackupItem)"
                    >
                      <a-button danger size="small">
                        <DeleteOutlined />
                        {{ t("TXT_CODE_ecbd7449") }}
                      </a-button>
                    </a-popconfirm>
                  </template>
                </template>
              </a-table>
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
</style>
