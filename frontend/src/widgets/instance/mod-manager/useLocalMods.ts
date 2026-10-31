import { t } from "@/lang/i18n";
import {
  deleteModApi,
  getModBatchInfoApi,
  modListApi,
  toggleModApi
} from "@/services/apis/modManager";
import { message } from "ant-design-vue";
import { onUnmounted, reactive, ref, watch } from "vue";

export function useLocalMods(
  instanceId: string,
  daemonId: string,
  checkAndConfirm: (
    type: string,
    name: string,
    data: any,
    immediateFn: () => Promise<void>
  ) => void,
  addDeferredTask: (type: string, name: string, data: any) => void
) {
  const loading = ref(false);
  const loadingExtra = ref(false);
  const mods = ref<any[]>([]);
  const folders = ref<string[]>(["mods", "plugins"]);
  const fileStatus = ref<any>({});
  const totalMods = ref(0);
  const currentFolder = ref<string | undefined>(undefined);
  const headerSearchQuery = ref("");
  let disposed = false;
  let listActive = true;
  let epoch = 0;
  let controller: AbortController | undefined;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  // Only enrich the returned page. Retain a bounded hash cache across page/refresh changes.
  const extraInfoCache = new Map<string, any>();

  const tablePagination = reactive({
    current: 1,
    pageSize: 50,
    total: 0,
    showSizeChanger: true,
    size: "large",
    pageSizeOptions: ["10", "20", "50", "100", "250"],
    showTotal: (total: number) => t("TXT_CODE_TOTAL_ITEMS", { total })
  });

  const stopPolling = () => {
    clearTimeout(pollTimer);
    pollTimer = undefined;
  };

  const invalidate = () => {
    ++epoch;
    controller?.abort();
    controller = undefined;
    clearTimeout(searchTimer);
    searchTimer = undefined;
    stopPolling();
    loadingExtra.value = false;
  };

  const clearResults = () => {
    mods.value = [];
    totalMods.value = 0;
    tablePagination.total = 0;
    fileStatus.value = {};
  };

  const loadMods = async (folder: string | undefined = currentFolder.value, background = false) => {
    if (disposed) return;
    if (folder !== currentFolder.value) {
      tablePagination.current = 1;
      clearResults();
    }
    currentFolder.value = folder;
    invalidate();
    const requestEpoch = epoch;
    const requestController = new AbortController();
    controller = requestController;
    const isCurrent = () =>
      !disposed && epoch === requestEpoch && !requestController.signal.aborted;
    const params = {
      uuid: instanceId,
      daemonId,
      page: tablePagination.current,
      pageSize: tablePagination.pageSize,
      folder,
      query: headerSearchQuery.value.trim()
    };
    loading.value = !background && listActive;
    try {
      const { execute } = modListApi();
      const res = await execute({ params, signal: requestController.signal, forceRequest: true });
      if (!isCurrent()) return;
      const result = res.value;
      const newMods = result?.mods || [];
      // Folder discovery is independent of the filtered result count.
      folders.value = result?.folders || [];
      fileStatus.value = result || {};
      totalMods.value = result?.total || 0;
      tablePagination.total = totalMods.value;
      tablePagination.current = result?.page ?? params.page;
      tablePagination.pageSize = result?.pageSize ?? params.pageSize;
      newMods.forEach((mod) => {
        if (mod.hash && extraInfoCache.has(mod.hash)) {
          mod.extraInfo = extraInfoCache.get(mod.hash);
        }
      });
      mods.value = newMods;
      loading.value = false;

      const hashes = [...new Set(newMods.filter((m) => !m.extraInfo && m.hash).map((m) => m.hash))];
      if (hashes.length > 0) {
        loadingExtra.value = true;
        try {
          const { execute: fetchBatchInfo } = getModBatchInfoApi();
          const batchRes = await fetchBatchInfo({
            data: { hashes },
            signal: requestController.signal
          });
          if (!isCurrent()) return;
          mods.value.forEach((mod) => {
            const info = mod.hash && batchRes.value?.[mod.hash];
            if (info) {
              mod.extraInfo = info;
              extraInfoCache.set(mod.hash, info);
              if (extraInfoCache.size > 500) {
                extraInfoCache.delete(extraInfoCache.keys().next().value!);
              }
            }
          });
        } catch (e) {
          if (isCurrent()) console.error("Fetch batch info error:", e);
        } finally {
          if (isCurrent()) loadingExtra.value = false;
        }
      }
    } catch (err: any) {
      if (isCurrent()) message.error(err.message);
    } finally {
      if (isCurrent()) {
        loading.value = false;
        // A recursive timeout prevents overlapping slow polls. Polls share the same query/fence.
        if (fileStatus.value.downloadTasks?.length) {
          pollTimer = setTimeout(() => {
            void loadMods(currentFolder.value, true);
          }, 2000);
        }
      }
    }
  };

  // The table's change event is the sole pagination owner. Pagination callbacks would
  // also fire on size changes and can request the same list twice.
  const handleTableChange = (pagination: { current?: number; pageSize?: number }) => {
    const size = pagination.pageSize ?? tablePagination.pageSize;
    const page = size !== tablePagination.pageSize ? 1 : pagination.current ?? 1;
    if (page === tablePagination.current && size === tablePagination.pageSize) return;
    tablePagination.current = page;
    tablePagination.pageSize = size;
    void loadMods(currentFolder.value);
  };

  watch(
    () => headerSearchQuery.value.trim().toLowerCase(),
    () => {
      tablePagination.current = 1;
      invalidate(); // Fence immediately, including during the debounce window.
      clearResults();
      loading.value = !disposed && listActive;
      if (!disposed && listActive) {
        searchTimer = setTimeout(() => void loadMods(currentFolder.value), 600);
      }
    },
    { flush: "sync" }
  );

  const setListActive = (active: boolean) => {
    listActive = active;
    if (!active) {
      invalidate();
      loading.value = false;
      // Transfers still need status updates while the Download tab is open.
      if (fileStatus.value.downloadTasks?.length) {
        pollTimer = setTimeout(() => void loadMods(currentFolder.value, true), 2000);
      }
    }
  };

  const onToggle = async (record: any) => {
    const toggleData = {
      uuid: instanceId,
      daemonId: daemonId,
      fileName: record.file
    };

    const immediateFn = async () => {
      try {
        const { execute } = toggleModApi();
        await execute({
          data: toggleData
        });
        message.success(t("TXT_CODE_7f0c746d"));
        if (record.enabled) {
          record.file = record.file + ".disabled";
          record.enabled = false;
        } else {
          record.file = record.file.replace(".disabled", "");
          record.enabled = true;
        }
        await loadMods(currentFolder.value);
      } catch (err: any) {
        message.error(err.message);
      }
    };

    checkAndConfirm("toggle", record.file, toggleData, immediateFn);
  };

  const onDelete = async (record: any) => {
    const deleteData = {
      uuid: instanceId,
      daemonId: daemonId,
      fileName: record.file
    };

    const immediateFn = async () => {
      try {
        const { execute } = deleteModApi();
        await execute({
          data: deleteData
        });
        message.success(t("TXT_CODE_7f0c746d"));
        mods.value = mods.value.filter((m) => m.file !== record.file);
        await loadMods(currentFolder.value);
      } catch (err: any) {
        message.error(err.message);
      }
    };

    checkAndConfirm("delete", record.file, deleteData, immediateFn);
  };

  onUnmounted(() => {
    disposed = true;
    invalidate();
    loading.value = false;
  });

  return {
    loading,
    loadingExtra,
    mods,
    folders,
    tablePagination,
    totalMods,
    currentFolder,
    loadMods,
    headerSearchQuery,
    handleTableChange,
    setListActive,
    onToggle,
    onDelete,
    fileStatus
  };
}
