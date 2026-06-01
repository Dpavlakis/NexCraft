<script setup lang="ts">
import BetweenMenus from "@/components/BetweenMenus.vue";
import CardPanel from "@/components/CardPanel.vue";
import { useAppRouters } from "@/hooks/useAppRouters";
import { QUICKSTART_METHOD } from "@/hooks/widgets/quickStartFlow";
import { useAppStateStore } from "@/stores/useAppStateStore";
import { t } from "@/lang/i18n";
import { remoteNodeList } from "@/services/apis";
import {
  installModpack,
  installServer,
  loaderVersionsGet,
  mcVersionsGet,
  modpackDetail,
  modpackSearch,
  modpackVersions,
  reinstallModpack,
  reinstallServer,
  serverVersionsGet,
  type McVersion,
  type ModpackDetail,
  type ModpackHit,
  type ModpackVersion,
  type ResetMode
} from "@/services/apis/modpack";
import { reportErrorMsg } from "@/tools/validator";
import { LOADER_INFO } from "@/tools/loaderInfo";
import { modpackBrowseCache } from "./modpackBrowseCache";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import type { LayoutCard, NodeStatus } from "@/types";
import {
  AppstoreOutlined,
  BlockOutlined,
  FileZipOutlined,
  FolderOpenOutlined,
  SearchOutlined
} from "@ant-design/icons-vue";
import curseforgeIcon from "@/assets/curseforge.svg";
import modrinthIcon from "@/assets/modrinth.svg";
import ftbIcon from "@/assets/ftb.svg";
import grassBlockIcon from "@/assets/grass-block.svg";
import fileUploadIcon from "@/assets/file-upload.svg";
import vanillaIcon from "@/assets/loaders/vanilla.svg";
import bedrockIcon from "@/assets/loaders/bedrock.svg";
import paperIcon from "@/assets/loaders/paper.png";
import purpurIcon from "@/assets/loaders/purpur.png";
import foliaIcon from "@/assets/loaders/folia.png";
import fabricIcon from "@/assets/loaders/fabric.png";
import forgeIcon from "@/assets/loaders/forge.jpg";
import neoforgeIcon from "@/assets/loaders/neoforge.png";
import quiltIcon from "@/assets/loaders/quilt.png";
// Segmented isn't picked up by this project's unplugin-vue-components Ant
// resolver (it's missing from components.d.ts), so <a-segmented> would render
// as an empty element. Import it explicitly so the loader picker shows.
import { message, Segmented as ASegmented } from "ant-design-vue";
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";

const props = defineProps<{
  card: LayoutCard;
  // When set, the browser operates in "reinstall mode": instead of creating a
  // new instance, the chosen pack/build is reinstalled into this instance.
  // packInfo (when present) focuses the dialog on the currently-installed pack.
  reinstallTarget?: {
    instanceId: string;
    daemonId: string;
    instanceName?: string;
    packInfo?: IModpackInfo;
  };
}>();
const emit = defineEmits<{
  (e: "close"): void;
  (e: "manual-install", method: QUICKSTART_METHOD): void;
}>();

const { isAdmin } = useAppStateStore();

const isReinstall = computed(() => !!props.reinstallTarget);
// The Import / Existing tab replaces the old "Create Instance" cards: it only
// makes sense in browse mode (never when reinstalling into an existing
// instance) and was admin-gated like those cards.
const showImportTab = computed(() => !props.reinstallTarget && isAdmin.value);
// Reset behaviour chosen by the user (only used in reinstall mode).
const resetMode = ref<ResetMode>("preserve_world");
// For a modpack (CurseForge/Modrinth) reset we focus straight on that pack's
// popup and hide the browse chrome; custom/vanilla resets still browse versions.
const hideChrome = computed(() => {
  const src = props.reinstallTarget?.packInfo?.source;
  return (
    isReinstall.value &&
    (src === "curseforge" || src === "modrinth" || src === "ftb" || src === "bedrock")
  );
});

const { toPage } = useAppRouters();

