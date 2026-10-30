<script setup lang="ts">
import { ALL_DAEMON_MODE } from "@/config/const";
import { t } from "@/lang/i18n";
import type { LayoutCard } from "@/types/index";
import {
  AppstoreOutlined,
  CloseOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  DownOutlined,
  FormOutlined,
  FrownOutlined,
  InfoCircleOutlined,
  PoweroffOutlined,
  PlayCircleOutlined,
  RedoOutlined,
  SearchOutlined,
  WarningOutlined
} from "@ant-design/icons-vue";
import { computed, h, onMounted, onUnmounted, ref, watch } from "vue";

import BetweenMenus from "@/components/BetweenMenus.vue";
import { router } from "@/config/router";
import { useInstanceTagSearch, useInstanceTagTips } from "@/hooks/useInstanceTag";
import { useScreen } from "@/hooks/useScreen";
import { remoteInstances, remoteInstancesGlobal, remoteNodeList } from "@/services/apis";
import {
  batchDelete,
  batchKill,
  batchRestart,
  batchStart,
  batchStop,
  getInstanceInfo
} from "@/services/apis/instance";
import { reportErrorMsg } from "@/tools/validator";
import type { AntColumnsType } from "@/types/ant";
import { INSTANCE_STATUS } from "@/types/const";
import { Modal, notification } from "ant-design-vue";
import { throttle } from "lodash";
import type { InstanceMoreDetail } from "../hooks/useInstance";
import { useInstanceMoreDetail } from "../hooks/useInstance";
import { computeNodeName } from "../tools/nodes";
import type { NodeStatus } from "../types/index";
import InstanceLine from "./instance/InstanceLine.vue";
import Shortcut from "./instance/Shortcut.vue";
import ServerGroup from "./instance/ServerGroup.vue";
import { groupServers } from "@/tools/serverGroups";
import ServerLayoutSwitch, { type ServerLayout } from "@/components/ServerLayoutSwitch.vue";

defineProps<{
  card: LayoutCard;
}>();

const { isPhone } = useScreen();
const layoutStorageKey = "nexcraft.server-list.layout";
const initialLayout = (): ServerLayout => {
  try {
    const saved = localStorage.getItem(layoutStorageKey);
    if (saved === "compact" || saved === "list" || saved === "overview") return saved;
  } catch {
    /* Keep a usable in-memory choice when storage is unavailable. */
  }
  return "compact";
};
const serverLayout = ref<ServerLayout>(initialLayout());
watch(serverLayout, (layout) => {
  try {
    localStorage.setItem(layoutStorageKey, layout);
  } catch {
    /* Presentation still switches. */
  }
});
const operationForm = ref({
  instanceName: "",
  currentPage: 1,
  pageSize: 20,
  status: "",
  type: ""
});

// Expand the search row only while the name input is hovered/focused (not when
// using the status/type selectors in the same group).
const searchExpanded = ref(false);

const currentRemoteNode = ref<NodeStatus>();
const isGlobalDaemonMode = computed(() => currentRemoteNode.value?.uuid === ALL_DAEMON_MODE);

const { execute: getNodes, state: nodes, isLoading: loadingNodes } = remoteNodeList();
const { state: instances } = remoteInstances();
const loadingInstance = ref(false);
const isGlobalLoading = ref(true);
const { updateTagTips, tagTips } = useInstanceTagTips();
const {
  tags: selectedTags,
  setRefreshFn,
  selectTag,
  removeTag,
  isTagSelected,
  clearTags
} = useInstanceTagSearch();

const isLoading = computed(
  () => loadingNodes.value || loadingInstance.value || isGlobalLoading.value
);

const instancesMoreInfo = computed(() => {
  if (!isPageCurrent()) return [];
  const newInstances: InstanceMoreDetail[] = [];
  for (const instance of instances.value?.data || []) {
    const instanceMoreInfo = useInstanceMoreDetail(instance);
    newInstances.push(instanceMoreInfo);
  }
  return newInstances || [];
});

const initNodes = async () => {
  await getNodes();
  nodes?.value?.sort((a, b) => (a.available === b.available ? 0 : a.available ? -1 : 1));
  if (nodes.value?.length === 0) {
    return reportErrorMsg(t("TXT_CODE_e3d96a26"));
  }
  let storedNode: NodeStatus | undefined;
  try {
    const stored = localStorage.getItem("pageSelectedRemote");
    if (stored) storedNode = JSON.parse(stored);
  } catch {
    /* A corrupt or unavailable browser preference must not prevent loading servers. */
  }
  if (storedNode) {
    currentRemoteNode.value = storedNode;
    currentRemoteNode.value =
      nodes.value?.find((node) => node.uuid === currentRemoteNode.value?.uuid) ||
      currentRemoteNode.value;
    if (isGlobalDaemonMode.value) return;
    if (!nodes.value?.some((item) => item.uuid === currentRemoteNode.value?.uuid)) {
      currentRemoteNode.value = undefined;
    }
  } else {
    currentRemoteNode.value = nodes.value?.[0];
  }
};

