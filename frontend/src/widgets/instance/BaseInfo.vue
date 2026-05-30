<script setup lang="ts">
import { getFileConfigAddr } from "@/hooks/useFileManager";
import { useInstanceInfo } from "@/hooks/useInstance";
import { t } from "@/lang/i18n";
import { downloadAddress } from "@/services/apis/fileManager";
import { parseForwardAddress } from "@/tools/protocol";
import { loaderIconFor } from "@/tools/loaderIcon";
import type { LayoutCard } from "@/types";
import { CheckCircleOutlined, ExclamationCircleOutlined } from "@ant-design/icons-vue";
import { computed, onMounted, ref } from "vue";
import { GLOBAL_INSTANCE_NAME } from "../../config/const";
import { useLayoutCardTools } from "../../hooks/useCardTools";
import { parseTimestamp } from "../../tools/time";
import DockerInfo from "./dialogs/DockerInfo.vue";

const props = defineProps<{
  card: LayoutCard;
}>();

const DockerInfoDialog = ref<InstanceType<typeof DockerInfo>>();
const { getMetaOrRouteValue } = useLayoutCardTools(props.card);

const instanceId = getMetaOrRouteValue("instanceId");
const daemonId = getMetaOrRouteValue("daemonId");

const { statusText, isRunning, isStopped, instanceTypeText, instanceInfo, execute } =
  useInstanceInfo({
    instanceId,
    daemonId,
    autoRefresh: true
  });

const getInstanceName = computed(() => {
  if (instanceInfo.value?.config.nickname === GLOBAL_INSTANCE_NAME) {
    return t("TXT_CODE_5bdaf23d");
  } else {
    return instanceInfo.value?.config.nickname;
  }
});

const instanceGameServerInfo = computed(() => {
  if (instanceInfo.value?.info?.mcPingOnline) {
    return {
      players: `${instanceInfo.value?.info.currentPlayers} / ${instanceInfo.value?.info.maxPlayers}`,
      version: instanceInfo.value?.info.version
    };
  } else {
    return null;
  }
});

const serverIconUrl = ref("");
// Fall back to the loader/server-software logo when there's no server-icon.png.
const displayIcon = computed(
  () => serverIconUrl.value || loaderIconFor(instanceInfo.value?.config?.packInfo)
);
const loadServerIcon = async () => {
  if (!instanceId || !daemonId) return;
  const type = instanceInfo.value?.config?.type || "";
  if (!type.includes("minecraft")) return;
  try {
    const { execute: getAddr } = downloadAddress();
    const res = await getAddr({
      params: { file_name: "server-icon.png", daemonId: String(daemonId), uuid: String(instanceId) }
    });
    if (!res.value) return;
    const addr = parseForwardAddress(getFileConfigAddr(res.value), "http");
    serverIconUrl.value = `${addr}/download/${res.value.password}/server-icon.png`;
  } catch (e) {
    // no icon / unreachable -> show nothing
  }
};

onMounted(async () => {
  if (instanceId && daemonId) {
    await execute({
      params: {
        uuid: instanceId,
        daemonId: daemonId
      }
    });
    loadServerIcon();
  }
});
</script>

