<script setup lang="ts">
import { t } from "@/lang/i18n";
import type { LayoutCard, MountComponent } from "@/types";
import ModpackBrowser from "@/widgets/market/ModpackBrowser.vue";
import { computed, ref } from "vue";

const props = defineProps<
  {
    daemonId?: string;
    instanceId?: string;
    instanceName?: string;
    packInfo?: IModpackInfo;
  } & MountComponent
>();

const open = ref(false);

// ModpackBrowser only reads card.title; give it the reset heading.
const browserCard = { title: t("TXT_CODE_modpack_reset_title") } as unknown as LayoutCard;

const reinstallTarget = computed(() => ({
  instanceId: props.instanceId || "",
  daemonId: props.daemonId || "",
  instanceName: props.instanceName,
  packInfo: props.packInfo
}));

// A modpack or Bedrock instance focuses straight on a version-locked reset popup
// (no browse chrome); a custom/vanilla instance browses versions in a framed dialog.
const isFocusedReset = computed(
  () =>
    props.packInfo?.source === "curseforge" ||
    props.packInfo?.source === "modrinth" ||
    props.packInfo?.source === "ftb" ||
    props.packInfo?.source === "bedrock"
);

const openDialog = () => {
  open.value = true;
};

const close = () => {
  open.value = false;
  if (props.destroyComponent) props.destroyComponent();
};

defineExpose({ openDialog });
</script>

<template>
  <!-- Modpack / Bedrock reset: just the focused install/reset popup -->
  <ModpackBrowser
    v-if="open && isFocusedReset"
    :card="browserCard"
    :reinstall-target="reinstallTarget"
    @close="close"
  />

  <!-- Custom/vanilla reset: browse versions inside a framed dialog -->
  <a-modal
    v-else-if="open"
    v-model:open="open"
    :title="t('TXT_CODE_modpack_reset_title')"
    :width="1200"
    centered
    :mask-closable="false"
    :footer="null"
    :destroy-on-close="true"
    @cancel="close"
  >
    <ModpackBrowser :card="browserCard" :reinstall-target="reinstallTarget" @close="close" />
  </a-modal>
</template>