const tableTreeData = ref<any[]>([]);
const serverGroups = computed(() =>
  groupServers(instancesMoreInfo.value, (item) => item.config?.packInfo?.source)
);
// Presentation-only groups: loaders, refresh and batch ownership keep the raw tree.
const groupedTableTreeData = computed(() =>
  tableTreeData.value.map((node) => ({
    ...node,
    children: [
      ...groupServers<any>(
        node.children.filter((row: any) => row.inst),
        (row) => row.inst.config?.packInfo?.source
      ).map((group) => ({
        key: node.key + ":group:" + group.kind,
        isServerGroup: true,
        name: t("TXT_CODE_server_groups_" + group.kind),
        count: group.items.length,
        // Ant Table indexes the entire tree by key, including other daemons.
        children: group.items.map((row) => ({
          ...row,
          key: JSON.stringify(["instance", node.key, row.key])
        }))
      })),
      ...node.children.filter((row: any) => row.isLoadMore)
    ]
  }))
);
const collapsedTableRows = ref(new Set<string>());
const expandedTableKeys = computed(() =>
  groupedTableTreeData.value.flatMap((node) =>
    [node, ...node.children]
      .filter((row) => row.children?.length && !collapsedTableRows.value.has(row.key))
      .map((row) => row.key)
  )
);
const setTableExpanded = (expanded: boolean, record: { key: string }) => {
  if (expanded) collapsedTableRows.value.delete(record.key);
  else collapsedTableRows.value.add(record.key);
};
let endpointGeneration = 0;
const pageContext = () =>
  JSON.stringify([currentRemoteNode.value?.uuid, operationForm.value, selectedTags.value]);
const loadedPage = ref<{ daemonId: string; query: string; generation: number }>();
const isPageCurrent = () =>
  mounted &&
  !isGlobalDaemonMode.value &&
  !!loadedPage.value &&
  loadedPage.value.daemonId === currentRemoteNode.value?.uuid &&
  loadedPage.value.query === pageContext() &&
  loadedPage.value.generation === endpointGeneration;

const initInstancesData = async (resetPage?: boolean, daemonId?: string, instanceId?: string) => {
  selectedInstance.value = [];
  loadedPage.value = undefined;
  if (resetPage) operationForm.value.currentPage = 1;
  let generation = ++endpointGeneration;
  let query = pageContext();
  const stillCurrent = () =>
    mounted && generation === endpointGeneration && query === pageContext();
  try {
    if (!currentRemoteNode.value) await initNodes();
    if (!mounted) return;
    generation = ++endpointGeneration;
    query = pageContext();
    const nodeId = currentRemoteNode.value?.uuid ?? "";
    if (!isGlobalDaemonMode.value) {
      loadingInstance.value = true;
      // Each request owns its response ref; an old request cannot overwrite the active page.
      const { execute: getInstances } = remoteInstances();
      const result = await getInstances({
        params: {
          page: operationForm.value.currentPage,
          page_size: operationForm.value.pageSize,
          status: operationForm.value.status,
          instance_name: operationForm.value.instanceName.trim(),
          tag: JSON.stringify(selectedTags.value),
          daemonId: nodeId,
          type: operationForm.value.type
        }
      });
      if (!stillCurrent()) return;
      instances.value = result.value;
      loadedPage.value = { daemonId: nodeId, query, generation };
      updateTagTips(instances.value?.allTags || []);
      return;
    }

    updateTagTips([]);
    isGlobalLoading.value = true;
    if (daemonId && instanceId) {
      const { execute: getInfo, state: info } = getInstanceInfo();
      await getInfo({ params: { uuid: instanceId, daemonId } });
      if (!stillCurrent() || !info.value) return;

      const targetNodeIndex = tableTreeData.value.findIndex((n) => n.key === daemonId);
      if (targetNodeIndex === -1) return;

      const targetChildIndex = tableTreeData.value[targetNodeIndex].children.findIndex(
        (c: any) => c.key === instanceId
      );
      if (targetChildIndex === -1) return;

      const d = useInstanceMoreDetail(info.value);
      tableTreeData.value[targetNodeIndex].children[targetChildIndex].inst = d;
      tableTreeData.value[targetNodeIndex].children[targetChildIndex].name =
        d.config?.nickname || d.instanceUuid;
      return;
    }

    const { execute: getGlobalInstances, state: globalInstances } = remoteInstancesGlobal();
    await getGlobalInstances({
      params: {
        page: 1,
        page_size: 10,
        status: operationForm.value.status,
        instance_name: operationForm.value.instanceName.trim()
      }
    });

    if (!stillCurrent()) return;
    if (globalInstances.value) {
      const newTreeData = [];

      if (!nodes.value) return;
      for (const node of nodes.value) {
        const nodesDataMap = globalInstances.value;
        const item = nodesDataMap[node.uuid];

        let children: any[] = [];
        let nodeMaxPage = 1;
        let nodeCurrentPage = 1;
        if (item) {
          nodeMaxPage = item.maxPage || 1;
          nodeCurrentPage = item.page || 1;
          if (!item.instances) continue;

          children = item.instances.map((inst) => {
            const d = useInstanceMoreDetail(inst);
            return {
              daemonId: node.uuid,
              key: d.instanceUuid,
              name: d.config?.nickname || d.instanceUuid,
              inst: d
            };
          });

          if (nodeCurrentPage < nodeMaxPage) {
            children.push({
              isLoadMore: true,
              daemonId: node.uuid,
              key: `${node.uuid}-load-more`
            });
          }
        }

        newTreeData.push({
          key: node.uuid,
          name: computeNodeName(node.ip, node.available, node.remarks),
          node: node,
          maxPage: nodeMaxPage,
          nodeCurrentPage: nodeCurrentPage,
          children
        });
      }

      tableTreeData.value = newTreeData;
    }
  } catch (err) {
    if (stillCurrent()) return reportErrorMsg(t("TXT_CODE_e109c091"));
  } finally {
    if (stillCurrent()) {
      loadingInstance.value = false;
      isGlobalLoading.value = false;
    }
  }
};

