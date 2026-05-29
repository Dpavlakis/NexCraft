<script setup lang="ts">
import BetweenMenus from "@/components/BetweenMenus.vue";
import CardPanel from "@/components/CardPanel.vue";
import { useAppRouters } from "@/hooks/useAppRouters";
import { t } from "@/lang/i18n";
import { remoteNodeList } from "@/services/apis";
import {
  installModpack,
  installServer,
  mcVersionsGet,
  modpackDetail,
  modpackSearch,
  modpackVersions,
  type McVersion,
  type ModpackDetail,
  type ModpackHit,
  type ModpackVersion
} from "@/services/apis/modpack";
import { reportErrorMsg } from "@/tools/validator";
import type { LayoutCard, NodeStatus } from "@/types";
import { AppstoreOutlined, BlockOutlined, SearchOutlined } from "@ant-design/icons-vue";
import curseforgeIcon from "@/assets/curseforge.svg";
import modrinthIcon from "@/assets/modrinth.svg";
import { message } from "ant-design-vue";
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";

defineProps<{ card: LayoutCard }>();

const { toPage } = useAppRouters();

type Source = "custom" | "curseforge" | "modrinth";
const source = ref<Source>("custom");
const sources: { key: Source; label: string; img?: string }[] = [
  { key: "custom", label: t("TXT_CODE_modpack_custom") },
  { key: "curseforge", label: "CurseForge", img: curseforgeIcon },
  { key: "modrinth", label: "Modrinth", img: modrinthIcon }
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
  slug?: string;
  author?: string;
  downloads?: number;
  // custom (built-in Minecraft versions) only:
  mcType?: string;
}
const results = ref<ResultItem[]>([]);

// Custom tab = Prism-style server builder: pick a mod loader + a real Minecraft
// release version (from Mojang), then the daemon bootstraps it.
const customLoaders = [
  { value: "vanilla", label: "Vanilla" },
  { value: "fabric", label: "Fabric" },
  { value: "forge", label: "Forge" },
  { value: "neoforge", label: "NeoForge" },
  { value: "quilt", label: "Quilt" }
];
const customLoader = ref("vanilla");
const showSnapshots = ref(false);
const mcVersionsRaw = ref<McVersion[]>([]);

const loading = ref(false);
const searchText = ref("");
const sortField = ref("featured");

// Auto-size the results list to the window, leaving padding at the bottom.
const resultsScrollEl = ref<HTMLElement>();
const scrollMaxHeight = ref("520px");
const BOTTOM_PADDING = 24;
const recomputeHeight = () => {
  const el = resultsScrollEl.value;
  if (!el) return;
  const top = el.getBoundingClientRect().top;
  const h = window.innerHeight - top - BOTTOM_PADDING;
  scrollMaxHeight.value = Math.max(320, Math.round(h)) + "px";
};
const sortOptions = [
  { value: "featured", label: t("TXT_CODE_modpack_sort_featured") },
  { value: "popularity", label: t("TXT_CODE_modpack_sort_popularity") },
  { value: "lastupdated", label: t("TXT_CODE_modpack_sort_updated") },
  { value: "name", label: t("TXT_CODE_modpack_sort_name") },
  { value: "author", label: t("TXT_CODE_modpack_sort_author") },
  { value: "totaldownloads", label: t("TXT_CODE_modpack_sort_downloads") }
];

const fmtDate = (s?: string) => {
  if (!s) return "";
  const d = new Date(s);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString();
};

// Apply the search box + snapshot toggle to the fetched Mojang version list.
const applyCustomFilter = () => {
  const q = searchText.value.trim().toLowerCase();
  results.value = mcVersionsRaw.value
    .filter((v) => showSnapshots.value || v.type === "release")
    .filter((v) => !q || v.id.toLowerCase().includes(q))
    .map((v) => ({
      id: v.id,
      title: v.id,
      description: `${v.type}${v.releaseTime ? " · " + fmtDate(v.releaseTime) : ""}`,
      mcType: v.type
    }));
  nextTick(recomputeHeight);
};

const loadCustom = async () => {
  loading.value = true;
  try {
    if (!mcVersionsRaw.value.length) {
      const res = await mcVersionsGet().execute();
      mcVersionsRaw.value = res.value || [];
    }
    applyCustomFilter();
  } catch (err: any) {
    reportErrorMsg(err.message);
  } finally {
    loading.value = false;
    nextTick(recomputeHeight);
  }
};

