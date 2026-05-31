<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed, watch, createVNode } from "vue";
import { Modal, message } from "ant-design-vue";
import {
  CloudDownloadOutlined,
  UploadOutlined,
  DeleteOutlined,
  RollbackOutlined,
  ReloadOutlined,
  ExclamationCircleOutlined
} from "@ant-design/icons-vue";
import CardPanel from "@/components/CardPanel.vue";
import BetweenMenus from "@/components/BetweenMenus.vue";
import { t } from "@/lang/i18n";
import { useScreen } from "@/hooks/useScreen";
import { useLayoutCardTools } from "@/hooks/useCardTools";
import { useAppRouters } from "@/hooks/useAppRouters";
import { reportErrorMsg } from "@/tools/validator";
import uploadService from "@/services/uploadService";
import { parseForwardAddress } from "@/tools/protocol";
import { getFileConfigAddr } from "@/hooks/useFileManager";
import { uploadAddress } from "@/services/apis/fileManager";
import {
  worldInfo,
  worldDownloadAddress,
  worldReplace,
  worldReset,
  worldTaskStatus,
  type WorldInfo
} from "@/services/apis/world";
import type { LayoutCard } from "@/types/index";

const props = defineProps<{ card: LayoutCard }>();

const { isPhone } = useScreen();
const { toPage } = useAppRouters();
const { getMetaOrRouteValue } = useLayoutCardTools(props.card);
const instanceId = String(getMetaOrRouteValue("instanceId") ?? "");
const daemonId = String(getMetaOrRouteValue("daemonId") ?? "");

const UPLOAD_DIR = ".nexcraft_world_up";

const info = ref<WorldInfo | null>(null);
const loading = ref(false);
const taskRunning = ref(false);
const uploading = ref(false);
const fileInput = ref<HTMLInputElement>();
let pollTimer: ReturnType<typeof setInterval> | undefined;

const formatBytes = (n: number) => {
  if (!n || n <= 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
};

const formatTime = (ms: number) => (ms ? new Date(ms).toLocaleString() : "-");

const downloadHint = computed(() =>
  info.value?.kind === "bedrock"
    ? t("TXT_CODE_world_download_hint_bedrock")
    : t("TXT_CODE_world_download_hint_java")
);

const loadInfo = async () => {
  loading.value = true;
  try {
    const { execute } = worldInfo();
    const res = await execute({ params: { uuid: instanceId, daemonId }, forceRequest: true });
    info.value = res.value ?? null;
  } catch (e: any) {
    reportErrorMsg(e?.message || String(e));
  } finally {
    loading.value = false;
  }
};

const stopPolling = () => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }
};

const pollTask = (taskId: string, doneMsg: string) => {
  taskRunning.value = true;
  stopPolling();
  let fails = 0;
  pollTimer = setInterval(async () => {
    try {
      const { execute } = worldTaskStatus();
      const res = await execute({
        params: { uuid: instanceId, daemonId, task_id: taskId },
        forceRequest: true
      });
      fails = 0;
      const task = res.value;
      if (!task || task.status !== 1) {
        stopPolling();
        taskRunning.value = false;
        if (task && task.status === -1) {
          reportErrorMsg(t("TXT_CODE_world_task_failed"));
        } else {
          message.success(doneMsg);
        }
        await loadInfo();
      }
    } catch {
      fails++;
      if (fails >= 20) {
        stopPolling();
        taskRunning.value = false;
        reportErrorMsg(t("TXT_CODE_world_task_failed"));
        await loadInfo();
      }
    }
  }, 1500);
};

const onDownload = async () => {
  try {
    const { execute } = worldDownloadAddress();
    const res = await execute({ params: { uuid: instanceId, daemonId } });
    if (!res.value) return;
    const cfg = res.value;
    const addr = parseForwardAddress(getFileConfigAddr(cfg), "http");
    const link = `${addr}/download/${cfg.password}/${encodeURIComponent(cfg.fileName)}`;
    window.open(link);
  } catch (e: any) {
    reportErrorMsg(e?.message || String(e));
  }
};

let wasUploading = false;
let seenActive = false;
let uploadWatchdog: ReturnType<typeof setTimeout> | null = null;
let pendingReplaceFileName = "";

const clearUploadWatchdog = () => {
  if (uploadWatchdog) clearTimeout(uploadWatchdog);
  uploadWatchdog = null;
};
const resetUploadState = () => {
  clearUploadWatchdog();
  wasUploading = false;
  seenActive = false;
  pendingReplaceFileName = "";
  uploading.value = false;
};

watch(
  () => uploadService.uiData.value,
  (v: any) => {
    const mine =
      v?.instanceInfo?.instanceId === instanceId &&
      v?.instanceInfo?.daemonId === daemonId;
    if (v?.current && mine) {
      wasUploading = true;
      seenActive = true;
      clearUploadWatchdog();
    } else if (wasUploading && !v?.current) {
      clearUploadWatchdog();
      wasUploading = false;
      seenActive = false;
      uploading.value = false;
      if (pendingReplaceFileName) {
        const name = pendingReplaceFileName;
        pendingReplaceFileName = "";
        confirmAndReplace(name);
      }
    }
  },
  { immediate: true }
);

const confirmAndReplace = (fileName: string) => {
  Modal.confirm({
    title: t("TXT_CODE_world_replace_confirm_title"),
    icon: createVNode(ExclamationCircleOutlined),
    content: t("TXT_CODE_world_replace_confirm"),
    async onOk() {
      try {
        const { execute } = worldReplace();
        const res = await execute({
          params: { uuid: instanceId, daemonId },
          data: { fileName }
        });
        if (res.value?.taskId) {
          pollTask(res.value.taskId, t("TXT_CODE_world_task_replace_done"));
        }
      } catch (e: any) {
        reportErrorMsg(e?.message || String(e));
      }
    }
  });
};