const loadMoreInstances = async (daemonId: string) => {
  ++endpointGeneration;
  const targetNodeIndex = tableTreeData.value.findIndex((n) => n.key === daemonId);
  if (targetNodeIndex === -1) return;
  const nodeData = tableTreeData.value[targetNodeIndex];

  const nextPage = (nodeData.nodeCurrentPage || 1) + 1;
  const { execute: getInstances, state: instances } = remoteInstances();
  await getInstances({
    params: {
      page: nextPage,
      page_size: 10,
      status: operationForm.value.status,
      instance_name: operationForm.value.instanceName.trim(),
      tag: JSON.stringify(selectedTags.value),
      daemonId: daemonId
    }
  });

  if (!instances.value) return;
  const newChildren = instances.value.data.map((inst) => {
    const d = useInstanceMoreDetail(inst);
    return {
      daemonId: daemonId,
      key: d.instanceUuid,
      name: d.config?.nickname || d.instanceUuid,
      inst: d
    };
  });

  nodeData.children = nodeData.children.filter((c: any) => !c.isLoadMore);
  nodeData.children.push(...newChildren);

  nodeData.nodeCurrentPage = nextPage;
  nodeData.maxPage = instances.value.maxPage;

  if (nodeData.nodeCurrentPage < nodeData.maxPage) {
    nodeData.children.push({
      isLoadMore: true,
      daemonId: daemonId,
      key: `${daemonId}-load-more`
    });
  }
};

const handleQueryInstance = throttle(async () => {
  selectedInstance.value = [];
  await initInstancesData();
}, 600);

const toAppDetailPage = (daemonId: string, instanceId: string) => {
  router.push({
    path: `/instances/terminal`,
    query: {
      daemonId,
      instanceId
    }
  });
};

const handleChangeNode = async (item: NodeStatus) => {
  try {
    currentRemoteNode.value = item;
    clearTags();
    selectedInstance.value = [];
    await initInstancesData(true);
    localStorage.setItem("pageSelectedRemote", JSON.stringify(item));
  } catch (err: any) {
    console.error(err.message);
  }
};

const toCreateAppPage = () => {
  router.push({
    path: "/minecraft",
    query: {
      daemonId: currentRemoteNode.value?.uuid
    }
  });
};

const toMarketPage = () => {
  router.push({
    path: "/minecraft",
    query: {
      daemonId: currentRemoteNode.value?.uuid
    }
  });
};

const toNodesPage = () => {
  router.push({
    path: "/node"
  });
};

const multipleMode = ref(false);
const selectedInstance = ref<InstanceMoreDetail[]>([]);
watch(
  pageContext,
  () => {
    ++endpointGeneration;
    loadedPage.value = undefined;
    selectedInstance.value = [];
  },
  { flush: "sync" }
);

const snapshotSelection = () => {
  if (!isPageCurrent() || !loadedPage.value || selectedInstance.value.length === 0) return;
  const visible = new Set(instancesMoreInfo.value.map((item) => item.instanceUuid));
  const uuids = [...new Set(selectedInstance.value.map((item) => item.instanceUuid))];
  if (uuids.some((uuid) => !visible.has(uuid))) return;
  return { owner: loadedPage.value, uuids };
};
const isSnapshotCurrent = (snapshot: NonNullable<ReturnType<typeof snapshotSelection>>) =>
  isPageCurrent() && loadedPage.value === snapshot.owner;