const search = async () => {
  if (source.value === "custom") return applyCustomFilter();
  loading.value = true;
  try {
    const { execute } = modpackSearch();
    const res = await execute({
      params: {
        query: searchText.value,
        source: source.value,
        type: "modpack",
        sort: sortField.value,
        offset: 0,
        limit: 30
      },
      forceRequest: true
    });
    results.value = (res.value?.hits || []).map((h: ModpackHit) => ({
      id: h.id,
      title: h.title,
      description: h.description,
      icon: h.icon_url,
      slug: h.slug,
      author: h.author,
      downloads: h.downloads
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
  // Custom loads the local catalog; CF/Modrinth load popular packs (empty query).
  if (s === "custom") loadCustom();
  else search();
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
  installing: false,
  detail: null as ModpackDetail | null,
  detailLoading: false,
  acceptEula: false
});

const loadDetail = async (item: ResultItem) => {
  dialog.detail = null;
  dialog.detailLoading = true;
  try {
    const { execute } = modpackDetail();
    const res = await execute({ params: { source: source.value, projectId: item.id } });
    dialog.detail = res.value || null;
  } catch (err: any) {
    // non-fatal — fall back to the summary we already have
  } finally {
    dialog.detailLoading = false;
  }
};

const loadVersions = async (item: ResultItem) => {
  dialog.versionLoading = true;
  try {
    const { execute } = modpackVersions();
    const res = await execute({ params: { source: source.value, projectId: item.id } });
    dialog.versions = res.value || [];
    const first = dialog.versions.find((v) => versionInstallable(v));
    dialog.selectedVersion = first ? versionId(first) : "";
  } catch (err: any) {
    reportErrorMsg(err.message);
  } finally {
    dialog.versionLoading = false;
  }
};

const currentLoaderLabel = () =>
  customLoaders.find((l) => l.value === customLoader.value)?.label || "Vanilla";

const openInstall = (item: ResultItem) => {
  dialog.item = item;
  dialog.daemonId = nodes.value[0]?.uuid || "";
  dialog.selectedVersion = "";
  dialog.versions = [];
  dialog.detail = null;
  dialog.acceptEula = false;
  dialog.open = true;
  if (source.value === "custom") {
    // item.id is the chosen Minecraft version; loader comes from the radio.
    dialog.instanceName = `${currentLoaderLabel()} ${item.id}`.slice(0, 40);
  } else {
    dialog.instanceName = item.title.slice(0, 40);
    // fetch detail + versions in parallel
    loadDetail(item);
    loadVersions(item);
  }
};

const formatUpdated = (d?: string) => (d ? new Date(d).toLocaleDateString() : "");

const onMemWheel = (e: WheelEvent) => {
  const delta = e.deltaY < 0 ? 1024 : -1024;
  dialog.maxMemoryMB = Math.max(1024, (dialog.maxMemoryMB || 0) + delta);
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

const dialogSourceUrl = computed(() => {
  const it = dialog.item;
  if (!it) return "";
  if (source.value === "curseforge")
    return `https://www.curseforge.com/minecraft/modpacks/${it.slug || it.id}`;
  if (source.value === "modrinth") return `https://modrinth.com/modpack/${it.slug || it.id}`;
  return "";
});

const formatDownloads = (n?: number) => {
  if (!n) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
};

const canInstall = computed(() => {
  if (!dialog.instanceName || !dialog.daemonId) return false;
  // custom (built-in versions) auto-accept the EULA; the MC version is the row
  if (source.value === "custom") return !!dialog.item?.id;
  return dialog.acceptEula && !!dialog.selectedVersion;
});

const doInstall = async () => {
  if (!dialog.item || !canInstall.value) return;
  dialog.installing = true;
  try {
    let instanceUuid = "";
    if (source.value === "custom") {
      const { execute } = installServer();
      const res = await execute({
        params: { daemonId: dialog.daemonId },
        data: {
          mcVersion: dialog.item.id,
          loader: customLoader.value,
          instanceName: dialog.instanceName,
          maxMemoryMB: dialog.maxMemoryMB,
          acceptEula: true
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
          maxMemoryMB: dialog.maxMemoryMB,
          acceptEula: dialog.acceptEula
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

// The search row shows/hides with the source, which shifts the list's top edge.
watch(source, () => nextTick(recomputeHeight));

onMounted(() => {
  loadNodes();
  loadCustom();
  nextTick(recomputeHeight);
  window.addEventListener("resize", recomputeHeight);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", recomputeHeight);
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
                <template #icon>
                  <img v-if="s.img" :src="s.img" class="source-icon" alt="" />
                  <BlockOutlined v-else />
                </template>
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
            <div v-if="source === 'custom'" class="mb-12 custom-controls">
              <div class="search-row">
                <a-input-search
                  v-model:value="searchText"
                  :placeholder="t('TXT_CODE_modpack_search_ver')"
                  @search="applyCustomFilter"
                  @input="applyCustomFilter"
                >
                  <template #prefix><SearchOutlined /></template>
                </a-input-search>
                <a-checkbox
                  v-model:checked="showSnapshots"
                  class="snap-check"
                  @change="applyCustomFilter"
                >
                  {{ t("TXT_CODE_modpack_snapshots") }}
                </a-checkbox>
              </div>
              <a-radio-group v-model:value="customLoader" button-style="solid" class="loader-radio">
                <a-radio-button v-for="l in customLoaders" :key="l.value" :value="l.value">
                  {{ l.label }}
                </a-radio-button>
              </a-radio-group>
            </div>
            <div v-else class="mb-12 search-row">
              <a-input-search
                v-model:value="searchText"
                :placeholder="t('TXT_CODE_modpack_search_ph')"
                enter-button
                @search="search"
              >
                <template #prefix><SearchOutlined /></template>
              </a-input-search>
              <a-select
                v-model:value="sortField"
                class="sort-select"
                :options="sortOptions"
                @change="search"
              />
            </div>
            <a-spin :spinning="loading">
              <div ref="resultsScrollEl" class="results-scroll" :style="{ maxHeight: scrollMaxHeight }">
                <a-list item-layout="horizontal" :data-source="results">
                <template #renderItem="{ item }">
                  <a-list-item class="result-row" @click="openInstall(item)">
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
              </div>
            </a-spin>
          </template>
        </CardPanel>
      </a-col>
    </a-row>
  </div>

  <a-modal
    v-model:open="dialog.open"
    :title="t('TXT_CODE_modpack_install') + (dialog.item ? ' - ' + dialog.item.title : '')"
    :width="760"
    :confirm-loading="dialog.installing"
    :ok-button-props="{ disabled: !canInstall }"
    @ok="doInstall"
  >
    <div v-if="dialog.item" class="pack-detail">
      <img
        v-if="dialog.item.icon"
        :src="dialog.item.icon"
        class="pack-hero"
        alt=""
        @error="dialog.item && (dialog.item.icon = '')"
      />
      <div class="pack-head">
        <div class="pack-head-text">
          <div class="pack-title">{{ dialog.item.title }}</div>
          <div class="pack-meta">
            <span v-if="dialog.item.author">{{ dialog.item.author }}</span>
            <span v-if="dialog.item.downloads">
              · {{ formatDownloads(dialog.item.downloads) }} ↓</span
            >
            <span v-if="dialog.detail?.updated">
              · {{ t("TXT_CODE_modpack_updated") }} {{ formatUpdated(dialog.detail.updated) }}</span
            >
          </div>
          <a v-if="dialogSourceUrl" :href="dialogSourceUrl" target="_blank" rel="noopener">
            {{ t("TXT_CODE_modpack_view_source") }}
          </a>
        </div>
      </div>

      <div v-if="dialog.detail?.categories?.length || dialog.detail?.gameVersions?.length" class="pack-tags">
        <a-tag v-for="c in dialog.detail?.categories?.slice(0, 6)" :key="'c' + c">{{ c }}</a-tag>
        <a-tag v-for="g in dialog.detail?.gameVersions?.slice(0, 6)" :key="'g' + g" color="blue">
          {{ g }}
        </a-tag>
      </div>

      <a-spin :spinning="dialog.detailLoading">
        <div class="pack-desc">
          {{ dialog.detail?.description || dialog.item.description }}
        </div>
      </a-spin>
    </div>

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
      <a-form-item v-if="source === 'custom'" :label="t('TXT_CODE_modpack_version')">
        <a-input :value="`${currentLoaderLabel()}  —  ${dialog.item?.id || ''}`" disabled />
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
      <a-form-item :label="t('TXT_CODE_modpack_memory')">
        <a-input-number
          v-model:value="dialog.maxMemoryMB"
          :min="1024"
          :step="1024"
          style="width: 100%"
          @wheel.prevent="onMemWheel"
        />
      </a-form-item>
      <a-form-item v-if="source !== 'custom'">
        <a-checkbox v-model:checked="dialog.acceptEula">
          {{ t("TXT_CODE_modpack_eula") }}
          <a href="https://aka.ms/MinecraftEULA" target="_blank" rel="noopener" @click.stop>
            {{ t("TXT_CODE_modpack_eula_link") }}
          </a>
        </a-checkbox>
      </a-form-item>
    </a-form>
  </a-modal>
</template>

<style lang="scss" scoped>
.mb-12 {
  margin-bottom: 12px;
}
.search-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.custom-controls .snap-check {
  flex-shrink: 0;
  white-space: nowrap;
}
.custom-controls .loader-radio {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
}
.sort-select {
  width: 200px;
  flex-shrink: 0;
}
.source-icon {
  width: 16px;
  height: 16px;
  vertical-align: -3px;
  object-fit: contain;
}
.results-scroll {
  /* max-height is set dynamically from the window size (see recomputeHeight) */
  min-height: 320px;
  overflow-y: auto;
  padding-right: 4px;
}
.result-row {
  cursor: pointer;
}
.result-row:hover {
  background: rgba(128, 128, 128, 0.06);
}
.pack-detail {
  margin-bottom: 16px;
}
.pack-hero {
  width: 100%;
  max-height: 220px;
  object-fit: contain;
  border-radius: 8px;
  background: rgba(128, 128, 128, 0.08);
  margin-bottom: 12px;
}
.pack-head {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 8px;
}
.pack-title {
  font-size: 18px;
  font-weight: 600;
}
.pack-meta {
  font-size: 12px;
  opacity: 0.7;
}
.pack-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 10px;
}
.pack-desc {
  max-height: 220px;
  overflow-y: auto;
  white-space: pre-wrap;
  font-size: 13px;
  line-height: 1.6;
  opacity: 0.85;
  padding-right: 6px;
}
</style>