<template>
  <!-- eslint-disable vue/html-indent -->
  <CardPanel class="containerWrapper" style="height: 100%">
    <template #title>
      {{ card.title }}
    </template>
    <template #operator>
      <img
        v-if="displayIcon"
        :src="displayIcon"
        class="server-icon"
        alt=""
        @error="serverIconUrl = ''"
      />
    </template>
    <template #body>
      <a-typography-paragraph>
        {{ t("TXT_CODE_7ec9c59c") }}
        <span class="mr-10">{{ getInstanceName }}</span>
        <a-tag v-if="isRunning" color="green" class="tag">
          <CheckCircleOutlined />
          {{ statusText }}
        </a-tag>
        <a-tag v-else-if="isStopped" class="tag">
          <ExclamationCircleOutlined />
          {{ statusText }}
        </a-tag>
        <a-tag v-else class="tag" color="pink">
          {{ statusText }}
        </a-tag>
      </a-typography-paragraph>
      <a-typography-paragraph>
        <span>{{ t("TXT_CODE_68831be6") }}</span>
        <span>{{ instanceTypeText }}</span>
      </a-typography-paragraph>
      <a-typography-paragraph v-if="Number(instanceInfo?.config?.pingConfig?.port) > 0">
        <span>{{ t("TXT_CODE_baseinfo_port") }}</span>
        <span>{{ instanceInfo?.config?.pingConfig?.port }}</span>
      </a-typography-paragraph>
      <a-typography-paragraph>
        <span>
          {{ t("TXT_CODE_ad30f3c5") }}
          <a-tag v-if="Number(instanceInfo?.started) > 0">
            {{ instanceInfo?.started }}
          </a-tag>
          <span v-else>{{ instanceInfo?.started }}</span>
        </span>
      </a-typography-paragraph>
      <a-typography-paragraph>
        <span>
          {{ t("TXT_CODE_6420023d") }}
          <a-tag v-if="Number(instanceInfo?.autoRestarted) > 0" class="ml-6">
            {{ instanceInfo?.autoRestarted }}
          </a-tag>
          <span v-else class="ml-6">{{ instanceInfo?.autoRestarted }}</span>
        </span>
      </a-typography-paragraph>

      <a-typography-paragraph v-if="instanceGameServerInfo">
        <span>{{ t("TXT_CODE_855c4a1c") }}</span>
        <span>{{ instanceGameServerInfo.players }}</span>
      </a-typography-paragraph>
      <a-typography-paragraph v-if="instanceGameServerInfo">
        <span>
          {{ t("TXT_CODE_e260a220") }}
        </span>
        <span>
          {{ instanceGameServerInfo.version }}
        </span>
      </a-typography-paragraph>

      <template v-if="instanceInfo?.config.processType === 'docker'">
        <a-typography-paragraph>
          {{ t("TXT_CODE_4f917a65") }}
          <a href="javascript:;" @click="DockerInfoDialog?.openDialog()">
            {{ t("TXT_CODE_530f5951") }}
          </a>
        </a-typography-paragraph>
      </template>
      <a-typography-paragraph v-if="Number(instanceInfo?.info?.allocatedPorts?.length) > 0">
        {{ t("TXT_CODE_2e4469f6") }}
        <div style="padding: 10px 0px 0px 16px">
          <div
            v-for="(item, index) in instanceInfo?.info?.allocatedPorts"
            :key="index"
            class="mb-4"
          >
            <span>
              <a-tag color="green">{{ item.protocol.toUpperCase() }}</a-tag>
            </span>
            <a-tag>
              <span>{{ t("TXT_CODE_8dfc41ef") }}: {{ item.host }}</span>
              <span class="ml-4"> {{ t("TXT_CODE_8f8103b7") }}: {{ item.container }} </span>
            </a-tag>
          </div>
        </div>
      </a-typography-paragraph>

      <a-typography-paragraph>
        <span>{{ t("TXT_CODE_ae747cc0") }}</span>
        <span>{{ parseTimestamp(instanceInfo?.config.endTime) || t("TXT_CODE_e3a77a77") }}</span>
      </a-typography-paragraph>
      <a-typography-paragraph v-if="!instanceGameServerInfo">
        {{ t("TXT_CODE_8b8e08a6") }}{{ parseTimestamp(instanceInfo?.config.createDatetime) }}
      </a-typography-paragraph>
      <a-typography-paragraph>
        {{ t("TXT_CODE_46f575ae") }}{{ parseTimestamp(instanceInfo?.config.lastDatetime) }}
      </a-typography-paragraph>
      <a-typography-paragraph>
        <a-typography-text :title="instanceInfo?.instanceUuid">
          {{ t("TXT_CODE_30051f9b") }}
        </a-typography-text>
        <a-typography-text :copyable="{ text: instanceInfo?.instanceUuid }"> </a-typography-text>
        <a-typography-text class="ml-20" :title="daemonId">
          {{ t("TXT_CODE_5f2d2e30") }}
        </a-typography-text>
        <a-typography-text :copyable="{ text: daemonId }"> </a-typography-text>
      </a-typography-paragraph>
      <a-typography-paragraph v-if="instanceInfo?.config.tag.length">
        <details open>
          <summary>{{ t("TXT_CODE_eaabd222") }}:</summary>
          <a-tag
            v-for="tag in instanceInfo.config.tag"
            :key="tag"
            class="m-4"
            style="display: inline-block"
          >
            {{ tag }}
          </a-tag>
        </details>
      </a-typography-paragraph>
    </template>
  </CardPanel>

  <DockerInfo ref="DockerInfoDialog" :docker-info="instanceInfo?.config.docker" />
</template>

<style lang="scss" scoped>
.server-icon {
  width: 48px;
  height: 48px;
  border-radius: 6px;
  object-fit: cover;
  image-rendering: pixelated;
}
</style>