const instanceTableColumns: AntColumnsType[] = [
  { title: t("TXT_CODE_f70badb9"), dataIndex: "name", key: "name", width: 250, align: "left" },
  {
    title: t("TXT_CODE_759fb403"),
    dataIndex: "status",
    key: "status",
    width: 100,
    align: "center"
  },
  {
    title: t("TXT_CODE_67d68dd1"),
    dataIndex: "type",
    key: "type",
    width: 160,
    align: "center"
  },
  {
    title: t("TXT_CODE_e06fdab0"),
    dataIndex: "lastDatetime",
    key: "lastDatetime",
    width: 160,
    align: "center"
  },
  {
    title: t("TXT_CODE_game_endpoint_configured_address"),
    dataIndex: "gameAddress",
    key: "gameAddress",
    width: 230,
    align: "left"
  },
  {
    title: t("TXT_CODE_game_endpoint_installed_versions"),
    dataIndex: "installedVersion",
    key: "installedVersion",
    width: 250,
    align: "left"
  },
  { title: t("TXT_CODE_b283e720"), dataIndex: "resources", key: "resources", align: "left" },
  {
    title: t("TXT_CODE_7e9727bd"),
    dataIndex: "players",
    key: "players",
    width: 100,
    align: "left"
  },
  {
    title: t("TXT_CODE_fe731dfc"),
    dataIndex: "actions",
    key: "actions",
    width: 200,
    align: "right"
  }
];

const findInstance = (item: InstanceMoreDetail) => {
  return selectedInstance.value.find((i) => i.instanceUuid === item.instanceUuid);
};

const selectInstance = (item: InstanceMoreDetail) => {
  if (
    !isPageCurrent() ||
    !instancesMoreInfo.value.some((row) => row.instanceUuid === item.instanceUuid)
  )
    return;
  const index = selectedInstance.value.findIndex((row) => row.instanceUuid === item.instanceUuid);
  if (index !== -1) {
    selectedInstance.value.splice(index, 1);
  } else {
    selectedInstance.value.push(item);
  }
};

const handleSelectInstance = (item: InstanceMoreDetail) => {
  if (!isPageCurrent()) return;
  if (multipleMode.value) {
    selectInstance(item);
  } else {
    toAppDetailPage(currentRemoteNode.value?.uuid || "", item.instanceUuid);
  }
};

const selectAllInstances = () => {
  selectedInstance.value = [];
  if (!isPageCurrent()) return;
  for (const item of instancesMoreInfo.value) {
    if (!findInstance(item)) selectedInstance.value.push(item);
  }
};

const exitMultipleMode = () => {
  multipleMode.value = false;
  selectedInstance.value = [];
};

const instanceOperations = [
  {
    title: t("TXT_CODE_57245e94"),
    icon: PlayCircleOutlined,
    click: () => batchOperation("start")
  },
  {
    title: t("TXT_CODE_b1dedda3"),
    icon: PoweroffOutlined,
    click: () => batchOperation("stop")
  },
  {
    title: t("TXT_CODE_47dcfa5"),
    icon: RedoOutlined,
    click: () => batchOperation("restart")
  },
  {
    title: t("TXT_CODE_7b67813a"),
    icon: CloseOutlined,
    click: () => {
      batchOperation("kill");
    }
  },
  {
    title: t("TXT_CODE_ecbd7449"),
    icon: DeleteOutlined,
    click: () => batchDeleteInstance(false)
  },
  {
    title: t("TXT_CODE_9ef27367"),
    icon: WarningOutlined,
    click: () => batchDeleteInstance(true)
  }
];

const batchOperation = async (actName: "start" | "stop" | "kill" | "restart") => {
  const snapshot = snapshotSelection();
  if (!snapshot) return reportErrorMsg(t("TXT_CODE_a0a77be5"));
  const operationMap = {
    start: async () => exec(batchStart().execute, t("TXT_CODE_2b5fd76e")),
    stop: async () => exec(batchStop().execute, t("TXT_CODE_4822a21")),
    kill: async () => exec(batchKill().execute, t("TXT_CODE_effefaab")),
    restart: async () => exec(batchRestart().execute, t("TXT_CODE_effefaab"))
  };

  const exec = async (fn: Function, msg: string) => {
    try {
      const state = await fn({
        data: snapshot.uuids.map((instanceUuid) => ({
          instanceUuid,
          daemonId: snapshot.owner.daemonId
        }))
      });
      if (state.value && isSnapshotCurrent(snapshot)) {
        notification.success({
          message: msg,
          description: t("TXT_CODE_1514d08f")
        });
        exitMultipleMode();
        await initInstancesData();
      }
    } catch (err: any) {
      console.error(err);
      reportErrorMsg(err.message);
    }
  };

  return operationMap[actName]();
};

