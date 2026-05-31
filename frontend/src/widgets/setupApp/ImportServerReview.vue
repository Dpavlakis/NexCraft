<script setup lang="ts">
import { t } from "@/lang/i18n";
import {
  importDetect,
  importFinalize,
  importIdentify,
  type IPackGuess,
  type IServerDetectResult
} from "@/services/apis/import";
import {
  modpackTaskStatus,
  reinstallModpack,
  reinstallServer,
  serverVersionsGet,
  type ModpackVersion,
  type ResetMode
} from "@/services/apis/modpack";
import { reportErrorMsg } from "@/tools/validator";
import { openResetInstanceDialog } from "@/components/fc";
import { message } from "ant-design-vue";
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";

const props = defineProps<{
  daemonId: string;
  instanceUuid: string;
  open: boolean;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  close: [];
  done: [instanceUuid: string];
}>();

// ---- editable review form ----
const LOADER_OPTIONS = [
  { value: "vanilla", label: "Vanilla" },
  { value: "paper", label: "PaperMC" },
  { value: "purpur", label: "Purpur" },
  { value: "folia", label: "Folia" },
  { value: "fabric", label: "Fabric" },
  { value: "forge", label: "Forge" },
  { value: "neoforge", label: "NeoForge" },
  { value: "quilt", label: "Quilt" },
  { value: "bedrock", label: "Bedrock" }
];

const form = reactive({
  instanceName: "",
  // a-select rejects null — use undefined for "unknown".
  loader: undefined as string | undefined,
  mcVersion: "",
  startCommand: "",
  maxMemory: 4096,
  worldName: "",
  kind: ""
});

// The SUBMITTED kind must follow the currently-selected loader, not the
// detect-time kind (which is kept only for the initial display).
const effectiveKind = computed<"java" | "bedrock">(() =>
  form.loader === "bedrock" ? "bedrock" : "java"
);
const isBedrock = computed(() => effectiveKind.value === "bedrock");

const BEDROCK_START_COMMAND = 'sh -c "LD_LIBRARY_PATH=. exec ./bedrock_server"';

// Sensible start-command template per loader.
function startCommandTemplate(loader?: string): string {
  if (loader === "bedrock") return BEDROCK_START_COMMAND;
  const mem = form.maxMemory || 4096;
  return `java -Xmx${mem}M -jar server.jar nogui`; // generic java/paper default; user edits the jar
}

const detecting = ref(false);
const detectResult = ref<IServerDetectResult | null>(null);

// Latest Bedrock Dedicated Server release id, resolved when Bedrock is detected.
const latestBedrockVersion = ref<string>("");

// ---- pack identification ----
const identifying = ref(false);
const packGuess = ref<IPackGuess | null>(null);
const selectedVersion = ref<string>("");

const packVersions = computed<ModpackVersion[]>(() =>
  (packGuess.value?.versions as ModpackVersion[]) || []
);
const versionId = (v: ModpackVersion) => String(v.fileId || v.id || "");
const versionLabel = (v: ModpackVersion) => {
  const base = v.displayName || v.name || v.version_number || versionId(v);
  const mc = v.mcVersion || (v.game_versions && v.game_versions[0]) || "";
  return mc ? `${base}  ·  ${mc}` : base;
};
const versionOptions = computed(() =>
  packVersions.value.map((v) => ({ value: versionId(v), label: versionLabel(v) }))
);

