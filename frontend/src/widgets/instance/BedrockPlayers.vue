<script setup lang="ts">
import { inject, onBeforeUnmount, onMounted, ref } from "vue";
const embeddedInManageModal = inject<boolean>("embeddedInManageModal", false);
import BetweenMenus from "@/components/BetweenMenus.vue";
import CardPanel from "@/components/CardPanel.vue";
import { useAppRouters } from "@/hooks/useAppRouters";
import { useLayoutCardTools } from "@/hooks/useCardTools";
import { useScreen } from "@/hooks/useScreen";
import { t } from "@/lang/i18n";
import {
  bedrockPlayerOverview,
  bedrockPlayerAction,
  type BedrockActionType,
  type BedrockPlayerOverview
} from "@/services/apis/player";
import { reportErrorMsg } from "@/tools/validator";
import type { LayoutCard } from "@/types/index";
import { RollbackOutlined, TeamOutlined, UserOutlined } from "@ant-design/icons-vue";
import { message, Modal } from "ant-design-vue";

const props = defineProps<{ card: LayoutCard }>();

const { isPhone } = useScreen();
const { toPage } = useAppRouters();
const { getMetaOrRouteValue } = useLayoutCardTools(props.card);
const instanceId = String(getMetaOrRouteValue("instanceId") ?? "");
const daemonId = String(getMetaOrRouteValue("daemonId") ?? "");

const data = ref<BedrockPlayerOverview>({
  running: false,
  online: [],
  allowlist: [],
  allowlistEnabled: false,
  operators: []
});
const loading = ref(false);
const newName = ref("");

const isOnAllowlist = (name: string) =>
  data.value.allowlist.some((e) => e.name.toLowerCase() === name.toLowerCase());

const load = async () => {
  const { execute } = bedrockPlayerOverview();
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

const act = async (action: BedrockActionType, name?: string) => {
  const { execute } = bedrockPlayerAction();
  try {
    await execute({ params: { daemonId, uuid: instanceId }, data: { action, name } });
    message.success(t("TXT_CODE_player_done"));
    setTimeout(load, 600);
  } catch (err: any) {
    reportErrorMsg(err.message);
  }
};

const confirmAct = (action: BedrockActionType, name: string, title: string) => {
  Modal.confirm({ title, content: name, onOk: () => act(action, name) });
};

const onAddAllowlist = () => {
  const name = newName.value.trim();
  if (!name) return;
  newName.value = "";
  act("allowlist_add", name);
};

const onToggleAllowlist = (checked: unknown) => {
  const enable = Boolean(checked);
  Modal.confirm({
    title: enable
      ? t("TXT_CODE_bedrock_confirm_allowlist_on")
      : t("TXT_CODE_bedrock_confirm_allowlist_off"),
    onOk: () => act(enable ? "allowlist_on" : "allowlist_off")
  });
};

const toConsole = () => {
  toPage({ path: "/instances/terminal", query: { daemonId, instanceId } });
};

let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  load();
  timer = setInterval(load, 15000);
});
onBeforeUnmount(() => timer && clearInterval(timer));
</script>

<template>
  <div style="height: 100%" class="container">
    <a-row :gutter="[24, 24]" style="height: 100%">
      <a-col :span="24">
        <BetweenMenus>
          <template v-if="!isPhone && !embeddedInManageModal" #left>
            <a-typography-title class="mb-0" :level="4">
              <TeamOutlined /> {{ card.title }}
            </a-typography-title>
          </template>
          <template #right>
            <a-button v-if="!embeddedInManageModal" @click="toConsole">
              <template #icon><RollbackOutlined /></template>
              {{ t("TXT_CODE_backup_to_console") }}
            </a-button>
            <a-button @click="load">{{ t("TXT_CODE_b76d94e0") }}</a-button>
          </template>
        </BetweenMenus>
      </a-col>

      <a-col :span="24">
        <a-alert
          v-if="!data.running"
          type="info"
          show-icon
          :message="t('TXT_CODE_bedrock_offline')"
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
                <UserOutlined class="player-head" />
                <span class="player-name">{{ name }}</span>
                <span class="player-actions">
                  <a-button
                    size="small"
                    @click="confirmAct('op', name, t('TXT_CODE_player_op'))"
                  >
                    {{ t("TXT_CODE_player_op") }}
                  </a-button>
                  <a-button
                    size="small"
                    @click="confirmAct('deop', name, t('TXT_CODE_player_deop'))"
                  >
                    {{ t("TXT_CODE_player_deop") }}
                  </a-button>
                  <a-button size="small" @click="confirmAct('kick', name, t('TXT_CODE_player_kick'))">
                    {{ t("TXT_CODE_player_kick") }}
                  </a-button>
                  <a-button
                    v-if="!isOnAllowlist(name)"
                    size="small"
                    @click="act('allowlist_add', name)"
                  >
                    {{ t("TXT_CODE_bedrock_allowlist_add") }}
                  </a-button>
                </span>
              </div>
            </a-spin>
          </template>
        </CardPanel>
      </a-col>

      <!-- Allowlist -->
      <a-col :xs="24" :lg="10">
        <CardPanel style="height: 100%">
          <template #title>
            {{ t("TXT_CODE_bedrock_allowlist") }} ({{ data.allowlist.length }})
          </template>
          <template #body>
            <div class="toggle-row">
              <span>{{ t("TXT_CODE_bedrock_allowlist_enforced") }}</span>
              <a-switch
                :checked="data.allowlistEnabled"
                @change="onToggleAllowlist"
              />
            </div>
            <div class="add-row">
              <a-input
                v-model:value="newName"
                :placeholder="t('TXT_CODE_bedrock_add_placeholder')"
                @press-enter="onAddAllowlist"
              />
              <a-button type="primary" @click="onAddAllowlist">
                {{ t("TXT_CODE_bedrock_add_btn") }}
              </a-button>
            </div>
            <a-empty
              v-if="!data.allowlist.length"
              :description="t('TXT_CODE_bedrock_allowlist_empty')"
            />
            <div v-for="entry in data.allowlist" :key="entry.name" class="player-row">
              <UserOutlined class="player-head" />
              <span class="player-name">
                {{ entry.name }}
                <a-tag
                  v-if="entry.xuid && data.operators.some((o) => o.xuid === entry.xuid)"
                  color="gold"
                  >OP</a-tag
                >
              </span>
              <span class="player-actions">
                <a-button
                  size="small"
                  danger
                  @click="confirmAct('allowlist_remove', entry.name, t('TXT_CODE_bedrock_allowlist_remove'))"
                >
                  {{ t("TXT_CODE_bedrock_allowlist_remove") }}
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
  font-size: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: rgba(128, 128, 128, 0.12);
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
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.add-row {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
</style>
