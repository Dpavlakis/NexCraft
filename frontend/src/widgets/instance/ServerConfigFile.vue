<script setup lang="ts">
import { inject, ref, onMounted, onBeforeUnmount, watch } from "vue";
import { RollbackOutlined } from "@ant-design/icons-vue";
import { t } from "@/lang/i18n";
import type { LayoutCard } from "@/types";
import { useScreen } from "@/hooks/useScreen";
import { getConfigFile, updateConfigFile } from "@/services/apis/instance";
import { message } from "ant-design-vue";
import { useLayoutCardTools } from "@/hooks/useCardTools";
import { useAppRouters } from "@/hooks/useAppRouters";
import { toUnicode } from "@/tools/common";
import Loading from "@/components/Loading.vue";
import configComponent from "@/components/InstanceConfigEditor.vue";
import FileEditor from "./dialogs/FileEditor.vue";
import { useKeyboardEvents } from "@/hooks/useKeyboardEvents";
import { reportErrorMsg } from "@/tools/validator";
import { confirmServerPropertiesSave } from "@/tools/confirmServerPropertiesSave";

const props = defineProps<{
  card: LayoutCard;
}>();

const { isPhone } = useScreen();
const embeddedInManageModal = inject<boolean>("embeddedInManageModal", false);
const { getMetaOrRouteValue } = useLayoutCardTools(props.card);
const instanceId = getMetaOrRouteValue("instanceId");
const daemonId = getMetaOrRouteValue("daemonId");
const configName = getMetaOrRouteValue("configName");
const configPath = getMetaOrRouteValue("configPath");
const extName = getMetaOrRouteValue("extName");
const type = getMetaOrRouteValue("type");
const isFailure = ref(false);
const hasLoadedConfig = ref(false);
const loadError = ref("");
const expectsPropertiesObject =
  configPath === "server.properties" ||
  [
    "properties",
    "properties_not_unicode",
    "properties_lossless",
    "properties_not_unicode_lossless"
  ].includes(extName ?? "");
const isValidRead = (value: unknown) =>
  value !== undefined &&
  (!expectsPropertiesObject || Object.prototype.toString.call(value) === "[object Object]");
const savedConfig = ref("");
const saving = ref(false);
let active = true;
const editorCard = props.card;
const saveTarget = () => ({
  instanceId: getMetaOrRouteValue("instanceId", false) ?? "",
  daemonId: getMetaOrRouteValue("daemonId", false) ?? "",
  configPath: getMetaOrRouteValue("configPath", false) ?? "",
  extName: getMetaOrRouteValue("extName", false) ?? ""
});
const loadedTarget = saveTarget();
let generation = 0;
const loadedGeneration = generation;
watch(
  () => [props.card, JSON.stringify(saveTarget())],
  () => {
    generation++;
  },
  { flush: "sync" }
);
const isCurrentTarget = (target: ReturnType<typeof saveTarget>) =>
  active &&
  generation === loadedGeneration &&
  props.card === editorCard &&
  JSON.stringify(target) === JSON.stringify(loadedTarget) &&
  JSON.stringify(target) === JSON.stringify(saveTarget());
onBeforeUnmount(() => {
  active = false;
});
const { toPage } = useAppRouters();
const toConfigOverview = () => {
  if (!isCurrentTarget(loadedTarget) || embeddedInManageModal) return;
  toPage({
    path: "/instances/terminal",
    query: {
      instanceId,
      daemonId,
      type
    }
  });
};

const {
  execute: reqConfigFile,
  state: configFile,
  isLoading: getConfigFileLoading,
  isReady
} = getConfigFile();
const render = async () => {
  const target = loadedTarget;
  if (!isCurrentTarget(target)) return false;
  hasLoadedConfig.value = false;
  loadError.value = "";
  try {
    const response = await reqConfigFile({
      params: {
        uuid: instanceId ?? "",
        daemonId: daemonId ?? "",
        fileName: configPath ?? "",
        type: extName ?? ""
      }
    });
    if (!isCurrentTarget(target)) return false;
    if (!isValidRead(response?.value)) {
      isFailure.value = true;
      loadError.value = t("TXT_CODE_quick_error_format");
      return false;
    }
    isFailure.value = false;
    hasLoadedConfig.value = true;
    savedConfig.value = JSON.stringify(configFile.value);
    return true;
  } catch (err: any) {
    if (!isCurrentTarget(target)) return false;
    console.error(err);
    isFailure.value = true;
    return reportErrorMsg(err.message);
  }
};

