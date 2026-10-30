<script setup lang="ts">
import { inject } from "vue";
const embeddedInManageModal = inject<boolean>("embeddedInManageModal", false);
import BetweenMenus from "@/components/BetweenMenus.vue";
import CardPanel from "@/components/CardPanel.vue";
import OperationProgress from "@/components/OperationProgress.vue";
import { useOperationProgress } from "@/hooks/useOperationProgress";
import { useAppRouters } from "@/hooks/useAppRouters";
import { INSTANCE_VERSIONS_TIMEOUT, publishInstanceVersions } from "@/hooks/useInstanceVersions";
import {
  getInstanceVersionTarget,
  instanceReleaseId,
  selectInstanceUpdate
} from "@/tools/instanceVersions";
import { useRoute } from "vue-router";
import { useScreen } from "@/hooks/useScreen";
import { t } from "@/lang/i18n";
import { getInstanceInfo } from "@/services/apis/instance";
import {
  modpackChangelog,
  modpackVersions,
  modpackTaskStatus,
  reinstallServer,
  serverVersionsGet,
  updateModpack,
  type ModpackVersion,
  type ResetMode
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
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

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

const toConsole = () => {
  toPage({
    path: "/instances/terminal",
    query: { daemonId, instanceId }
  });
};

// ---- Current pack info (from instance config.packInfo) ----
const packInfo = ref<IModpackInfo>();
const infoLoading = ref(false);
let disposed = false;
let infoRequest = 0;

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
  isBedrock.value
    ? t("TXT_CODE_version_update_card_title")
    : t("TXT_CODE_modpack_update_card_title")
);

const loadInfo = async () => {
  if (disposed) return;
  const request = ++infoRequest;
  const { execute } = getInstanceInfo();
  try {
    infoLoading.value = true;
    const res = await execute({
      params: { uuid: instanceId, daemonId },
      forceRequest: true
    });
    if (disposed || request !== infoRequest) return;
    selectedVersion.value = "";
    versions.value = [];
    packInfo.value = res.value?.config?.packInfo;
    if (isUpdatable.value) await loadVersions();
  } catch (err: any) {
    if (!disposed && request === infoRequest) reportErrorMsg(err.message);
  } finally {
    if (!disposed && request === infoRequest) infoLoading.value = false;
  }
};

// ---- Available versions ----
const versions = ref<ModpackVersion[]>([]);
const versionsLoading = ref(false);
const selectedVersion = ref<string>("");
let versionsRequest = 0;
let versionsController: AbortController | undefined;

const versionId = (v: ModpackVersion) => instanceReleaseId(v, packInfo.value?.source || "");
const versionLabel = (v: ModpackVersion) =>
  v.displayName || v.name || v.version_number || versionId(v);
// CurseForge packs without a server pack file can't be installed/updated.
const isInstallable = (v: ModpackVersion) =>
  !!versionId(v) && (packInfo.value?.source !== "curseforge" || v.hasServerPack === true);

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

// A merged route can retain a badge candidate from a different instance/provider.
const requestedVersion = computed(() => {
  const target = getInstanceVersionTarget(packInfo.value);
  const query = route.query;
  if (
    route.path !== "/instances/modpackUpdate" ||
    !target ||
    query.daemonId !== daemonId ||
    query.instanceId !== instanceId ||
    query.updateDaemonId !== daemonId ||
    query.updateInstanceId !== instanceId ||
    query.updateSource !== target.source ||
    query.updateProjectId !== target.projectId ||
    typeof query.updateVersionId !== "string"
  ) {
    return "";
  }
  return query.updateVersionId;
});

const defaultVersion = () => {
  const requested = versions.value.find(
    (v) => versionId(v) === requestedVersion.value && isInstallable(v)
  );
  if (requested) {
    // Recheck compatibility/channel and ordering against the installed release.
    const result = selectInstanceUpdate(
      packInfo.value,
      versions.value.filter(
        (v) => versionId(v) === versionId(requested) || versionId(v) === currentVersionKey.value
      )
    );
    if (result.status === "available") return versionId(requested);
  }
  const latest = selectInstanceUpdate(packInfo.value, versions.value).latest;
  if (latest && isInstallable(latest)) return versionId(latest);
  const current = versions.value.find(
    (v) => versionId(v) === currentVersionKey.value && isInstallable(v)
  );
  return current ? versionId(current) : "";
};