const runDetect = async () => {
  detecting.value = true;
  packGuess.value = null;
  selectedVersion.value = "";
  latestBedrockVersion.value = "";
  try {
    const res = await importDetect().execute({
      params: { daemonId: props.daemonId },
      data: { instanceUuid: props.instanceUuid },
      forceRequest: true
    });
    const d = res.value;
    detectResult.value = d || null;
    if (d) {
      form.instanceName = (d as any).instanceName || (d as any).packName || "";
      form.loader =
        d.loader && LOADER_OPTIONS.some((o) => o.value === d.loader) ? d.loader : undefined;
      form.mcVersion = d.mcVersion || "";
      form.startCommand = d.startCommand || "";
      form.worldName = d.worldName || "";
      form.kind = d.kind || "";
      // If detection returned no start command (e.g. bedrock) but we know the
      // loader, seed the field from the loader template so it's never blank.
      if (!form.startCommand.trim() && form.loader) {
        form.startCommand = startCommandTemplate(form.loader);
      }
    }
    // For Bedrock, resolve the latest server version so the default action can
    // install it (Bedrock clients version-lock, so importing the old binary as
    // -is usually yields an unjoinable server).
    if (isBedrock.value) resolveLatestBedrock();
    // Identify the pack in parallel (non-fatal).
    runIdentify();
  } catch (err: any) {
    reportErrorMsg(err.message);
  } finally {
    detecting.value = false;
  }
};

const runIdentify = async () => {
  if (!detectResult.value) return;
  identifying.value = true;
  try {
    const res = await importIdentify().execute({
      data: detectResult.value,
      forceRequest: true
    });
    packGuess.value = res.value || null;
    const first = packVersions.value[0];
    selectedVersion.value = first ? versionId(first) : "";
  } catch (err: any) {
    // non-fatal — identification is best-effort
    packGuess.value = null;
  } finally {
    identifying.value = false;
  }
};

// Fetch the Bedrock Dedicated Server versions and pick the stable release id
// (fallback: first entry). Best-effort — failure just leaves it empty and the
// UI falls back to the import-as-is path.
const resolveLatestBedrock = async () => {
  latestBedrockVersion.value = "";
  try {
    const res = await serverVersionsGet().execute({
      params: { software: "bedrock" },
      forceRequest: true
    });
    const list = res.value || [];
    const stable = list.find((v) => v.type === "release") || list[0];
    latestBedrockVersion.value = stable ? stable.id : "";
    if (latestBedrockVersion.value) form.mcVersion = latestBedrockVersion.value;
  } catch {
    // non-fatal — opt-out (import as-is) remains available
    latestBedrockVersion.value = "";
  }
};

const hasPack = computed(() => !!packGuess.value);

// Scroll-wheel adjusts Max Memory by one step (matches the input's min/step).
const onMemWheel = (e: WheelEvent) => {
  const delta = e.deltaY < 0 ? 1024 : -1024;
  form.maxMemory = Math.max(1024, (form.maxMemory || 0) + delta);
};

// ---- finalize / actions ----
const submitting = ref(false);

const canImportAsIs = computed(() => {
  if (submitting.value || taskRunning.value) return false;
  // Bedrock uses a fixed command; java needs an explicit start command.
  if (isBedrock.value) return true;
  return !!form.startCommand.trim();
});

const closeDialog = () => {
  emit("update:open", false);
  emit("close");
};

const onSuccess = () => {
  message.success(t("TXT_CODE_import_finalize_done"));
  emit("done", props.instanceUuid);
  emit("update:open", false);
};

// Mode 1 + 2: persist the start command (and optionally packInfo) onto the config.
const finalize = async (packInfo?: Record<string, any>) => {
  if (submitting.value) return;
  submitting.value = true;
  try {
    await importFinalize().execute({
      params: { daemonId: props.daemonId },
      data: {
        instanceUuid: props.instanceUuid,
        kind: effectiveKind.value,
        startCommand: form.startCommand,
        packInfo
      }
    });
    onSuccess();
  } catch (err: any) {
    reportErrorMsg(err.message);
  } finally {
    submitting.value = false;
  }
};

const importAsIs = () => {
  if (!canImportAsIs.value) {
    if (!isBedrock.value && !form.startCommand.trim()) {
      return reportErrorMsg(t("TXT_CODE_import_startCommand_required"));
    }
    return;
  }
  finalize();
};