const batchDeleteInstance = async (deleteFile: boolean) => {
  const snapshot = snapshotSelection();
  if (!snapshot) return reportErrorMsg(t("TXT_CODE_a0a77be5"));
  const { execute, state } = batchDelete();
  const uuids = snapshot.uuids;
  const paths: string[] = [];
  for (const i of selectedInstance.value) {
    if (i.config?.cwd) {
      paths.push(i.config.cwd);
    }
  }
  const confirmDeleteInstanceModal = Modal.confirm({
    title: t("TXT_CODE_2a3b0c17"),
    icon: h(InfoCircleOutlined),
    content: () =>
      h("div", {}, [
        h("p", {}, deleteFile ? t("TXT_CODE_18d2f8ae") : t("TXT_CODE_ac01315a")),
        paths.length > 1
          ? null
          : h("p", { style: "margin-top: 8px; color: #666;" }, [
              t("TXT_CODE_91d70059"),
              h("br"),
              paths.join()
            ])
      ]),
    okText: t("TXT_CODE_d507abff"),
    async onOk() {
      if (!isSnapshotCurrent(snapshot)) return;
      try {
        await execute({
          params: {
            daemonId: snapshot.owner.daemonId
          },
          data: {
            uuids: uuids,
            deleteFile: deleteFile
          }
        });
        if (state.value && isSnapshotCurrent(snapshot)) {
          confirmDeleteInstanceModal.destroy();
          exitMultipleMode();
          notification.success({
            message: t("TXT_CODE_c3c06801"),
            description: t("TXT_CODE_50075e02")
          });
          await initInstancesData(true);
        }
      } catch (err: any) {
        console.error(err);
        reportErrorMsg(err.message);
      }
    },
    onCancel() {}
  });
};

const globalNode = {
  uuid: ALL_DAEMON_MODE,
  ip: "",
  port: 0,
  available: true,
  remarks: ""
};

// Refresh data without replacing the grid with a loading state or clearing
// selection. Configured endpoints can change while the instance is stopped.
let endpointRefresh: ReturnType<typeof setInterval> | undefined;
let refreshInFlight = false;
let mounted = true;
const refreshVisibleInstances = async () => {
  if (
    document.hidden ||
    refreshInFlight ||
    isLoading.value ||
    multipleMode.value ||
    !currentRemoteNode.value
  )
    return;
  refreshInFlight = true;
  const generation = endpointGeneration;
  const nodeId = currentRemoteNode.value.uuid;
  const query = JSON.stringify([operationForm.value, selectedTags.value]);
  const filters = {
    instance_name: operationForm.value.instanceName.trim(),
    status: operationForm.value.status,
    tag: JSON.stringify(selectedTags.value),
    type: isGlobalDaemonMode.value ? undefined : operationForm.value.type
  };
  const stillCurrent = () =>
    mounted &&
    !document.hidden &&
    endpointGeneration === generation &&
    currentRemoteNode.value?.uuid === nodeId &&
    JSON.stringify([operationForm.value, selectedTags.value]) === query &&
    !multipleMode.value;
  const requestPage = async (daemonId: string, page: number, pageSize: number) => {
    const { execute } = remoteInstances();
    return (
      await execute({
        forceRequest: true,
        timeout: 15000,
        errorAlert: false,
        params: { daemonId, page, page_size: pageSize, ...filters }
      })
    ).value;
  };
  try {
    if (!isGlobalDaemonMode.value) {
      const updated = await requestPage(
        nodeId,
        operationForm.value.currentPage,
        operationForm.value.pageSize
      );
      if (stillCurrent() && updated) instances.value = updated;
    } else {
      const rows = tableTreeData.value.map((row) => ({
        row,
        pages: row.nodeCurrentPage || 1,
        failed: false,
        results: [] as Awaited<ReturnType<typeof requestPage>>[]
      }));
      const jobs = rows.flatMap((item) =>
        Array.from({ length: item.pages }, (_, index) => async () => {
          try {
            item.results[index] = await requestPage(item.row.key, index + 1, 10);
          } catch {
            item.failed = true;
          }
        })
      );
      // One shared queue limits total node/page requests to four.
      let nextJob = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, jobs.length) }, async () => {
          while (stillCurrent()) {
            const job = jobs[nextJob++];
            if (!job) return;
            await job();
          }
        })
      );
      for (const item of rows) {
        if (
          !stillCurrent() ||
          item.failed ||
          item.row.nodeCurrentPage !== item.pages ||
          item.results.length !== item.pages ||
          item.results.some((result) => !result)
        )
          continue;
        // Page one describes the latest total. Keep every still-loaded page,
        // discard pages removed by deletions, and rebuild the load-more row.
        const maxPage = Math.max(1, item.results[0]?.maxPage ?? item.pages);
        const currentPage = Math.min(item.pages, maxPage);
        const seen = new Set<string>();
        const children = item.results.slice(0, currentPage).flatMap((result) =>
          (result?.data || []).flatMap((inst) => {
            if (seen.has(inst.instanceUuid)) return [];
            seen.add(inst.instanceUuid);
            const info = useInstanceMoreDetail(inst);
            return [
              {
                daemonId: item.row.key,
                key: info.instanceUuid,
                name: info.config.nickname || info.instanceUuid,
                inst: info
              }
            ];
          })
        );
        item.row.maxPage = maxPage;
        item.row.nodeCurrentPage = currentPage;
        item.row.children = [
          ...children,
          ...(currentPage < maxPage
            ? [
                {
                  isLoadMore: true,
                  daemonId: item.row.key,
                  key: `${item.row.key}-load-more`
                }
              ]
            : [])
        ];
      }
    }
  } catch {
    /* Retain the last successful snapshot; normal refresh controls report errors. */
  } finally {
    refreshInFlight = false;
  }
};
onMounted(async () => {
  await initInstancesData();
  setRefreshFn(initInstancesData);
  if (mounted) endpointRefresh = setInterval(refreshVisibleInstances, 3000);
});
onUnmounted(() => {
  mounted = false;
  if (endpointRefresh) clearInterval(endpointRefresh);
});
</script>