watch(requestedVersion, () => {
  if (!versionsLoading.value) selectedVersion.value = defaultVersion();
});

const loadVersions = async () => {
  const pack = packInfo.value;
  if (!pack || disposed) return;
  const request = ++versionsRequest;
  versionsController?.abort();
  const controller = (versionsController = new AbortController());
  selectedVersion.value = "";
  versions.value = [];
  try {
    versionsLoading.value = true;
    let rows: ModpackVersion[];
    if (pack.source === "bedrock") {
      const res = await serverVersionsGet().execute({
        params: { software: "bedrock" },
        forceRequest: true,
        timeout: INSTANCE_VERSIONS_TIMEOUT,
        signal: controller.signal
      });
      rows = (res.value || []).map((v) => ({ ...v, name: v.id }));
    } else {
      const res = await modpackVersions().execute({
        params: { source: pack.source, projectId: pack.projectId },
        forceRequest: true,
        timeout: INSTANCE_VERSIONS_TIMEOUT,
        signal: controller.signal
      });
      rows = res.value || [];
    }
    if (disposed || request !== versionsRequest || packInfo.value !== pack) return;
    versions.value = publishInstanceVersions(pack, rows);
    selectedVersion.value = defaultVersion();
  } catch (err: any) {
    if (!disposed && request === versionsRequest) reportErrorMsg(err.message);
  } finally {
    if (!disposed && request === versionsRequest) {
      versionsLoading.value = false;
      versionsController = undefined;
    }
  }
};

// Each request owns its state; selection changes and unmount invalidate older requests.
const changelogHtml = ref("");
const changelogLoading = ref(false);
const changelogError = ref(false);
let changelogRequest = 0;
const supportsChangelog = computed(
  () => packInfo.value?.source === "curseforge" || packInfo.value?.source === "modrinth"
);
const selectedVersionLabel = computed(() => {
  const chosen = versions.value.find((v) => versionId(v) === selectedVersion.value);
  return chosen ? versionLabel(chosen) : selectedVersion.value;
});

const loadChangelog = async () => {
  const request = ++changelogRequest;
  changelogHtml.value = "";
  changelogError.value = false;
  changelogLoading.value = false;
  const source = packInfo.value?.source;
  const projectId = packInfo.value?.projectId;
  const selectedId = selectedVersion.value;
  if (disposed || !supportsChangelog.value || !source || !projectId || !selectedId) return;
  changelogLoading.value = true;
  try {
    const res = await modpackChangelog().execute({
      params: { source, projectId, versionId: selectedId },
      forceRequest: true
    });
    if (disposed || request !== changelogRequest) return;
    const notes = res.value;
    if (!notes) throw new Error("Release notes unavailable");
    const raw =
      notes.format === "markdown"
        ? (marked.parse(notes.content, { async: false }) as string)
        : notes.content;
    const safeHtml = sanitizeHtml(raw, {
      allowedTags: [
        "p",
        "br",
        "b",
        "strong",
        "i",
        "em",
        "u",
        "s",
        "span",
        "div",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "ul",
        "ol",
        "li",
        "blockquote",
        "code",
        "pre",
        "hr",
        "a",
        "table",
        "caption",
        "thead",
        "tbody",
        "tfoot",
        "tr",
        "td",
        "th"
      ],
      allowedAttributes: { a: ["href", "target", "rel"] },
      allowedSchemes: ["http", "https"],
      allowProtocolRelative: false,
      transformTags: {
        a: (tagName, attribs) => ({
          tagName,
          attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer" }
        })
      }
    });
    // Empty markup, whitespace entities, and removed unsafe content aren't notes.
    const text = sanitizeHtml(safeHtml, { allowedTags: [], allowedAttributes: {} });
    const visibleText = text.replace(
      /&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi,
      (entity, decimal, hex, named) => {
        const code = decimal ? Number(decimal) : hex ? parseInt(hex, 16) : undefined;
        if (code !== undefined && code >= 0 && code <= 0x10ffff) return String.fromCodePoint(code);
        return named === "nbsp" ? " " : entity;
      }
    );
    changelogHtml.value = visibleText.replace(/[\s\u200b-\u200d\ufeff]/g, "") ? safeHtml : "";
  } catch {
    if (!disposed && request === changelogRequest) changelogError.value = true;
  } finally {
    if (!disposed && request === changelogRequest) changelogLoading.value = false;
  }
};

