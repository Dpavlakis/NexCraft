<script setup lang="ts">
import BetweenMenus from "@/components/BetweenMenus.vue";
import CardPanel from "@/components/CardPanel.vue";
import { useAppRouters } from "@/hooks/useAppRouters";
import { t } from "@/lang/i18n";
import { remoteNodeList } from "@/services/apis";
import { createAsyncTask, quickInstallListAddr } from "@/services/apis/instance";
import {
  installModpack,
  modpackSearch,
  modpackVersions,
  type ModpackHit,
  type ModpackVersion
} from "@/services/apis/modpack";
import { reportErrorMsg } from "@/tools/validator";
import type { LayoutCard, NodeStatus } from "@/types";
import { AppstoreOutlined, SearchOutlined } from "@ant-design/icons-vue";
import { message } from "ant-design-vue";
import { computed, onMounted, reactive, ref } from "vue";

defineProps<{ card: LayoutCard }>();

const { toPage } = useAppRouters();

type Source = "custom" | "curseforge" | "modrinth";
const source = ref<Source>("custom");
const sources: { key: Source; label: string }[] = [
  { key: "custom", label: t("TXT_CODE_modpack_custom") },
  { key: "curseforge", label: "CurseForge" },
  { key: "modrinth", label: "Modrinth" }
];

// ---- nodes ----
const nodes = ref<NodeStatus[]>([]);
const nodeLabel = (n: NodeStatus) => {
  const remarks = (n as any).remarks;
  if (remarks) return remarks;
  const ipPort = `${(n as any).ip || ""}:${(n as any).port || ""}`;
  return ipPort !== ":" ? ipPort : n.uuid;
};
const loadNodes = async () => {
  const { execute } = remoteNodeList();
  try {
    const res = await execute();
    nodes.value = (res.value || []).filter((n: any) => n.available);
  } catch (err: any) {
    reportErrorMsg(err.message);
  }
};

// ---- results ----
interface ResultItem {
  id: string;
  title: string;
  description: string;
  icon?: string;
  // custom-only:
  targetLink?: string;
  setupInfo?: any;
}
const results = ref<ResultItem[]>([]);
const loading = ref(false);
const searchText = ref("");

const loadCustom = async () => {
  loading.value = true;
  try {
    // reuse the existing quick-install catalog, Minecraft only
    const res = await quickInstallListAddr().execute();
    const pkgs = (res.value?.packages || []).filter((p: any) => p.gameType === "Minecraft");
    results.value = pkgs.map((p: any) => ({
      id: p.title,
      title: p.title,
      description: p.description,
      icon: p.image,
      targetLink: p.targetLink,
      setupInfo: p.setupInfo
    }));
  } catch (err: any) {
    reportErrorMsg(err.message);
  } finally {
    loading.value = false;
  }
};

const search = async () => {
  if (source.value === "custom") return loadCustom();
  loading.value = true;
  try {
    const { execute } = modpackSearch();
    const res = await execute({
      params: {
        query: searchText.value,
        source: source.value,
        type: "modpack",
        offset: 0,
        limit: 30
      },
      forceRequest: true
    });
    results.value = (res.value?.hits || []).map((h: ModpackHit) => ({
      id: h.id,
      title: h.title,
      description: h.description,
      icon: h.icon_url
    }));
  } catch (err: any) {
    reportErrorMsg(err.message);
  } finally {
    loading.value = false;
  }
};

const selectSource = (s: Source) => {
  source.value = s;
  results.value = [];
  searchText.value = "";
  if (s === "custom") loadCustom();
};

// ---- install dialog ----
const dialog = reactive({
  open: false,
  item: null as ResultItem | null,
  instanceName: "",
  daemonId: "",
  maxMemoryMB: 4096,
  versions: [] as ModpackVersion[],
  versionLoading: false,
  selectedVersion: "" as string,
  installing: false
});

const openInstall = async (item: ResultItem) => {
  dialog.item = item;
  dialog.instanceName = item.title.slice(0, 40);
  dialog.daemonId = nodes.value[0]?.uuid || "";
  dialog.selectedVersion = "";
  dialog.versions = [];
  dialog.open = true;
  if (source.value !== "custom") {
    dialog.versionLoading = true;
    try {
      const { execute } = modpackVersions();
      const res = await execute({ params: { source: source.value, projectId: item.id } });
      dialog.versions = res.value || [];
      // preselect first installable version
      const first = dialog.versions.find((v) => versionInstallable(v));
      dialog.selectedVersion = first ? versionId(first) : "";
    } catch (err: any) {
      reportErrorMsg(err.message);
    } finally {
      dialog.versionLoading = false;
    }
  }
};

const versionId = (v: ModpackVersion) => String(v.fileId || v.id || "");
const versionInstallable = (v: ModpackVersion) =>
  source.value === "curseforge" ? v.hasServerPack !== false && !!v.fileId : true;
const versionLabel = (v: ModpackVersion) => {
  const base = v.displayName || v.name || v.version_number || versionId(v);
  if (source.value === "curseforge" && v.hasServerPack === false) {
    return `${base} — ${t("TXT_CODE_modpack_no_serverpack")}`;
  }
  return base;
};

const canInstall = computed(
  () =>
    !!dialog.instanceName &&
    !!dialog.daemonId &&
    (source.value === "custom" || !!dialog.selectedVersion)
);

