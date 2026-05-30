<script setup lang="ts">
import type { LayoutCard } from "@/types";
import { NEW_CARD_TYPE } from "@/types/index";
import { computed, provide, ref, shallowRef, watch, type Component } from "vue";
import { useRoute } from "vue-router";

// A large centered modal that hosts a full-page instance widget (Players,
// Metrics, Backups, Schedule, Update, File/Mod Manager, Server Config) so the
// user stays on the instance page instead of navigating away. The widget reads
// its instanceId/daemonId from card.meta (useLayoutCardTools checks meta first).
const props = defineProps<{
  instanceId?: string;
  daemonId?: string;
}>();

const route = useRoute();
const open = ref(false);
const title = ref("");
const view = shallowRef<Component | null>(null);
const extraMeta = ref<Record<string, any>>({});

const card = computed<LayoutCard>(
  () =>
    ({
      id: "manage-instance-modal",
      type: NEW_CARD_TYPE.INSTANCE,
      title: title.value,
      width: 0,
      height: "100%",
      meta: {
        instanceId: props.instanceId,
        daemonId: props.daemonId,
        ...extraMeta.value
      }
    }) as unknown as LayoutCard
);

const openView = (component: Component, viewTitle: string, meta: Record<string, any> = {}) => {
  view.value = component;
  title.value = viewTitle;
  extraMeta.value = meta;
  open.value = true;
};

// If a hosted widget navigates (its "Return to console" button, or opening a
// config-file editor / file sub-view), close the modal so we don't sit stale on
// top of a changed route — the navigation then lands as a normal full page.
watch(
  () => route.fullPath,
  () => {
    if (open.value) open.value = false;
  }
);

// Hosted widgets hide their own "Return to console" button when embedded — the
// modal's X / Esc / click-outside already closes back to the instance page.
provide("embeddedInManageModal", true);

defineExpose({ openView });
</script>

<template>
  <a-modal
    v-model:open="open"
    :title="title"
    :footer="null"
    width="92%"
    :destroy-on-close="true"
    wrap-class-name="manage-instance-modal"
  >
    <div class="manage-modal-body">
      <component :is="view" v-if="view" :key="title" :card="card" />
    </div>
  </a-modal>
</template>

<style lang="scss">
.manage-instance-modal {
  .ant-modal {
    max-width: 1500px;
    padding-bottom: 0;
    top: 24px;
  }
  .ant-modal-body {
    padding: 8px 16px 16px;
  }
  // Size to content (so short views aren't a tall empty box and the hosted
  // widgets' `height:100%` rows don't stretch/space out), capped with a scroll.
  // The 12px horizontal padding absorbs the a-row gutter's -12px negative margin
  // so content (e.g. a progress bar's "100%" label) isn't clipped, while
  // overflow-x:hidden stays as a backstop against the stray h-scrollbar.
  .manage-modal-body {
    max-height: 82vh;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 0 12px;
  }
}
</style>