type Source = "custom" | "curseforge" | "modrinth" | "ftb" | "import";
const source = ref<Source>("custom");
const sources = computed<{ key: Source; label: string; img?: string }[]>(() => {
  const list: { key: Source; label: string; img?: string }[] = [
    { key: "custom", label: t("TXT_CODE_modpack_vanilla"), img: grassBlockIcon },
    { key: "curseforge", label: "CurseForge", img: curseforgeIcon },
    { key: "modrinth", label: "Modrinth", img: modrinthIcon },
    { key: "ftb", label: "FTB", img: ftbIcon }
  ];
  if (showImportTab.value) list.push({ key: "import", label: t("TXT_CODE_import_tab"), img: fileUploadIcon });
  return list;
});

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
  { value: "vanilla", label: "Java" },
  { value: "bedrock", label: "Bedrock" },
  { value: "paper", label: "PaperMC" },
  { value: "purpur", label: "Purpur" },
  { value: "folia", label: "Folia" },
  { value: "fabric", label: "Fabric" },
  { value: "forge", label: "Forge" },
  { value: "neoforge", label: "NeoForge" },
  { value: "quilt", label: "Quilt" }
];
const customLoader = ref("vanilla");
const showSnapshots = ref(false);
const customLoaderOptions = customLoaders.map((l) => ({ label: l.label, value: l.value }));

// ---- pagination (numbered pages instead of infinite scroll) ----
const PAGE_SIZE = 20;
const currentPage = ref(1);
const totalItems = ref(0);
// Full filtered Custom version list (Custom is paged client-side).
const customFiltered = ref<ResultItem[]>([]);

// Per-loader logo (bundled local asset) shown on the Custom version rows.
const LOADER_ICON: Record<string, string> = {
  vanilla: vanillaIcon,
  paper: paperIcon,
  purpur: purpurIcon,
  folia: foliaIcon,
  fabric: fabricIcon,
  forge: forgeIcon,
  neoforge: neoforgeIcon,
  quilt: quiltIcon,
  bedrock: bedrockIcon
};
const loaderIcon = computed(() => LOADER_ICON[customLoader.value] || "");
const mcVersionsRaw = ref<McVersion[]>([]);
// Every loader except plain Vanilla has its own curated version list (server
// software APIs, or each loader's game-version API). Vanilla uses Mojang's list.
const PER_LOADER_VERSIONS = [
  "paper",
  "purpur",
  "folia",
  "bedrock",
  "fabric",
  "quilt",
  "forge",
  "neoforge"
];
const isServerSoftware = (l: string) => PER_LOADER_VERSIONS.includes(l);
const versionCache: Record<string, McVersion[]> = {};

const loading = ref(false);
const searchText = ref("");
const sortField = ref("featured");