watch(
  [() => packInfo.value?.source, () => packInfo.value?.projectId, selectedVersion],
  loadChangelog,
  { immediate: true, flush: "sync" }
);

const refresh = async () => {
  const request = changelogRequest;
  await loadInfo();
  // Selection changes already trigger the watcher; refresh unchanged notes explicitly.
  if (!disposed && request === changelogRequest) await loadChangelog();
};

const isCurrentSelected = computed(
  () => !!selectedVersion.value && selectedVersion.value === currentVersionKey.value
);

const formatTime = (ms?: number) => (ms ? new Date(ms).toLocaleString() : "-");

// ---- Single start + non-overlapping polling, fenced to the current instance. ----
const {
  busy: taskRunning,
  task,
  failure: taskFailure,
  start: startTask
} = useOperationProgress(
  targetKey,
  async (taskId) =>
    (
      await modpackTaskStatus().execute({
        params: { daemonId, task_id: taskId },
        forceRequest: true
      })
    ).value
);

const runUpdate = async () => {
  if (
    disposed ||
    taskRunning.value ||
    infoLoading.value ||
    versionsLoading.value ||
    !packInfo.value ||
    !selectedVersion.value
  )
    return;
  const selected = versions.value.find((v) => versionId(v) === selectedVersion.value);
  if (!selected || !isInstallable(selected)) return;
  await startTask(
    async () => {
      if (isBedrock.value) {
        // Reinstall the new Bedrock Dedicated Server, preserving the world.
        const res = await reinstallServer().execute({
          params: { daemonId, uuid: instanceId },
          data: {
            mcVersion: selectedVersion.value,
            loader: "bedrock",
            acceptEula: true,
            resetMode: "preserve_world" as ResetMode
          },
          forceRequest: true
        });
        return res.value?.taskId || "";
      }
      const res = await updateModpack().execute({
        params: { daemonId, uuid: instanceId },
        data: {
          source: packInfo.value!.source,
          projectId: packInfo.value!.projectId,
          projectName: packInfo.value!.projectName,
          fileId: selectedVersion.value,
          versionName: versionLabel(selected)
        },
        forceRequest: true
      });
      return res.value?.taskId || "";
    },
    {
      onStarted: () => message.success(t("TXT_CODE_modpack_update_started")),
      onSuccess: () => {
        message.success(t("TXT_CODE_modpack_update_done"));
        void loadInfo();
      }
    }
  );
};

watch(
  targetKey,
  () => {
    instanceId = String(getMetaOrRouteValue("instanceId") ?? "");
    daemonId = String(getMetaOrRouteValue("daemonId") ?? "");
    ++infoRequest;
    ++versionsRequest;
    versionsController?.abort();
    ++changelogRequest;
    packInfo.value = undefined;
    versions.value = [];
    selectedVersion.value = "";
    changelogHtml.value = "";
    changelogLoading.value = false;
    versionsLoading.value = false;
    void loadInfo();
  },
  { flush: "sync" }
);

onMounted(() => {
  loadInfo();
});

onBeforeUnmount(() => {
  disposed = true;
  ++infoRequest;
  ++versionsRequest;
  versionsController?.abort();
  ++changelogRequest;
});
</script>

