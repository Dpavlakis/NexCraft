<script setup lang="ts">
import BetweenMenus from "@/components/BetweenMenus.vue";
import CardPanel from "@/components/CardPanel.vue";
import { useAppRouters } from "@/hooks/useAppRouters";
import { useLayoutCardTools } from "@/hooks/useCardTools";
import { useScreen } from "@/hooks/useScreen";
import { t } from "@/lang/i18n";
import { playerAction, playerList, type PlayerOverview } from "@/services/apis/player";
import { reportErrorMsg } from "@/tools/validator";
import type { LayoutCard } from "@/types/index";
import { RollbackOutlined, TeamOutlined } from "@ant-design/icons-vue";
import { message, Modal } from "ant-design-vue";
import { onBeforeUnmount, onMounted, ref } from "vue";

const props = defineProps<{ card: LayoutCard }>();

const { isPhone } = useScreen();
const { toPage } = useAppRouters();
const { getMetaOrRouteValue } = useLayoutCardTools(props.card);
const instanceId = String(getMetaOrRouteValue("instanceId") ?? "");
const daemonId = String(getMetaOrRouteValue("daemonId") ?? "");

const data = ref<PlayerOverview>({ rconReady: false, running: false, online: [], banned: [], ops: [] });
const loading = ref(false);

const headUrl = (name: string) => `https://mc-heads.net/avatar/${encodeURIComponent(name)}/40`;
const isOp = (name: string) => data.value.ops.includes(name);

const load = async () => {
  const { execute } = playerList();
  try {
    loading.value = true;
    const res = await execute({ params: { daemonId, uuid: instanceId } });
    if (res.value) data.value = res.value;
  } catch (err: any) {
    reportErrorMsg(err.message);
  } finally {
    loading.value = false;
  }
};

const act = async (action: "kick" | "ban" | "pardon" | "op" | "deop", name: string) => {
  const { execute } = playerAction();
  try {
    await execute({ params: { daemonId, uuid: instanceId }, data: { action, name } });
    message.success(t("TXT_CODE_player_done"));
    setTimeout(load, 600);
  } catch (err: any) {
    reportErrorMsg(err.message);
  }
};

const confirmAct = (action: "kick" | "ban" | "pardon" | "op" | "deop", name: string, title: string) => {
  Modal.confirm({
    title,
    content: name,
    onOk: () => act(action, name)
  });
};

const toConsole = () => {
  toPage({ path: "/instances/terminal", query: { daemonId, instanceId } });
};

let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  load();
  timer = setInterval(load, 15000); // refresh online list periodically
});
onBeforeUnmount(() => timer && clearInterval(timer));
</script>

<template>
  <div style="height: 100%" class="container">
    <a-row :gutter="[24, 24]" style="height: 100%">
      <a-col :span="24">
        <BetweenMenus>
          <template v-if="!isPhone" #left>
            <a-typography-title class="mb-0" :level="4">
              <TeamOutlined /> {{ card.title }}
            </a-typography-title>
          </template>
          <template #right>
            <a-button @click="toConsole">
              <template #icon><RollbackOutlined /></template>
              {{ t("TXT_CODE_backup_to_console") }}
            </a-button>
            <a-button @click="load">{{ t("TXT_CODE_b76d94e0") }}</a-button>
          </template>
        </BetweenMenus>
      </a-col>

      <a-col :span="24">
        <a-alert
          v-if="!data.rconReady"
          type="warning"
          show-icon
          :message="t('TXT_CODE_player_no_rcon')"
        />
        <a-alert
          v-else-if="!data.running"
          type="info"
          show-icon
          :message="t('TXT_CODE_player_offline')"
        />
      </a-col>

      <!-- Online -->
      <a-col :xs="24" :lg="14">
        <CardPanel style="height: 100%">
          <template #title>{{ t("TXT_CODE_player_online") }} ({{ data.online.length }})</template>
          <template #body>
            <a-spin :spinning="loading">
              <a-empty v-if="!data.online.length" :description="t('TXT_CODE_player_none_online')" />
              <div v-for="name in data.online" :key="name" class="player-row">
                <img :src="headUrl(name)" class="player-head" alt="" />
                <span class="player-name">
                  {{ name }}
                  <a-tag v-if="isOp(name)" color="gold">OP</a-tag>
                </span>
                <span class="player-actions">
                  <a-button
                    v-if="!isOp(name)"
                    size="small"
                    @click="confirmAct('op', name, t('TXT_CODE_player_op'))"
                  >
                    {{ t("TXT_CODE_player_op") }}
                  </a-button>
                  <a-button
                    v-else
                    size="small"
                    @click="confirmAct('deop', name, t('TXT_CODE_player_deop'))"
                  >
                    {{ t("TXT_CODE_player_deop") }}
                  </a-button>
                  <a-button size="small" @click="confirmAct('kick', name, t('TXT_CODE_player_kick'))">
                    {{ t("TXT_CODE_player_kick") }}
                  </a-button>
                  <a-button
                    size="small"
                    danger
                    @click="confirmAct('ban', name, t('TXT_CODE_player_ban'))"
                  >
                    {{ t("TXT_CODE_player_ban") }}
                  </a-button>
                </span>
              </div>
            </a-spin>
          </template>
        </CardPanel>
      </a-col>

      <!-- Banned -->
      <a-col :xs="24" :lg="10">
        <CardPanel style="height: 100%">
          <template #title>{{ t("TXT_CODE_player_banned") }} ({{ data.banned.length }})</template>
          <template #body>
            <a-empty v-if="!data.banned.length" :description="t('TXT_CODE_player_none_banned')" />
            <div v-for="name in data.banned" :key="name" class="player-row">
              <img :src="headUrl(name)" class="player-head" alt="" />
              <span class="player-name">{{ name }}</span>
              <span class="player-actions">
                <a-button size="small" @click="confirmAct('pardon', name, t('TXT_CODE_player_unban'))">
                  {{ t("TXT_CODE_player_unban") }}
                </a-button>
              </span>
            </div>
          </template>
        </CardPanel>
      </a-col>
    </a-row>
  </div>
</template>

<style lang="scss" scoped>
.player-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 4px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.15);
}
.player-head {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  image-rendering: pixelated;
  flex-shrink: 0;
}
.player-name {
  flex: 1;
  font-weight: 500;
}
.player-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
</style>