// Auto-size the results list to the window, leaving padding at the bottom.
const resultsScrollEl = ref<HTMLElement>();
const scrollMaxHeight = ref("520px");
const BOTTOM_PADDING = 32;
const recomputeHeight = () => {
  const el = resultsScrollEl.value;
  if (!el) return;
  const top = el.getBoundingClientRect().top;
  // The pager row sits BELOW this scroll area (a sibling) and only when paginated.
  // Reserve room for it + the bottom margin so the list/pager never touch the
  // screen edge, and so it reflows correctly on window resize.
  const pagerReserve = totalItems.value > PAGE_SIZE ? 56 : 0;
  const h = window.innerHeight - top - BOTTOM_PADDING - pagerReserve;
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
const sliceCustomPage = () => {
  const start = (currentPage.value - 1) * PAGE_SIZE;
  results.value = customFiltered.value.slice(start, start + PAGE_SIZE);
  nextTick(recomputeHeight);
};

const applyCustomFilter = () => {
  const q = searchText.value.trim().toLowerCase();
  // Server-software lists (Paper/Purpur/Folia/Bedrock) are already curated, so
  // show every entry — this also surfaces the Bedrock "preview" build.
  const showAll = showSnapshots.value || isServerSoftware(customLoader.value);
  customFiltered.value = mcVersionsRaw.value
    .filter((v) => showAll || v.type === "release")
    .filter((v) => !q || v.id.toLowerCase().includes(q))
    .map((v) => ({
      id: v.id,
      title: v.id,
      description:
        v.type === "preview"
          ? t("TXT_CODE_modpack_preview_warn")
          : `${v.type}${v.releaseTime ? " · " + fmtDate(v.releaseTime) : ""}`,
      mcType: v.type
    }));
  totalItems.value = customFiltered.value.length;
  currentPage.value = 1;
  sliceCustomPage();
};

const loadCustom = async () => {
  loading.value = true;
  try {
    const key = isServerSoftware(customLoader.value) ? customLoader.value : "mojang";
    if (!versionCache[key]) {
      if (key === "mojang") {
        const res = await mcVersionsGet().execute();
        versionCache[key] = res.value || [];
      } else {
        const res = await serverVersionsGet().execute({ params: { software: customLoader.value } });
        versionCache[key] = res.value || [];
      }
    }
    mcVersionsRaw.value = versionCache[key];
    applyCustomFilter();
  } catch (err: any) {
    reportErrorMsg(err.message);
  } finally {
    loading.value = false;
    nextTick(recomputeHeight);
  }
};

const browseKey = () =>
  `${source.value}|${sortField.value}|${searchText.value.trim().toLowerCase()}|${currentPage.value}`;

const search = async () => {
  if (source.value === "custom") return applyCustomFilter();
  // Stale-while-revalidate: if we've fetched this list before, show it instantly
  // (no spinner) and refresh in the background; otherwise show the spinner.
  const key = browseKey();
  const cached = modpackBrowseCache.get(key);
  if (cached) {
    results.value = cached.hits;
    totalItems.value = cached.total;
    loading.value = false;
  } else {
    loading.value = true;
  }
  try {
    const { execute } = modpackSearch();
    const res = await execute({
      params: {
        query: searchText.value,
        source: source.value,
        type: "modpack",
        sort: sortField.value,
        offset: (currentPage.value - 1) * PAGE_SIZE,
        limit: PAGE_SIZE
      },
      forceRequest: true
    });
    const mapped = (res.value?.hits || []).map((h: ModpackHit) => ({
      id: h.id,
      title: h.title,
      description: h.description,
      icon: h.icon_url,
      slug: h.slug,
      author: h.author,
      downloads: h.downloads
    }));
    results.value = mapped;
    totalItems.value = res.value?.total_hits || 0;
    modpackBrowseCache.set(key, { hits: mapped, total: totalItems.value });
  } catch (err: any) {
    // Only surface the error if we had nothing cached to show.
    if (!cached) reportErrorMsg(err.message);
  } finally {
    loading.value = false;
  }
};

// New search/sort submit + page change reset to page 1 where appropriate.
const onSearchSubmit = () => {
  currentPage.value = 1;
  search();
};
const onSortChange = () => {
  currentPage.value = 1;
  search();
};
const onPageChange = (p: number) => {
  currentPage.value = p;
  if (source.value === "custom") sliceCustomPage();
  else search();
};
const onTabChange = (k: any) => selectSource(k as Source);

const selectSource = (s: Source) => {
  source.value = s;
  searchText.value = "";
  currentPage.value = 1;
  totalItems.value = 0;
  // Custom loads the local catalog; CF/Modrinth load popular packs (empty query).
  if (s === "import") {
    // No browsing — the import panel just exposes the existing upload/create flow.
    results.value = [];
    customFiltered.value = [];
  } else if (s === "custom") {
    results.value = [];
    customFiltered.value = [];
    loadCustom();
  } else {
    // Show this source's cached page immediately (if any) to avoid an empty flash.
    const cached = modpackBrowseCache.get(browseKey());
    results.value = cached?.hits || [];
    totalItems.value = cached?.total || 0;
    search();
  }
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
  loaderVersions: [] as McVersion[],
  loaderVersionLoading: false,
  selectedLoaderVersion: "" as string,
  installing: false,
  detail: null as ModpackDetail | null,
  detailLoading: false,
  acceptEula: false,
  tab: "details" as "details" | "install"
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
  customLoaders.find((l) => l.value === customLoader.value)?.label || "Java";
const currentLoaderInfo = computed(() => LOADER_INFO[customLoader.value]);

// Modloaders let the user choose the specific build; others auto-pick latest.
const MODLOADERS = ["fabric", "quilt", "forge", "neoforge"];
const needsLoaderBuild = computed(
  () => source.value === "custom" && MODLOADERS.includes(customLoader.value)
);

let loaderFetchId = 0;
const loadLoaderBuilds = async (mc: string) => {
  const myId = ++loaderFetchId;
  dialog.loaderVersions = [];
  dialog.selectedLoaderVersion = "";
  if (!needsLoaderBuild.value || !mc) return;
  dialog.loaderVersionLoading = true;
  try {
    const res = await loaderVersionsGet().execute({
      params: { loader: customLoader.value, mc }
    });
    if (myId !== loaderFetchId) return; // superseded — discard
    dialog.loaderVersions = res.value || [];
    const stable = dialog.loaderVersions.find((v) => v.type === "release");
    dialog.selectedLoaderVersion = (stable || dialog.loaderVersions[0])?.id || "";
  } catch (err: any) {
    if (myId !== loaderFetchId) return;
    reportErrorMsg(err.message);
  } finally {
    if (myId === loaderFetchId) dialog.loaderVersionLoading = false;
  }
};

const openInstall = (item: ResultItem) => {
  dialog.item = item;
  dialog.daemonId = props.reinstallTarget?.daemonId || nodes.value[0]?.uuid || "";
  dialog.selectedVersion = "";
  dialog.versions = [];
  dialog.detail = null;
  dialog.tab = "details"; // open on Details; Install tab is one click away
  // On a reset the instance already exists (EULA was accepted before), so
  // pre-tick it for convenience; a fresh install still requires explicit consent.
  dialog.acceptEula = isReinstall.value;
  dialog.open = true;
  if (source.value === "custom") {
    // item.id is the chosen Minecraft version; loader comes from the radio.
    dialog.instanceName = `${currentLoaderLabel()} ${item.id}`.slice(0, 40);
    loadLoaderBuilds(item.id);
  } else {
    dialog.instanceName = item.title.slice(0, 40);
    // fetch detail + versions in parallel
    loadDetail(item);
    loadVersions(item);
  }
};

const formatUpdated = (d?: string) => (d ? new Date(d).toLocaleDateString() : "");
const capitalize = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");

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
  if (source.value === "ftb") return `https://www.feed-the-beast.com/modpacks/${it.id}`;
  return "";
});