<template>
  <div style="min-height: 100%" class="container">
    <a-row :gutter="[24, 24]" style="min-height: 100%">
      <a-col :span="24">
        <BetweenMenus>
          <template v-if="!isPhone" #left>
            <a-typography-title class="mb-0" :level="4">
              <AppstoreOutlined />
              {{ card.title }}
            </a-typography-title>
          </template>
          <template #right>
            <a-dropdown>
              <template #overlay>
                <a-menu>
                  <a-menu-item :key="ALL_DAEMON_MODE" @click="handleChangeNode(globalNode)">
                    <AppstoreOutlined />
                    {{ t("TXT_CODE_a60a421a") }}
                  </a-menu-item>
                  <a-menu-divider />
                  <a-menu-item
                    v-for="item in nodes"
                    :key="item.uuid"
                    :disabled="!item.available"
                    @click="handleChangeNode(item)"
                  >
                    <DatabaseOutlined v-if="item.available" />
                    <FrownOutlined v-else />
                    {{ computeNodeName(item.ip, item.available, item.remarks) }}
                  </a-menu-item>
                  <a-menu-divider />
                  <a-menu-item key="toNodesPage" @click="toNodesPage()">
                    <FormOutlined />
                    {{ t("TXT_CODE_28e53fed") }}
                  </a-menu-item>
                </a-menu>
              </template>
              <a-button style="max-width: 200px; min-width: 180px; overflow: hidden">
                <a-typography-text
                  style="max-width: 145px"
                  :ellipsis="{ ellipsis: true }"
                  :content="
                    isGlobalDaemonMode
                      ? t('TXT_CODE_a60a421a')
                      : computeNodeName(
                          currentRemoteNode?.ip || '',
                          currentRemoteNode?.available || true,
                          currentRemoteNode?.remarks
                        )
                  "
                />
                <DownOutlined />
              </a-button>
            </a-dropdown>
            <a-button
              type="primary"
              :disabled="!currentRemoteNode?.available"
              @click="toCreateAppPage"
            >
              {{ t("TXT_CODE_53408064") }}
            </a-button>
          </template>
          <template #center>
            <div class="search-input" :class="{ 'search-expanded': searchExpanded }">
              <a-input-group compact>
                <a-select
                  v-model:value="operationForm.status"
                  style="width: 90px"
                  @change="handleQueryInstance"
                >
                  <a-select-option value="">
                    {{ t("TXT_CODE_c48f6f64") }}
                  </a-select-option>
                  <a-select-option v-for="(p, i) in INSTANCE_STATUS" :key="i" :value="i">
                    {{ p }}
                  </a-select-option>
                </a-select>
                <a-select
                  v-if="!isGlobalDaemonMode"
                  v-model:value="operationForm.type"
                  style="width: 110px"
                  @change="handleQueryInstance"
                >
                  <a-select-option value="">{{ t("TXT_CODE_filter_all_types") }}</a-select-option>
                  <a-select-option value="java">{{ t("TXT_CODE_edition_java") }}</a-select-option>
                  <a-select-option value="bedrock">{{
                    t("TXT_CODE_edition_bedrock")
                  }}</a-select-option>
                </a-select>
                <a-input
                  v-model:value.trim="operationForm.instanceName"
                  :placeholder="t('TXT_CODE_ce132192')"
                  :style="{
                    width: isGlobalDaemonMode ? 'calc(100% - 90px)' : 'calc(100% - 200px)'
                  }"
                  @press-enter="handleQueryInstance"
                  @change="handleQueryInstance"
                  @mouseenter="searchExpanded = true"
                  @mouseleave="searchExpanded = false"
                  @focus="searchExpanded = true"
                  @blur="searchExpanded = false"
                >
                  <template #suffix>
                    <search-outlined />
                  </template>
                </a-input>
              </a-input-group>
            </div>
          </template>
        </BetweenMenus>
      </a-col>
      <a-col :span="24">
        <BetweenMenus class="server-list-toolbar">
          <template v-if="instances || isGlobalDaemonMode" #left>
            <div v-if="multipleMode && !isGlobalDaemonMode">
              <a-button class="mr-10" @click="exitMultipleMode">
                {{ t("TXT_CODE_5366af54") }}
              </a-button>

              <a-button
                v-if="instancesMoreInfo.length === selectedInstance.length"
                class="mr-10"
                @click="selectedInstance = []"
              >
                {{ t("TXT_CODE_df87c46d") }}
              </a-button>
              <a-button
                v-else
                class="mr-10"
                :disabled="!isPageCurrent()"
                @click="selectAllInstances"
              >
                {{ t("TXT_CODE_f466d7a") }}
              </a-button>
              <a-dropdown>
                <template #overlay>
                  <a-menu>
                    <a-menu-item
                      v-for="item in instanceOperations"
                      :key="item.title"
                      @click="item.click"
                    >
                      <component :is="item.icon" />
                      {{ item.title }}
                    </a-menu-item>
                  </a-menu>
                </template>
                <a-button type="primary" :disabled="!isPageCurrent()">
                  {{ t("TXT_CODE_8fd8bfd3") }}
                  <DownOutlined />
                </a-button>
              </a-dropdown>
            </div>
            <div v-else>
              <a-button v-if="!isGlobalDaemonMode" @click="multipleMode = true">
                {{ t("TXT_CODE_5cb656b9") }}
              </a-button>
              <a-button class="ml-10" @click="handleQueryInstance">
                {{ t("TXT_CODE_b76d94e0") }}
              </a-button>
            </div>
          </template>
          <template v-if="!isGlobalDaemonMode" #center>
            <a-typography-text v-if="multipleMode">
              {{ t("TXT_CODE_432cbc38") }}{{ selectedInstance?.length || 0 }}
              {{ t("TXT_CODE_5cd3b4bd") }}
            </a-typography-text>
            <ServerLayoutSwitch v-model="serverLayout" />
          </template>
          <template v-if="instances && !isGlobalDaemonMode" #right>
            <a-pagination
              v-model:current="operationForm.currentPage"
              v-model:pageSize="operationForm.pageSize"
              :total="(instances?.maxPage || 0) * operationForm.pageSize"
              show-size-changer
              @change="initInstancesData()"
            />
          </template>
        </BetweenMenus>
      </a-col>
      <a-col :span="24">
        <div v-if="tagTips && tagTips?.length > 0" class="instances-tag-container">
          <a-tag
            v-if="selectedTags.length > 0"
            color="red"
            class="group-name-tag"
            @click="clearTags"
          >
            {{ t("TXT_CODE_7333c7f7") }}
          </a-tag>
          <a-tag
            v-for="item in tagTips"
            :key="item"
            class="group-name-tag"
            :class="{ 'group-name-tag-active': isTagSelected(item) }"
            @click="isTagSelected(item) ? removeTag(item) : selectTag(item)"
          >
            {{ item }}
          </a-tag>
        </div>
      </a-col>
      <a-col v-if="isLoading" :span="24">
        <Loading></Loading>
      </a-col>

      <a-col v-else-if="!isGlobalDaemonMode && instancesMoreInfo?.length > 0" :span="24">
        <ServerGroup
          v-for="group in serverGroups"
          :key="group.kind"
          :kind="group.kind"
          :count="group.items.length"
          :force-open="multipleMode"
        >
          <div class="server-layout-grid" :class="'servers-' + serverLayout">
            <Shortcut
              v-for="item in group.items"
              :key="JSON.stringify([currentRemoteNode?.uuid, item.instanceUuid])"
              class="instance-card"
              :class="{ selected: multipleMode && findInstance(item) }"
              :layout="serverLayout"
              :disabled="multipleMode"
              :card="card"
              :target-instance-info="item"
              :target-daemon-id="currentRemoteNode?.uuid"
              :target-node="currentRemoteNode"
              @click="handleSelectInstance(item)"
              @refresh-list="initInstancesData()"
            />
          </div>
        </ServerGroup>
      </a-col>

      <a-col v-else-if="isGlobalDaemonMode" :span="24">
        <fade-up-animation>
          <a-table
            :data-source="groupedTableTreeData"
            :columns="instanceTableColumns"
            :pagination="false"
            size="small"
            row-key="key"
            :expanded-row-keys="expandedTableKeys"
            @expand="setTableExpanded"
            :scroll="{ x: 'max-content' }"
          >
            <template #expandIcon="{ expanded, record, onExpand }">
              <button
                v-if="record.children?.length"
                type="button"
                class="server-tree-toggle"
                :aria-expanded="expanded"
                :aria-label="record.name"
                @click="onExpand(record, $event)"
              >
                <span aria-hidden="true">{{ expanded ? "⌄" : "›" }}</span>
              </button>
            </template>
            <template #headerCell="{ column }">
              <div v-if="column.key === 'name'" style="margin-left: 25px">
                {{ column.title }}
              </div>
              <div v-else-if="column.key === 'actions'" style="padding-right: 10px">
                {{ column.title }}
              </div>
              <div v-else>
                {{ column.title }}
              </div>
            </template>

            <template #bodyCell="{ column, record }">
              <template v-if="record.isLoadMore">
                <button
                  v-if="column.key === 'name'"
                  type="button"
                  class="server-load-more"
                  @click="loadMoreInstances(record.daemonId)"
                >
                  {{ t("TXT_CODE_101ef36f") }}
                </button>
              </template>
              <template v-else-if="record.isServerGroup">
                <span v-if="column.key === 'name'" class="server-table-group">
                  {{ record.name }}
                  <span class="server-table-count"
                    >{{ record.count }} {{ t("TXT_CODE_server_groups_on_page") }}</span
                  >
                </span>
              </template>
              <template v-else-if="record.node">
                <span v-if="column.key === 'name'">
                  <DatabaseOutlined v-if="record.node.available" class="mr-8" />
                  <FrownOutlined v-else class="mr-8" />
                  <strong>{{ record.name }}</strong>
                </span>
              </template>
              <InstanceLine
                v-else-if="record.inst"
                :column="column"
                :record="record"
                :target-instance-info="record.inst"
                :target-daemon-id="record.daemonId"
                :target-node="nodes?.find((node) => node.uuid === record.daemonId)"
                @refresh-list="
                  (daemonId: string, instanceId: string) =>
                    initInstancesData(false, daemonId, instanceId)
                "
              ></InstanceLine>
            </template>
          </a-table>
        </fade-up-animation>
      </a-col>

      <a-col
        v-else-if="instancesMoreInfo?.length === 0"
        :span="24"
        class="flex align-center justify-center h-100 w-100 flex-col"
        style="position: relative"
      >
        <div>
          <Empty :description="t('TXT_CODE_5415f009')" />
        </div>
        <div class="mt-20">
          <a-button type="primary" @click="toMarketPage">
            {{ t("TXT_CODE_871cb8bc") }}
          </a-button>
        </div>
      </a-col>
    </a-row>
  </div>