// Build a packInfo object for the selected version, mirroring IModpackInfo.
const buildPackInfo = (): Record<string, any> | undefined => {
  const g = packGuess.value;
  if (!g) return undefined;
  const v = packVersions.value.find((x) => versionId(x) === selectedVersion.value);
  return {
    source: g.source.toLowerCase(),
    projectId: g.projectId,
    projectName: g.projectName,
    fileId: selectedVersion.value,
    versionName: v ? v.displayName || v.name || v.version_number || versionId(v) : "",
    mcVersion: form.mcVersion || (v?.mcVersion ?? (v?.game_versions && v.game_versions[0]) ?? ""),
    loader: form.loader || (v?.loader ?? (v?.loaders && v.loaders[0]) ?? ""),
    loaderVersion: "",
    installedAt: Date.now()
  };
};

const linkPack = () => {
  if (!hasPack.value) return;
  finalize(buildPackInfo());
};

// ---- Mode 3: reinstall fresh + keep world (reuses the modpack reinstall flow) ----
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
  taskLabel.value = t("TXT_CODE_import_reinstall_running");
  stopPolling();
  pollTimer = setInterval(async () => {
    try {
      const res = await modpackTaskStatus().execute({
        params: { daemonId: props.daemonId, task_id: taskId },
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
      if (task.status !== 1) {
        stopPolling();
        taskRunning.value = false;
        if (task.status === -1) {
          reportErrorMsg(t("TXT_CODE_import_reinstall_failed"));
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

const reinstallKeep = async () => {
  if (!hasPack.value || taskRunning.value) return;
  const g = packGuess.value!;
  if (!selectedVersion.value) return;
  const v = packVersions.value.find((x) => versionId(x) === selectedVersion.value);
  try {
    const res = await reinstallModpack().execute({
      params: { daemonId: props.daemonId, uuid: props.instanceUuid },
      data: {
        source: g.source.toLowerCase(),
        projectId: g.projectId,
        projectName: g.projectName,
        fileId: selectedVersion.value,
        versionName: v ? versionLabel(v) : "",
        maxMemoryMB: form.maxMemory,
        acceptEula: true,
        resetMode: "preserve_world" as ResetMode
      }
    });
    const taskId = res.value?.taskId || "";
    if (!taskId) throw new Error(t("TXT_CODE_import_reinstall_failed"));
    message.success(t("TXT_CODE_import_reinstall_started"));
    pollTask(taskId, () => onSuccess());
  } catch (err: any) {
    reportErrorMsg(err.message);
  }
};

// "Find my modpack": hand off to the existing Reset/Reinstall flow. Mounting
// the dialog with NO packInfo makes it render the full ModpackBrowser search
// (CurseForge/Modrinth/Custom) so the user can find their pack, pick a version
// and reinstall into this imported instance while preserving the world. We use
// the same independent mount helper the instance Reset button uses, then close
// the wizard so the reset dialog takes over cleanly (its own lifecycle).
const findMyModpack = () => {
  openResetInstanceDialog(
    props.daemonId,
    props.instanceUuid,
    form.instanceName || undefined
    // no packInfo → ModpackBrowser search path
  );
  emit("update:open", false);
};

// Bedrock default: install the latest Bedrock Dedicated Server while keeping
// the uploaded world (daemon preserves it). Reuses the reinstall + poll flow.
const installLatestBedrock = async () => {
  if (taskRunning.value) return;
  if (!latestBedrockVersion.value) {
    // Couldn't resolve a version — fall back to importing the uploaded binary.
    return importAsIs();
  }
  try {
    const res = await reinstallServer().execute({
      params: { daemonId: props.daemonId, uuid: props.instanceUuid },
      data: {
        mcVersion: latestBedrockVersion.value,
        loader: "bedrock",
        acceptEula: true,
        resetMode: "preserve_world" as ResetMode
      }
    });
    const taskId = res.value?.taskId || "";
    if (!taskId) throw new Error(t("TXT_CODE_import_reinstall_failed"));
    message.success(t("TXT_CODE_import_reinstall_started"));
    pollTask(taskId, () => onSuccess());
  } catch (err: any) {
    reportErrorMsg(err.message);
  }
};

// Loader drives the start command. When the user changes the loader:
//  - switching to bedrock always sets the fixed bedrock command;
//  - switching to a java loader sets the java template ONLY if the field is
//    empty or still holds the bedrock command (i.e. switching away from
//    bedrock). A good detected/edited java command is left untouched.
watch(
  () => form.loader,
  (loader) => {
    if (loader === "bedrock") {
      form.startCommand = startCommandTemplate("bedrock");
      return;
    }
    const cur = form.startCommand.trim();
    if (!cur || cur === BEDROCK_START_COMMAND) {
      form.startCommand = startCommandTemplate(loader);
    }
  }
);

// Detect when the dialog is opened.
watch(
  () => props.open,
  (open) => {
    if (open) runDetect();
    else stopPolling();
  },
  { immediate: true }
);

onBeforeUnmount(() => stopPolling());
</script>

<template>
  <a-modal
    :open="open"
    :title="t('TXT_CODE_import_title')"
    :width="640"
    :footer="null"
    :mask-closable="false"
    :destroy-on-close="true"
    @cancel="closeDialog"
  >
    <a-spin :spinning="detecting" :tip="t('TXT_CODE_import_detecting')">
      <a-alert
        class="mb-16"
        type="info"
        show-icon
        :message="t('TXT_CODE_import_detected')"
        :description="t('TXT_CODE_import_detected_hint')"
      />

      <a-form layout="vertical">
        <a-form-item :label="t('TXT_CODE_import_name')">
          <a-input :value="form.instanceName" disabled />
        </a-form-item>

        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item :label="t('TXT_CODE_import_loader')">
              <a-select
                v-model:value="form.loader"
                :options="LOADER_OPTIONS"
                :placeholder="t('TXT_CODE_import_loader_unknown')"
                allow-clear
              />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item :label="t('TXT_CODE_import_mcVersion')">
              <a-input
                v-model:value="form.mcVersion"
                :placeholder="t('TXT_CODE_import_mcVersion_ph')"
                :disabled="isBedrock"
              />
            </a-form-item>
          </a-col>
        </a-row>

        <a-form-item :label="t('TXT_CODE_import_startCommand')">
          <a-textarea
            v-model:value="form.startCommand"
            :rows="2"
            :disabled="isBedrock"
          />
          <a-typography-text type="secondary" style="font-size: 12px">
            {{ isBedrock ? t("TXT_CODE_import_startCommand_bedrock") : t("TXT_CODE_import_startCommand_hint") }}
          </a-typography-text>
        </a-form-item>

        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item :label="t('TXT_CODE_import_memory')">
              <a-input-number
                v-model:value="form.maxMemory"
                :min="1024"
                :step="1024"
                style="width: 100%"
                @wheel.prevent="onMemWheel"
              />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item :label="t('TXT_CODE_import_world')">
              <a-input :value="form.worldName || t('TXT_CODE_import_world_none')" disabled />
            </a-form-item>
          </a-col>
        </a-row>
      </a-form>

      <!-- Pack match section -->
      <a-divider style="margin: 8px 0 16px">{{ t("TXT_CODE_import_pack_section") }}</a-divider>
      <a-spin :spinning="identifying">
        <template v-if="hasPack && packGuess">
          <div class="pack-line">
            <a-tag color="blue">{{ packGuess.source }}</a-tag>
            <span>{{ t("TXT_CODE_import_looksLike", { name: packGuess.projectName, source: packGuess.source }) }}</span>
          </div>
          <a-form-item :label="t('TXT_CODE_import_pack_version')" class="mt-12">
            <a-select
              v-model:value="selectedVersion"
              :options="versionOptions"
              :placeholder="t('TXT_CODE_import_pack_version')"
              show-search
              option-filter-prop="label"
            />
          </a-form-item>
        </template>
        <a-typography-text v-else type="secondary">
          {{ t("TXT_CODE_import_noPack") }}
        </a-typography-text>
      </a-spin>

      <!-- Reinstall progress -->
      <div v-if="taskRunning" class="mt-16">
        <div class="mb-8">{{ taskLabel }}</div>
        <a-progress :percent="taskProgress" status="active" />
      </div>

      <a-alert
        v-if="hasPack"
        class="mt-16"
        type="info"
        show-icon
        :message="t('TXT_CODE_import_reinstallNote')"
      />

      <!-- Bedrock note -->
      <a-alert
        v-if="isBedrock"
        class="mt-16"
        type="info"
        show-icon
        :message="t('TXT_CODE_import_bedrock_latest_note')"
      />

      <!-- Actions -->
      <div class="action-grid mt-16">
        <!-- Bedrock: install latest + keep world (default) -->
        <div v-if="isBedrock" class="action-block">
          <a-button
            block
            type="primary"
            :disabled="taskRunning || submitting"
            :loading="taskRunning"
            @click="installLatestBedrock"
          >
            {{ t("TXT_CODE_import_bedrock_latest") }}
          </a-button>
          <a-typography-text type="secondary" class="action-hint">
            {{ t("TXT_CODE_import_bedrock_latest_note") }}
          </a-typography-text>
        </div>

        <!-- Bedrock opt-out: import the uploaded binary as-is -->
        <div v-if="isBedrock" class="action-block">
          <a-button
            block
            :disabled="!canImportAsIs"
            :loading="submitting"
            @click="importAsIs"
          >
            {{ t("TXT_CODE_import_bedrock_asis") }}
          </a-button>
          <a-typography-text type="secondary" class="action-hint">
            {{ t("TXT_CODE_import_importAsIs_hint") }}
          </a-typography-text>
        </div>

        <!-- Java: import the uploaded server as-is (default) -->
        <div v-if="!isBedrock" class="action-block">
          <a-button
            block
            type="primary"
            :disabled="!canImportAsIs"
            :loading="submitting"
            @click="importAsIs"
          >
            {{ t("TXT_CODE_import_importAsIs") }}
          </a-button>
          <a-typography-text type="secondary" class="action-hint">
            {{ t("TXT_CODE_import_importAsIs_hint") }}
          </a-typography-text>
        </div>

        <!-- Java: find my modpack → opens the reset/search browser (keep world) -->
        <div v-if="!isBedrock" class="action-block">
          <a-button
            block
            :type="!hasPack ? 'primary' : 'default'"
            :disabled="submitting || taskRunning"
            @click="findMyModpack"
          >
            {{ t("TXT_CODE_import_find_pack") }}
          </a-button>
          <a-typography-text type="secondary" class="action-hint">
            {{ t("TXT_CODE_import_find_pack_hint") }}
          </a-typography-text>
        </div>

        <div v-if="!isBedrock && hasPack" class="action-block">
          <a-button
            block
            :disabled="submitting || taskRunning"
            @click="linkPack"
          >
            {{ t("TXT_CODE_import_linkPack") }}
          </a-button>
          <a-typography-text type="secondary" class="action-hint">
            {{ t("TXT_CODE_import_linkPack_hint") }}
          </a-typography-text>
        </div>

        <div v-if="!isBedrock && hasPack" class="action-block">
          <a-popconfirm
            :title="t('TXT_CODE_import_reinstallNote')"
            :ok-text="t('TXT_CODE_import_reinstallKeep')"
            @confirm="reinstallKeep"
          >
            <a-button
              block
              :disabled="submitting || taskRunning || !selectedVersion"
              :loading="taskRunning"
            >
              {{ t("TXT_CODE_import_reinstallKeep") }}
            </a-button>
          </a-popconfirm>
        </div>
      </div>
    </a-spin>
  </a-modal>
</template>

<style lang="scss" scoped>
.mb-16 {
  margin-bottom: 16px;
}
.mt-16 {
  margin-top: 16px;
}
.mt-12 {
  margin-top: 12px;
}
.mb-8 {
  margin-bottom: 8px;
}
.pack-line {
  display: flex;
  align-items: center;
  gap: 8px;
}
.action-grid {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.action-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.action-hint {
  font-size: 12px;
}
</style>