// Render the pack description with images, but drop videos/scripts (sanitize)
// and "rent a server" promo blocks that clutter CurseForge descriptions.
const HOSTING_RE =
  /(bisecthosting|apexhosting|shockbyte|gameserver|serverminer|nodecraft|akliz|mcprohosting|pebblehost|bloom\.host|kinetichosting|aquatis|sparkedhost|hosthavoc|fluctishosting|creeperhost|gtxgaming|scalacube)/i;
const PROMO_RE =
  /(buy|rent|get|grab|order)\b[^.]{0,40}\bserver|\bserver\b[^.]{0,30}(host|hosting|deal|discount|coupon|promo)|use code|click here to (buy|get|rent|order)/i;

const packDescHtml = computed(() => {
  const d = dialog.detail;
  if (!d?.descriptionHtml) return "";
  const raw =
    d.descriptionFormat === "markdown"
      ? (marked.parse(d.descriptionHtml, { async: false }) as string)
      : d.descriptionHtml;
  return sanitizeHtml(raw, {
    allowedTags: [
      "p", "br", "b", "strong", "i", "em", "u", "s", "span", "div", "center",
      "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote",
      "code", "pre", "hr", "a", "img", "table", "thead", "tbody", "tr", "td", "th"
    ],
    allowedAttributes: { a: ["href", "target", "rel"], img: ["src", "alt"] },
    allowedSchemes: ["http", "https"],
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer" }
      })
    },
    exclusiveFilter: (frame) => {
      const text = (frame.text || "").toLowerCase();
      if (frame.tag === "a" && HOSTING_RE.test(frame.attribs?.href || "")) return true;
      if (
        (frame.tag === "p" ||
          frame.tag === "div" ||
          frame.tag === "center" ||
          /^h[1-6]$/.test(frame.tag)) &&
        PROMO_RE.test(text)
      )
        return true;
      return false;
    }
  });
});

const formatDownloads = (n?: number) => {
  if (!n) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
};

const canInstall = computed(() => {
  // In reinstall mode the instance already exists (no name needed); otherwise a
  // name + target node are required.
  if (!dialog.daemonId) return false;
  if (!isReinstall.value && !dialog.instanceName) return false;
  // custom (built-in versions): the MC version is the selected row; EULA still
  // required for consistency with the modpack flow.
  if (source.value === "custom") {
    if (needsLoaderBuild.value && (dialog.loaderVersionLoading || !dialog.selectedLoaderVersion))
      return false;
    return !!dialog.item?.id && dialog.acceptEula;
  }
  return dialog.acceptEula && !!dialog.selectedVersion;
});