</template>

<style lang="scss" scoped>
.server-list-toolbar :deep(.menus-item-center) {
  flex: 0 0 auto;
  width: auto;
}
.server-list-toolbar :deep(.menus-item-left) {
  flex: 0 1 auto;
}
.server-list-toolbar :deep(.menus-item-left > div) {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.server-list-toolbar :deep(.menus-item-right) {
  margin-left: auto;
}
.server-layout-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  align-items: stretch;
}
.server-layout-grid.servers-list {
  grid-template-columns: minmax(0, 1fr);
}
.server-layout-grid .instance-card {
  cursor: pointer;
}
@media (max-width: 1100px) {
  .server-layout-grid:not(.servers-list) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 680px) {
  .server-list-toolbar :deep(.menus-item-left) {
    flex-basis: 100%;
  }
  .server-list-toolbar :deep(.menus-item-center) {
    width: auto !important;
  }
  .server-list-toolbar :deep(.menus-item-right) {
    justify-content: flex-end !important;
    min-width: 0;
  }
  .server-list-toolbar :deep(.ant-pagination) {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 4px;
  }
  .server-layout-grid:not(.servers-list) {
    grid-template-columns: minmax(0, 1fr);
  }
}
.server-tree-toggle,
.server-load-more {
  border: 0;
  background: transparent;
  color: var(--text-color);
  font: inherit;
  cursor: pointer;
}
.server-tree-toggle {
  width: 24px;
  height: 28px;
  margin-right: 4px;
}
.server-load-more {
  color: var(--color-blue-6);
  padding: 4px 8px;
}
.server-tree-toggle:focus-visible,
.server-load-more:focus-visible {
  outline: 2px solid var(--color-blue-6);
  outline-offset: 2px;
}
.server-table-group {
  font-weight: 600;
}
.server-table-count {
  margin-left: 8px;
  font-size: 12px;
  font-weight: 400;
  opacity: 0.7;
}

.search-input {
  transition: all 0.6s;
  text-align: center;
  width: 80%;
}

@media (max-width: 992px) {
  .search-input {
    transition: all 0.4s;
    text-align: center;
    width: 100% !important;
  }
}

/* Expand only when the user actually interacts with the search-by-name input
   (hover/focus drives `searchExpanded`) — NOT when using the status / type
   selectors in the same group, which shouldn't shift the bar. */
.search-input.search-expanded {
  width: 100%;
}

.instances-tag-container {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  margin-right: -4px;
  margin-left: -4px;
  max-height: 114px;
  overflow-y: auto;

  .group-name-tag {
    background-color: var(--color-gray-4);
    margin: 4px;
    padding: 4px 8px;
    cursor: pointer;
    transition: all 0.3s;
    &:hover {
      border-color: var(--color-gray-8);
    }
  }

  .group-name-tag-active {
    background-color: var(--color-green-1) !important;
    border-color: var(--color-green-3);
    color: var(--color-green-7);
  }
}
</style>