const onPickFile = () => fileInput.value?.click();

const onFileChange = async (e: Event) => {
  const files = (e.target as HTMLInputElement).files;
  if (!files || files.length === 0) return;
  const file = Array.from(files).find((f) => f.size > 0);
  if (fileInput.value) fileInput.value.value = "";
  if (!file) {
    message.error(t("TXT_CODE_world_select_file"));
    return;
  }
  try {
    uploading.value = true;
    const { state: cfg, execute: getCfg } = uploadAddress();
    await getCfg({
      params: { upload_dir: UPLOAD_DIR, daemonId, uuid: instanceId, file_name: file.name }
    });
    if (!cfg.value?.password) throw new Error("upload init failed");
    const addr = parseForwardAddress(getFileConfigAddr(cfg.value), "http");
    pendingReplaceFileName = file.name;
    uploadService.append(file, addr, cfg.value.password, { overwrite: true }, (task) => {
      task.instanceInfo = { instanceId, daemonId };
    });
    seenActive = false;
    clearUploadWatchdog();
    uploadWatchdog = setTimeout(() => {
      if (!seenActive) {
        resetUploadState();
        reportErrorMsg(t("TXT_CODE_world_upload_failed"));
      }
    }, 15000);
  } catch (e: any) {
    resetUploadState();
    reportErrorMsg(e?.message || String(e));
  }
};

const onReset = () => {
  Modal.confirm({
    title: t("TXT_CODE_world_reset_confirm_title"),
    icon: createVNode(ExclamationCircleOutlined),
    content: t("TXT_CODE_world_reset_confirm"),
    async onOk() {
      try {
        const { execute } = worldReset();
        const res = await execute({ params: { uuid: instanceId, daemonId } });
        if (res.value?.taskId) {
          pollTask(res.value.taskId, t("TXT_CODE_world_task_reset_done"));
        }
      } catch (e: any) {
        reportErrorMsg(e?.message || String(e));
      }
    }
  });
};

const toConsole = () => {
  toPage({ path: "/instances/terminal", query: { daemonId, instanceId } });
};

onMounted(loadInfo);
onBeforeUnmount(() => {
  stopPolling();
  clearUploadWatchdog();
});
</script>

<template>
  <div style="height: 100%" class="container">
    <a-row :gutter="[24, 24]" style="height: 100%">
      <a-col :span="24">
        <BetweenMenus>
          <template v-if="!isPhone" #left>
            <a-typography-title class="mb-0" :level="4">
              <RollbackOutlined />
              {{ t("TXT_CODE_world_card_title") }}
            </a-typography-title>
          </template>
          <template #right>
            <a-button :loading="loading" @click="loadInfo">
              <template #icon><ReloadOutlined /></template>
              {{ t("TXT_CODE_b76d94e0") }}
            </a-button>
            <a-button @click="toConsole">
              <template #icon><RollbackOutlined /></template>
              {{ t("TXT_CODE_backup_to_console") }}
            </a-button>
          </template>
        </BetweenMenus>
      </a-col>

      <a-col :span="24">
        <CardPanel style="height: 100%">
          <template #title>{{ t("TXT_CODE_world_current") }}</template>
          <template #body>
            <a-spin :spinning="loading">
              <a-descriptions
                v-if="info && info.exists"
                :column="1"
                bordered
                size="small"
              >
                <a-descriptions-item :label="t('TXT_CODE_world_name')">
                  {{ info.levelName }}
                </a-descriptions-item>
                <a-descriptions-item :label="t('TXT_CODE_world_type')">
                  {{ info.kind === "bedrock" ? "Bedrock" : "Java" }}
                </a-descriptions-item>
                <a-descriptions-item :label="t('TXT_CODE_world_size')">
                  {{ formatBytes(info.size) }}
                </a-descriptions-item>
                <a-descriptions-item :label="t('TXT_CODE_world_modified')">
                  {{ formatTime(info.lastModified) }}
                </a-descriptions-item>
              </a-descriptions>
              <a-empty v-else-if="!loading" :description="t('TXT_CODE_world_none')" />
            </a-spin>

            <div v-if="taskRunning || uploading" style="margin-top: 16px">
              <a-spin
                :tip="taskRunning ? t('TXT_CODE_world_task_running') : t('TXT_CODE_world_uploading')"
              />
            </div>

            <div style="margin-top: 24px; display: flex; flex-wrap: wrap; gap: 12px">
              <a-button
                :disabled="taskRunning || uploading || !info?.exists"
                @click="onDownload"
              >
                <template #icon><CloudDownloadOutlined /></template>
                {{ t("TXT_CODE_world_download") }}
              </a-button>
              <a-button :disabled="taskRunning || uploading" @click="onPickFile">
                <template #icon><UploadOutlined /></template>
                {{ t("TXT_CODE_world_replace") }}
              </a-button>
              <a-button
                danger
                :disabled="taskRunning || uploading || !info?.exists"
                @click="onReset"
              >
                <template #icon><DeleteOutlined /></template>
                {{ t("TXT_CODE_world_reset") }}
              </a-button>
              <input
                ref="fileInput"
                type="file"
                accept=".zip,.mcworld"
                style="display: none"
                @change="onFileChange"
              />
            </div>

            <a-typography-paragraph type="secondary" style="margin-top: 12px">
              {{ downloadHint }}<br />
              {{ t("TXT_CODE_world_replace_hint") }}<br />
              {{ t("TXT_CODE_world_reset_hint") }}
            </a-typography-paragraph>
          </template>
        </CardPanel>
      </a-col>
    </a-row>
  </div>
</template>