const doInstall = async () => {
  if (!dialog.item || !canInstall.value) return;
  dialog.installing = true;
  try {
    let instanceUuid = "";
    const target = props.reinstallTarget;
    const v =
      source.value === "custom"
        ? undefined
        : dialog.versions.find((x) => versionId(x) === dialog.selectedVersion);

    if (target) {
      // ---- Reinstall into the existing instance ----
      if (source.value === "custom") {
        const { execute } = reinstallServer();
        await execute({
          params: { daemonId: target.daemonId, uuid: target.instanceId },
          data: {
            mcVersion: dialog.item.id,
            loader: customLoader.value,
            maxMemoryMB: dialog.maxMemoryMB,
            acceptEula: true,
            resetMode: resetMode.value,
            loaderVersion: dialog.selectedLoaderVersion
          }
        });
      } else {
        const { execute } = reinstallModpack();
        await execute({
          params: { daemonId: target.daemonId, uuid: target.instanceId },
          data: {
            source: source.value,
            projectId: dialog.item.id,
            projectName: dialog.item.title,
            fileId: dialog.selectedVersion,
            versionName: v ? versionLabel(v) : "",
            iconUrl: dialog.item.icon,
            maxMemoryMB: dialog.maxMemoryMB,
            acceptEula: dialog.acceptEula,
            resetMode: resetMode.value
          }
        });
      }
      instanceUuid = target.instanceId;
    } else if (source.value === "custom") {
      const { execute } = installServer();
      const res = await execute({
        params: { daemonId: dialog.daemonId },
        data: {
          mcVersion: dialog.item.id,
          loader: customLoader.value,
          instanceName: dialog.instanceName,
          maxMemoryMB: dialog.maxMemoryMB,
          acceptEula: true,
          loaderVersion: dialog.selectedLoaderVersion
        }
      });
      instanceUuid = res.value?.instanceUuid || "";
    } else {
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
    message.success(t(target ? "TXT_CODE_modpack_reset_started" : "TXT_CODE_modpack_install_started"));
    dialog.open = false;
    if (target) emit("close");
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
// Switching the Custom mod loader changes which version list applies.
watch(customLoader, () => {
  if (source.value === "custom") {
    loadCustom();
    if (dialog.open) loadLoaderBuilds(dialog.item?.id || "");
  }
});

// In reinstall mode, jump straight to the currently-installed pack's dialog so
// the reset focuses on what's already there (rather than the browse list).
const focusInstalledPack = () => {
  const pk = props.reinstallTarget?.packInfo;
  if (!pk) return false;
  if (pk.source === "curseforge" || pk.source === "modrinth" || pk.source === "ftb") {
    selectSource(pk.source);
    openInstall({
      id: pk.projectId,
      title: pk.projectName || pk.projectId,
      description: "",
      icon: pk.iconUrl
    });
    return true;
  }
  // Bedrock: a version-locked reinstall. Behave like a modpack reset — focus
  // straight on the installed version's reset popup (chrome hidden) instead of
  // making the user browse a version list.
  if (pk.source === "bedrock") {
    customLoader.value = "bedrock";
    selectSource("custom");
    openInstall({
      id: pk.mcVersion,
      title: pk.projectName || `Bedrock ${pk.mcVersion}`,
      description: "",
      icon: pk.iconUrl
    });
    return true;
  }

  // Custom build: select the installed loader BEFORE switching to the Custom
  // source. selectSource() immediately calls loadCustom(), which reads
  // customLoader to decide which version list to fetch — if we set the loader
  // afterwards, that first load races (with the default "vanilla"/Mojang list)
  // and the slower Mojang fetch usually lands last and overwrites the correct
  // list, so e.g. a Paper instance ends up showing the vanilla version list.
  if (pk.loader) customLoader.value = pk.loader;
  selectSource("custom");
  return true;
};

// In reinstall mode there's no browser behind the popup, so closing it (Cancel)
// should tear down the whole dialog.
watch(
  () => dialog.open,
  (open) => {
    // Only the chrome-less modpack reset has nothing behind the popup, so
    // cancelling it should tear down the whole dialog.
    if (hideChrome.value && !open && !dialog.installing) emit("close");
  }
);

onMounted(() => {
  loadNodes();
  // Default to the installed pack when reinstalling; otherwise load the catalog.
  if (!focusInstalledPack()) loadCustom();
  nextTick(recomputeHeight);
  window.addEventListener("resize", recomputeHeight);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", recomputeHeight);
});

// The pager shows/hides as totalItems crosses PAGE_SIZE, which changes the space we
// reserve below the list — recompute so the bottom padding stays correct.
watch(totalItems, () => nextTick(recomputeHeight));
</script>

<template>
  <!-- Browser chrome (source sidebar + results). Hidden for a modpack reset,
       where only the focused install/reset popup is shown. -->
  <div v-if="!hideChrome" style="height: 100%" class="container">
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

      <!-- Sources as tabs in a single block -->
      <a-col :span="24">
        <CardPanel style="height: 100%">
          <template #body>
            <a-tabs :active-key="source" @change="onTabChange">
              <a-tab-pane v-for="s in sources" :key="s.key">
                <template #tab>
                  <span class="source-tab">
                    <img v-if="s.img" :src="s.img" class="source-icon" alt="" />
                    <BlockOutlined v-else />
                    {{ s.label }}
                  </span>
                </template>
              </a-tab-pane>
            </a-tabs>

            <!-- Import / Existing: reuse the existing upload + create-directly
                 flows (handled by the parent via the manual-install event). -->
            <div v-if="source === 'import'" class="import-panel">
              <FolderOpenOutlined class="import-icon" />
              <div class="import-title">{{ t("TXT_CODE_a3efb1cc") }}</div>
              <div class="import-desc">{{ t("TXT_CODE_f09da050") }}</div>
              <a-button
                type="primary"
                size="large"
                @click="emit('manual-install', QUICKSTART_METHOD.IMPORT)"
              >
                <template #icon><FileZipOutlined /></template>
                {{ t("TXT_CODE_modpack_select_zip") }}
              </a-button>
            </div>

            <!-- Custom: loader picker + version search -->
            <div v-else-if="source === 'custom'" class="mb-12 custom-controls">
              <a-segmented
                v-model:value="customLoader"
                :options="customLoaderOptions"
                class="loader-segmented"
              />
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
                  v-if="!isServerSoftware(customLoader)"
                  v-model:checked="showSnapshots"
                  class="snap-check"
                  @change="applyCustomFilter"
                >
                  {{ t("TXT_CODE_modpack_snapshots") }}
                </a-checkbox>
              </div>
            </div>
            <!-- CurseForge / Modrinth: search + sort -->
            <div v-else class="mb-12 search-row">
              <a-input-search
                v-model:value="searchText"
                :placeholder="t('TXT_CODE_modpack_search_ph')"
                enter-button
                @search="onSearchSubmit"
              >
                <template #prefix><SearchOutlined /></template>
              </a-input-search>
              <!-- FTB's API only exposes a single "popular" ordering, so the
                   sort options don't apply there — hide it instead of showing a
                   non-functional dropdown. -->
              <a-select
                v-if="source !== 'ftb'"
                v-model:value="sortField"
                class="sort-select"
                :options="sortOptions"
                @change="onSortChange"
              />
            </div>
            <!-- Many recent FTB packs (e.g. StoneBlock 4) ship only through
                 CurseForge, not FTB's own API — point users there. -->
            <a-alert
              v-if="source === 'ftb'"
              class="mb-12 ftb-note"
              type="info"
              show-icon
              :message="t('TXT_CODE_modpack_ftb_note')"
            />

            <a-spin v-if="source !== 'import'" :spinning="loading">
              <div ref="resultsScrollEl" class="results-scroll" :style="{ maxHeight: scrollMaxHeight }">
                <a-list item-layout="horizontal" :data-source="results">
                  <template #renderItem="{ item }">
                    <a-list-item class="result-row" @click="openInstall(item)">
                      <a-list-item-meta :description="item.description">
                        <template #title>{{ item.title }}</template>
                        <template #avatar>
                          <a-avatar v-if="item.icon" :src="item.icon" shape="square" :size="44" />
                          <a-avatar
                            v-else-if="source === 'custom' && loaderIcon"
                            :src="loaderIcon"
                            shape="square"
                            :size="44"
                            :style="{ background: 'transparent' }"
                          />
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

            <div v-if="totalItems > PAGE_SIZE" class="pager-row">
              <a-pagination
                :current="currentPage"
                :page-size="PAGE_SIZE"
                :total="totalItems"
                :show-size-changer="false"
                size="small"
                @change="onPageChange"
              />
            </div>
          </template>
        </CardPanel>
      </a-col>
    </a-row>
  </div>

  <a-modal
    v-model:open="dialog.open"
    :title="
      (isReinstall ? t('TXT_CODE_modpack_reset') : t('TXT_CODE_modpack_install')) +
      (dialog.item ? ' - ' + dialog.item.title : '')
    "
    :width="760"
    :confirm-loading="dialog.installing"
    :ok-button-props="{ disabled: !canInstall }"
    @ok="doInstall"
  >
    <a-tabs v-model:activeKey="dialog.tab" class="install-tabs">
      <!-- Details: hero, meta, tags + image-rich description -->
      <a-tab-pane key="details" :tab="t('TXT_CODE_modpack_tab_details')">
        <div v-if="dialog.item && source === 'custom'" class="pack-detail custom-detail">
          <div class="pack-head">
            <img v-if="loaderIcon" :src="loaderIcon" class="loader-detail-icon" alt="" />
            <div class="pack-head-text">
              <div class="pack-title">{{ currentLoaderLabel() }} {{ dialog.item.id }}</div>
              <div class="pack-meta">
                <span>{{ dialog.item.description }}</span>
                <span v-if="dialog.selectedLoaderVersion"> · {{ dialog.selectedLoaderVersion }}</span>
              </div>
              <a v-if="currentLoaderInfo" :href="currentLoaderInfo.url" target="_blank" rel="noopener">
                {{ t("TXT_CODE_loader_learn_more") }}
              </a>
            </div>
          </div>

          <div v-if="currentLoaderInfo" class="pack-tags">
            <a-tag color="blue">{{ dialog.item.id }}</a-tag>
            <a-tag v-if="dialog.item.mcType">{{ capitalize(dialog.item.mcType) }}</a-tag>
            <a-tag v-for="ck in currentLoaderInfo.categoryKeys" :key="ck">{{ t(ck) }}</a-tag>
          </div>

          <p v-if="currentLoaderInfo" class="pack-desc">{{ t(currentLoaderInfo.blurbKey) }}</p>

          <template v-if="currentLoaderInfo">
            <div class="loader-feat-h">{{ t("TXT_CODE_loader_features") }}</div>
            <ul class="loader-feat">
              <li v-for="fk in currentLoaderInfo.featureKeys" :key="fk">{{ t(fk) }}</li>
            </ul>
            <div v-if="customLoader !== 'bedrock'" class="loader-java-note">
              {{ t("TXT_CODE_loader_java_autoprovision") }}
            </div>
          </template>
        </div>
        <div v-else-if="dialog.item" class="pack-detail">
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
                  · {{ t("TXT_CODE_modpack_updated") }}
                  {{ formatUpdated(dialog.detail.updated) }}</span
                >
              </div>
              <a v-if="dialogSourceUrl" :href="dialogSourceUrl" target="_blank" rel="noopener">
                {{ t("TXT_CODE_modpack_view_source") }}
              </a>
            </div>
          </div>

          <div
            v-if="dialog.detail?.categories?.length || dialog.detail?.gameVersions?.length"
            class="pack-tags"
          >
            <a-tag v-for="c in dialog.detail?.categories?.slice(0, 6)" :key="'c' + c">{{ c }}</a-tag>
            <a-tag v-for="g in dialog.detail?.gameVersions?.slice(0, 6)" :key="'g' + g" color="blue">
              {{ g }}
            </a-tag>
          </div>

          <a-spin :spinning="dialog.detailLoading">
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div v-if="packDescHtml" class="pack-desc pack-desc-html" v-html="packDescHtml"></div>
            <div v-else class="pack-desc">
              {{ dialog.detail?.description || dialog.item.description }}
            </div>
          </a-spin>
        </div>
      </a-tab-pane>

      <!-- Install: compact header + the form (always reachable without scrolling) -->
      <a-tab-pane
        key="install"
        :tab="isReinstall ? t('TXT_CODE_modpack_reset') : t('TXT_CODE_modpack_tab_install')"
      >
        <div v-if="dialog.item" class="install-pack-row">
          <a-avatar v-if="dialog.item.icon" :src="dialog.item.icon" shape="square" :size="40" />
          <a-avatar v-else shape="square" :size="40">
            <template #icon><AppstoreOutlined /></template>
          </a-avatar>
          <div class="install-pack-text">
            <div class="install-pack-title">{{ dialog.item.title }}</div>
            <div class="pack-meta">
              <span v-if="dialog.item.author">{{ dialog.item.author }}</span>
              <span v-if="dialog.item.downloads">
                · {{ formatDownloads(dialog.item.downloads) }} ↓</span
              >
            </div>
          </div>
        </div>

        <a-form layout="vertical">
          <!-- Reinstall mode: instance is fixed; let the user pick how to treat existing files -->
      <template v-if="isReinstall">
        <a-form-item :label="t('TXT_CODE_modpack_reset_target')">
          <a-input :value="reinstallTarget?.instanceName || reinstallTarget?.instanceId" disabled />
        </a-form-item>
        <a-form-item :label="t('TXT_CODE_modpack_reset_mode')">
          <a-radio-group v-model:value="resetMode" class="reset-radio">
            <a-radio value="backup_wipe">{{ t("TXT_CODE_modpack_reset_backup_wipe") }}</a-radio>
            <a-radio value="wipe">{{ t("TXT_CODE_modpack_reset_wipe") }}</a-radio>
            <a-radio value="preserve_world">{{ t("TXT_CODE_modpack_reset_preserve") }}</a-radio>
          </a-radio-group>
          <div class="reset-mode-hint">
            <a-typography-text type="secondary">
              {{
                resetMode === "backup_wipe"
                  ? t("TXT_CODE_modpack_reset_backup_wipe_desc")
                  : resetMode === "wipe"
                    ? t("TXT_CODE_modpack_reset_wipe_desc")
                    : t("TXT_CODE_modpack_reset_preserve_desc")
              }}
            </a-typography-text>
          </div>
          <a-alert
            v-if="resetMode === 'wipe'"
            class="mt-8"
            type="warning"
            show-icon
            :message="t('TXT_CODE_modpack_reset_wipe_warn')"
          />
        </a-form-item>
      </template>
      <template v-else>
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
      </template>
      <a-form-item v-if="source === 'custom'" :label="t('TXT_CODE_modpack_version')">
        <a-input :value="`${currentLoaderLabel()}  —  ${dialog.item?.id || ''}`" disabled />
      </a-form-item>
      <a-form-item v-if="needsLoaderBuild" :label="t('TXT_CODE_modpack_loader_build')">
        <a-select
          v-model:value="dialog.selectedLoaderVersion"
          :loading="dialog.loaderVersionLoading"
          :placeholder="t('TXT_CODE_modpack_loader_build')"
        >
          <a-select-option v-for="lv in dialog.loaderVersions" :key="lv.id" :value="lv.id">
            {{ lv.id }}{{ lv.type === "snapshot" ? " (beta)" : "" }}
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
      <a-form-item :label="t('TXT_CODE_modpack_memory')">
        <a-input-number
          v-model:value="dialog.maxMemoryMB"
          :min="1024"
          :step="1024"
          style="width: 100%"
          @wheel.prevent="onMemWheel"
        />
        <a-typography-text type="secondary" style="font-size: 12px">
          {{ t("TXT_CODE_modpack_memory_hint") }}
        </a-typography-text>
      </a-form-item>
      <a-form-item>
        <a-checkbox v-model:checked="dialog.acceptEula">
          {{ t("TXT_CODE_modpack_eula") }}
          <a href="https://aka.ms/MinecraftEULA" target="_blank" rel="noopener" @click.stop>
            {{ t("TXT_CODE_modpack_eula_link") }}
          </a>
        </a-checkbox>
      </a-form-item>
        </a-form>
      </a-tab-pane>
    </a-tabs>
  </a-modal>
</template>

<style lang="scss" scoped>
.mb-12 {
  margin-bottom: 12px;
}
.mt-8 {
  margin-top: 8px;
}
.reset-mode-hint {
  margin-top: 6px;
  font-size: 12px;
}
.reset-radio :deep(.ant-radio-wrapper) {
  display: flex;
  margin-bottom: 6px;
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
.custom-controls .loader-segmented {
  margin-bottom: 10px;
  max-width: 100%;
  overflow-x: auto;
}
.source-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.import-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 12px;
  min-height: 320px;
  padding: 32px 16px;
}
.import-panel .import-icon {
  font-size: 40px;
  opacity: 0.5;
}
.import-panel .import-title {
  font-size: 18px;
  font-weight: 600;
}
.import-panel .import-desc {
  max-width: 520px;
  font-size: 13px;
  line-height: 1.6;
  opacity: 0.7;
}
.pager-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
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
.install-tabs :deep(.ant-tabs-content) {
  min-height: 280px;
}
.install-pack-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.install-pack-title {
  font-size: 15px;
  font-weight: 600;
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
.pack-desc-html {
  white-space: normal;
  max-height: 320px;
}
.pack-desc-html :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  margin: 6px 0;
}
.pack-desc-html :deep(a) {
  color: #3179bd;
}
.pack-desc-html :deep(h1),
.pack-desc-html :deep(h2),
.pack-desc-html :deep(h3) {
  font-size: 15px;
  margin: 12px 0 4px;
}
.pack-desc-html :deep(p) {
  margin: 6px 0;
}
.pack-desc-html :deep(table) {
  width: 100%;
  border-collapse: collapse;
}
.pack-desc-html :deep(td),
.pack-desc-html :deep(th) {
  border: 1px solid var(--color-gray-4, #ddd);
  padding: 4px 6px;
}
.custom-detail .loader-detail-icon {
  width: 48px;
  height: 48px;
  object-fit: contain;
  margin-right: 12px;
}
.custom-detail .pack-head {
  display: flex;
  align-items: center;
}
.custom-detail .loader-feat-h {
  margin: 14px 0 6px;
  font-weight: 600;
  font-size: 13px;
}
.custom-detail .loader-feat {
  margin: 0;
  padding-left: 18px;
  li {
    margin: 3px 0;
  }
}
.custom-detail .loader-java-note {
  margin-top: 14px;
  padding: 8px 10px;
  font-size: 12.5px;
  border-radius: 6px;
  border: 1px solid rgba(74, 144, 217, 0.5);
  background: rgba(74, 144, 217, 0.1);
}
</style>