const {
  execute: execUpdateConfigFile,
  state: isOK,
  isLoading: updateConfigFileLoading
} = updateConfigFile();
const save = async () => {
  if (
    !isCurrentTarget(loadedTarget) ||
    saving.value ||
    !isReady.value ||
    !hasLoadedConfig.value ||
    getConfigFileLoading.value ||
    isFailure.value ||
    !isValidRead(configFile.value)
  )
    return;
  saving.value = true;
  const target = saveTarget();
  const snapshot = JSON.stringify(configFile.value);
  const config_ = JSON.parse(snapshot);
  try {
    if (!(await confirmServerPropertiesSave(target.configPath, snapshot !== savedConfig.value)))
      return;
    if (!isCurrentTarget(target)) return;
    if (
      target.configPath == "server.properties" &&
      target.extName === "properties" &&
      type?.startsWith("minecraft/java")
    ) {
      for (const key in config_) {
        if (typeof config_[key] === "string") config_[key] = toUnicode(config_[key]);
      }
    }
    await execUpdateConfigFile({
      params: {
        uuid: target.instanceId,
        daemonId: target.daemonId,
        fileName: target.configPath,
        type: target.extName
      },
      data: config_
    });
    if (!isCurrentTarget(target)) return;
    if (isOK.value) {
      savedConfig.value = snapshot;
      message.success(t("TXT_CODE_a7907771"));
    }
  } catch (err: any) {
    if (!isCurrentTarget(target)) return;
    console.error(err);
    return reportErrorMsg(err.message);
  } finally {
    saving.value = false;
  }
};

const { removeKeydownListener, startKeydownListener } = useKeyboardEvents(
  { ctrl: true, alt: false, caseSensitive: false, key: "s" },
  save
);

const FileEditorDialog = ref<InstanceType<typeof FileEditor>>();
const toEditRawFile = async () => {
  if (!isCurrentTarget(loadedTarget) || saving.value) return;
  try {
    removeKeydownListener();
    await FileEditorDialog.value?.openDialog(configPath ?? "", configName ?? "");
  } finally {
    if (!isCurrentTarget(loadedTarget)) return;
    startKeydownListener();
    await render();
  }
};

const refresh = async () => {
  if (await render()) message.success(t("TXT_CODE_7863f28d"));
};

onMounted(async () => {
  await render();
});
</script>

<template>
  <div style="height: 100%" class="container">
    <a-row :gutter="[24, 24]" style="height: 100%">
      <a-col :span="24">
        <BetweenMenus>
          <template v-if="!isPhone && !embeddedInManageModal" #left>
            <a-typography-title :level="4" class="mb-0">
              {{
                configPath === "server.properties"
                  ? t("TXT_CODE_info_server_properties")
                  : card.title
              }}
            </a-typography-title>
          </template>
          <template #right>
            <a-button v-if="!embeddedInManageModal" @click="toConfigOverview">
              <template #icon><RollbackOutlined /></template>
              {{ t("TXT_CODE_backup_to_console") }}
            </a-button>
            <a-button
              type="primary"
              :disabled="isFailure || !hasLoadedConfig || !isReady || getConfigFileLoading"
              :loading="saving || updateConfigFileLoading"
              @click="save"
            >
              {{ t("TXT_CODE_abfe9512") }}
            </a-button>
            <a-button :disabled="saving" :loading="getConfigFileLoading" @click="refresh()">
              {{ t("TXT_CODE_b76d94e0") }}
            </a-button>
            <a-button type="dashed" :disabled="saving" @click="toEditRawFile">
              {{ t("TXT_CODE_1f61e5a3") }}
            </a-button>
          </template>
        </BetweenMenus>
      </a-col>

      <configComponent
        v-if="configName && isReady && !isFailure && isValidRead(configFile)"
        :config="configFile"
        :config-name="configName"
      />

      <a-col v-else :span="24">
        <Loading v-if="!isFailure" />
      </a-col>
      <a-col v-if="isFailure" :span="24">
        <a-result
          status="error"
          :title="t('TXT_CODE_f859eac')"
          :sub-title="loadError || t('TXT_CODE_b8814f15')"
        >
          <template v-if="!embeddedInManageModal" #extra>
            <a-button type="primary" @click="toConfigOverview">
              {{ t("TXT_CODE_537cd5ad") }}
            </a-button>
          </template>
        </a-result>
      </a-col>
    </a-row>
  </div>

  <FileEditor
    v-if="daemonId && instanceId"
    ref="FileEditorDialog"
    :daemon-id="daemonId"
    :instance-id="instanceId"
  />
</template>

<style lang="scss" scoped></style>