<template>
  <div style="height: 100%" class="container">
    <a-row :gutter="[24, 24]" style="height: 100%">
      <a-col :span="24">
        <BetweenMenus>
          <template v-if="!isPhone && !embeddedInManageModal" #left>
            <a-typography-title class="mb-0" :level="4">
              <CloudDownloadOutlined />
              {{ cardTitle }}
            </a-typography-title>
          </template>
          <template #right>
            <a-button v-if="!embeddedInManageModal" @click="toConsole">
              <template #icon><RollbackOutlined /></template>
              {{ t("TXT_CODE_backup_to_console") }}
            </a-button>
            <a-button :disabled="!isUpdatable" :loading="versionsLoading" @click="refresh">
              <template #icon><ReloadOutlined /></template>
              {{ t("TXT_CODE_b76d94e0") }}
            </a-button>
          </template>
        </BetweenMenus>
      </a-col>

      <a-col v-if="taskRunning || taskFailure" :span="24">
        <CardPanel>
          <template #body>
            <OperationProgress
              :task="task"
              kind="update"
              :label="t('TXT_CODE_modpack_update_running')"
              :failure="taskFailure"
            />
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

                <a-descriptions class="mt-16" :column="1" size="small" bordered>
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
                      style="width: min(320px, 100%); max-width: 100%"
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
                        :disabled="
                          !selectedVersion ||
                          isCurrentSelected ||
                          infoLoading ||
                          versionsLoading ||
                          taskRunning
                        "
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
                  <section
                    v-if="supportsChangelog && selectedVersion"
                    class="release-notes mt-16"
                    :aria-label="t('TXT_CODE_modpack_changelog_title')"
                    :aria-busy="changelogLoading"
                  >
                    <a-typography-title :level="5">
                      {{ t("TXT_CODE_modpack_changelog_title") }}
                    </a-typography-title>
                    <div class="mb-8">
                      <a-typography-text type="secondary">
                        {{
                          t("TXT_CODE_modpack_changelog_selected", {
                            version: selectedVersionLabel
                          })
                        }}
                      </a-typography-text>
                    </div>
                    <div v-if="changelogLoading" class="release-notes-status" role="status">
                      <a-spin size="small" />
                      {{ t("TXT_CODE_modpack_changelog_loading") }}
                    </div>
                    <div v-else-if="changelogError" class="release-notes-status" role="status">
                      <a-typography-text type="secondary">
                        {{ t("TXT_CODE_modpack_changelog_unavailable") }}
                      </a-typography-text>
                      <a-button size="small" @click="loadChangelog">
                        {{ t("TXT_CODE_modpack_changelog_retry") }}
                      </a-button>
                    </div>
                    <!-- Only allowlisted, sanitized publisher content reaches v-html. -->
                    <div
                      v-else-if="changelogHtml"
                      class="release-notes-content"
                      tabindex="0"
                      :aria-label="t('TXT_CODE_modpack_changelog_title')"
                      v-html="changelogHtml"
                    />
                    <a-typography-text v-else type="secondary" role="status">
                      {{ t("TXT_CODE_modpack_changelog_empty") }}
                    </a-typography-text>
                  </section>
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
.release-notes {
  min-width: 0;
  padding-top: 16px;
  border-top: 1px solid var(--color-gray-3);
  overflow-wrap: anywhere;
}
.release-notes-status {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.release-notes-content {
  max-height: 360px;
  max-height: min(360px, 50vh);
  overflow: auto;
  padding: 12px;
  color: var(--color-gray-13);
  background: var(--level-1-bg-color);
  border: 1px solid var(--color-gray-3);
  border-radius: 6px;
  line-height: 1.6;

  :deep(pre),
  :deep(code) {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  :deep(pre),
  :deep(blockquote) {
    padding: 8px;
    background: var(--level-2-bg-color);
  }
  :deep(table) {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
  }
  :deep(th),
  :deep(td) {
    border: 1px solid var(--color-gray-3);
    padding: 6px;
    vertical-align: top;
  }
  :deep(a) {
    color: var(--color-primary);
  }
}
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