const doInstall = async () => {
  if (!dialog.item || !canInstall.value) return;
  dialog.installing = true;
  try {
    let instanceUuid = "";
    if (source.value === "custom") {
      const { execute } = createAsyncTask();
      const res = await execute({
        params: { daemonId: dialog.daemonId, uuid: "-", task_name: "quick_install" },
        data: {
          time: Date.now(),
          newInstanceName: dialog.instanceName,
          targetLink: dialog.item.targetLink || "",
          setupInfo: dialog.item.setupInfo
        }
      });
      instanceUuid = res.value?.instanceUuid || "";
    } else {
      const v = dialog.versions.find((x) => versionId(x) === dialog.selectedVersion);
      const { execute } = installModpack();
      const res = await execute({
        params: { daemonId: dialog.daemonId },
        data: {
          source: source.value,
          projectId: dialog.item.id,
          projectName: dialog.item.title,
          fileId: dialog.selectedVersion,
          versionName: v ? versionLabel(v) : "",
          iconUrl: dialog.item.icon,
          instanceName: dialog.instanceName,
          maxMemoryMB: dialog.maxMemoryMB
        }
      });
      instanceUuid = res.value?.instanceUuid || "";
    }
    message.success(t("TXT_CODE_modpack_install_started"));
    dialog.open = false;
    if (instanceUuid) {
      toPage({
        path: "/instances/terminal",
        query: { daemonId: dialog.daemonId, instanceId: instanceUuid }
      });
    }
  } catch (err: any) {
    reportErrorMsg(err.message);
  } finally {
    dialog.installing = false;
  }
};

onMounted(() => {
  loadNodes();
  loadCustom();
});
</script>

<template>
  <div style="height: 100%" class="container">
    <a-row :gutter="[24, 24]" style="height: 100%">
      <a-col :span="24">
        <BetweenMenus>
          <template #left>
            <a-typography-title class="mb-0" :level="4">
              <AppstoreOutlined /> {{ card.title }}
            </a-typography-title>
          </template>
        </BetweenMenus>
      </a-col>

      <!-- Sidebar -->
      <a-col :xs="24" :md="5">
        <CardPanel style="height: 100%">
          <template #body>
            <a-menu :selected-keys="[source]" mode="vertical" style="border: none">
              <a-menu-item v-for="s in sources" :key="s.key" @click="selectSource(s.key)">
                {{ s.label }}
              </a-menu-item>
            </a-menu>
          </template>
        </CardPanel>
      </a-col>

      <!-- Results -->
      <a-col :xs="24" :md="19">
        <CardPanel style="height: 100%">
          <template #body>
            <div v-if="source !== 'custom'" class="mb-12">
              <a-input-search
                v-model:value="searchText"
                :placeholder="t('TXT_CODE_modpack_search_ph')"
                enter-button
                @search="search"
              >
                <template #prefix><SearchOutlined /></template>
              </a-input-search>
            </div>
            <a-spin :spinning="loading">
              <a-list item-layout="horizontal" :data-source="results">
                <template #renderItem="{ item }">
                  <a-list-item>
                    <a-list-item-meta :description="item.description">
                      <template #title>{{ item.title }}</template>
                      <template #avatar>
                        <a-avatar v-if="item.icon" :src="item.icon" shape="square" :size="44" />
                        <a-avatar v-else shape="square" :size="44">
                          <template #icon><AppstoreOutlined /></template>
                        </a-avatar>
                      </template>
                    </a-list-item-meta>
                    <template #actions>
                      <a-button type="primary" @click="openInstall(item)">
                        {{ t("TXT_CODE_modpack_install") }}
                      </a-button>
                    </template>
                  </a-list-item>
                </template>
              </a-list>
            </a-spin>
          </template>
        </CardPanel>
      </a-col>
    </a-row>
  </div>

  <a-modal
    v-model:open="dialog.open"
    :title="t('TXT_CODE_modpack_install') + (dialog.item ? ' - ' + dialog.item.title : '')"
    :confirm-loading="dialog.installing"
    :ok-button-props="{ disabled: !canInstall }"
    @ok="doInstall"
  >
    <a-form layout="vertical">
      <a-form-item :label="t('TXT_CODE_modpack_name')">
        <a-input v-model:value="dialog.instanceName" />
      </a-form-item>
      <a-form-item :label="t('TXT_CODE_modpack_node')">
        <a-select v-model:value="dialog.daemonId">
          <a-select-option v-for="n in nodes" :key="n.uuid" :value="n.uuid">
            {{ nodeLabel(n) }}
          </a-select-option>
        </a-select>
      </a-form-item>
      <a-form-item v-if="source !== 'custom'" :label="t('TXT_CODE_modpack_version')">
        <a-select
          v-model:value="dialog.selectedVersion"
          :loading="dialog.versionLoading"
          :placeholder="t('TXT_CODE_modpack_version')"
        >
          <a-select-option
            v-for="v in dialog.versions"
            :key="versionId(v)"
            :value="versionId(v)"
            :disabled="!versionInstallable(v)"
          >
            {{ versionLabel(v) }}
          </a-select-option>
        </a-select>
      </a-form-item>
      <a-form-item v-if="source !== 'custom'" :label="t('TXT_CODE_modpack_memory')">
        <a-input-number v-model:value="dialog.maxMemoryMB" :min="1024" :step="1024" style="width: 100%" />
      </a-form-item>
    </a-form>
  </a-modal>
</template>

<style lang="scss" scoped>
.mb-12 {
  margin-bottom: 12px;
}
</style>
