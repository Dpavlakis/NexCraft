<script setup lang="ts">
import CardPanel from "@/components/CardPanel.vue";
import { useAppRouters } from "@/hooks/useAppRouters";
import { getInstanceConfigByType, type InstanceConfigs } from "@/hooks/useInstance";
import { useScreen } from "@/hooks/useScreen";
import { t } from "@/lang/i18n";
import { getConfigFileList, getInstanceInfo } from "@/services/apis/instance";
import { reportErrorMsg } from "@/tools/validator";
import type { LayoutCard } from "@/types";
import { FileExclamationOutlined, RollbackOutlined } from "@ant-design/icons-vue";
import { computed, inject, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import ServerConfigFile from "./ServerConfigFile.vue";

const props = defineProps<{ card: LayoutCard }>();
const embeddedInManageModal = inject<boolean>("embeddedInManageModal", false);
const { isPhone } = useScreen();
const route = useRoute();
const { toPage } = useAppRouters();
const requestedContext = computed(() => {
  const value = (key: string) => String(props.card.meta[key] ?? route.query[key] ?? "");
  return { instanceId: value("instanceId"), daemonId: value("daemonId"), type: value("type") };
});
const resolvedType = ref("");
const context = computed(() => ({
  ...requestedContext.value,
  type: requestedContext.value.type || resolvedType.value
}));
const contextKey = computed(() => JSON.stringify(requestedContext.value));
const configDefinitions = computed<InstanceConfigs[]>(() =>
  getInstanceConfigByType(context.value.type)
);
const serverProperties = computed(() =>
  configDefinitions.value.find((file) => file.path === "server.properties")
);
const editing = ref<InstanceConfigs | null>(null);
const selected = computed(() => serverProperties.value || editing.value);
const editCard = computed(
  () =>
    ({
      ...props.card,
      id: "server-config-file",
      title: serverProperties.value
        ? t("TXT_CODE_info_server_properties")
        : selected.value?.fileName || props.card.title,
      meta: {
        ...context.value,
        configName: selected.value?.redirect,
        configPath: selected.value?.path,
        extName: selected.value?.type
      }
    }) as LayoutCard
);
const editorKey = computed(() =>
  JSON.stringify([context.value, selected.value?.redirect, selected.value?.path])
);
const toConsole = () =>
  toPage({
    path: "/instances/terminal",
    query: { ...context.value }
  });

const files = ref<InstanceConfigs[]>([]);
const isLoading = ref(false);
let active = true;
let generation = 0;
const { execute } = getConfigFileList();
const { execute: requestInstanceInfo } = getInstanceInfo();
onBeforeUnmount(() => {
  active = false;
  generation++;
});
const render = async () => {
  if (serverProperties.value) return;
  const owner = ++generation;
  const target = { ...requestedContext.value };
  if (!target.instanceId || !target.daemonId) return;
  const key = contextKey.value;
  const current = () => active && owner === generation && key === contextKey.value;
  isLoading.value = true;
  try {
    // Full-page cards may carry only IDs. Resolve the edition before choosing a parser.
    if (!context.value.type) {
      const instance = await requestInstanceInfo({
        params: { uuid: target.instanceId, daemonId: target.daemonId }
      });
      if (!current()) return;
      resolvedType.value = instance.value?.config.type || "";
      if (!resolvedType.value) {
        reportErrorMsg(t("TXT_CODE_83e553fc"));
        return;
      }
    }
    if (serverProperties.value) return;
    const definitions = configDefinitions.value.map((file) => ({ ...file }));
    const response = await execute({
      params: { uuid: target.instanceId, daemonId: target.daemonId },
      data: { files: definitions.map((file) => file.path) }
    });
    if (!current()) return;
    if (!response.value) {
      reportErrorMsg(t("TXT_CODE_83e553fc"));
      return;
    }
    files.value = definitions.filter(
      (file) => response.value?.some((row) => row.file === file.path)
    );
  } catch (err: any) {
    if (current()) reportErrorMsg(err.message);
  } finally {
    if (current()) isLoading.value = false;
  }
};
watch(
  contextKey,
  () => {
    generation++;
    resolvedType.value = "";
    isLoading.value = false;
    editing.value = null;
    files.value = [];
    if (!serverProperties.value) void render();
  },
  { immediate: true, flush: "sync" }
);
const toEdit = (file: InstanceConfigs) => {
  if (embeddedInManageModal) {
    editing.value = file;
    return;
  }
  toPage({
    path: "/instances/terminal/serverConfig/fileEdit",
    query: {
      ...context.value,
      configName: file.redirect,
      configPath: file.path,
      extName: file.type
    }
  });
};
</script>

<template>
  <ServerConfigFile v-if="selected" :key="editorKey" :card="editCard" />
  <div v-else class="container">
    <BetweenMenus>
      <template v-if="!isPhone && !embeddedInManageModal" #left>
        <a-typography-title class="mb-0" :level="4">{{ card.title }}</a-typography-title>
      </template>
      <template #right>
        <a-button v-if="!embeddedInManageModal" @click="toConsole">
          <template #icon><RollbackOutlined /></template>{{ t("TXT_CODE_backup_to_console") }}
        </a-button>
        <a-button :loading="isLoading" @click="render">{{ t("TXT_CODE_b76d94e0") }}</a-button>
      </template>
    </BetweenMenus>
    <CardPanel class="mt-24">
      <template #body>
        <a-list
          v-if="files.length"
          item-layout="horizontal"
          :data-source="files"
          :loading="isLoading"
        >
          <template #renderItem="{ item }">
            <a-list-item>
              <button type="button" class="config-file-row" @click="toEdit(item)">
                <span class="config-file-copy">
                  <span class="config-file-title">{{ item.fileName }}</span>
                  <span class="config-file-description">{{ item.info }}</span>
                </span>
                <span class="config-file-edit">{{ t("TXT_CODE_ad207008") }}</span>
              </button>
            </a-list-item>
          </template>
        </a-list>
        <a-empty v-else class="mt-40 mb-40">
          <template #description>
            <p><FileExclamationOutlined class="mr-4" />{{ t("TXT_CODE_37a4c14a") }}</p>
            <p>{{ t("TXT_CODE_4c0fda9") }}</p>
          </template>
        </a-empty>
      </template>
    </CardPanel>
  </div>
</template>

<style lang="scss" scoped>
.config-file-row {
  display: flex;
  align-items: center;
  gap: 20px;
  width: 100%;
  padding: 14px 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
  &:hover {
    background: var(--color-gray-3);
  }
  &:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }
}
.config-file-copy {
  flex: 1;
  min-width: 0;
}
.config-file-title {
  display: block;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.config-file-description {
  display: block;
  margin-top: 6px;
  line-height: 1.6;
  color: var(--color-gray-8);
  word-break: normal;
  overflow-wrap: break-word;
}
.config-file-edit {
  flex-shrink: 0;
  color: var(--color-primary);
}
</style>
