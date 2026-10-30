<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { DeleteOutlined, EllipsisOutlined, TagsOutlined } from "@ant-design/icons-vue";
import { message } from "ant-design-vue";
import { openInstanceTagsEditor, useDeleteInstanceDialog } from "@/components/fc";
import { getInstanceInfo } from "@/services/apis/instance";
import { useLayoutContainerStore } from "@/stores/useLayoutContainerStore";
import { reportErrorMsg } from "@/tools/validator";
import { t } from "@/lang/i18n";
import { isEqual } from "lodash";

const props = defineProps<{
  instanceId: string;
  daemonId: string;
  nickname?: string;
  tags?: string[];
  menu?: boolean;
  disabled?: boolean;
}>();
const emit = defineEmits<{ changed: []; deleted: [] }>();
const { containerState } = useLayoutContainerStore();
const busy = ref(false);
const menuOpen = ref(false);
const root = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
const unavailable = computed(
  () =>
    props.disabled ||
    containerState.isDesignMode ||
    !props.instanceId ||
    !props.daemonId ||
    busy.value
);
const name = computed(() => props.nickname || props.instanceId);
let active = true;
let generation = 0;
watch(
  () => [props.instanceId, props.daemonId, props.disabled, containerState.isDesignMode],
  () => {
    generation++;
    menuOpen.value = false;
  },
  { flush: "sync" }
);

async function act(kind: "tags" | "delete") {
  if (unavailable.value) return;
  const target = {
    instanceId: props.instanceId,
    daemonId: props.daemonId,
    nickname: props.nickname,
    tags: [...(props.tags || [])],
    generation
  };
  const current = () =>
    active && target.generation === generation && !props.disabled && !containerState.isDesignMode;
  menuOpen.value = false;
  busy.value = true;
  try {
    if (kind === "tags") {
      const result = await openInstanceTagsEditor(target.instanceId, target.daemonId, [
        ...target.tags
      ]);
      if (!current() || !Array.isArray(result) || isEqual(result, target.tags)) return;
      // The native editor also resolves its local draft on Cancel. Read the saved
      // instance before reporting a change; a cancelled draft is not an acknowledgement.
      const { execute } = getInstanceInfo();
      const saved = await execute({
        params: { uuid: target.instanceId, daemonId: target.daemonId },
        forceRequest: true
      });
      if (
        current() &&
        saved.value?.instanceUuid === target.instanceId &&
        !isEqual(saved.value.config.tag || [], target.tags)
      )
        emit("changed");
    } else {
      const deleted = await useDeleteInstanceDialog(
        target.instanceId,
        target.daemonId,
        target.nickname || target.instanceId
      );
      if (deleted === true && current()) {
        message.success(t("TXT_CODE_f486dbb4"));
        emit("deleted");
      }
    }
  } catch (error) {
    if (current()) reportErrorMsg(error);
  } finally {
    busy.value = false;
  }
}

function items() {
  return [...(root.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') || [])];
}
async function openMenu(last = false) {
  if (unavailable.value) return;
  menuOpen.value = true;
  await nextTick();
  const buttons = items();
  if (active && menuOpen.value) buttons[last ? buttons.length - 1 : 0]?.focus();
}
function triggerKey(event: KeyboardEvent) {
  if (!["ArrowDown", "ArrowUp", "Escape"].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "Escape") menuOpen.value = false;
  else void openMenu(event.key === "ArrowUp");
}
function menuKey(event: KeyboardEvent) {
  if (event.key === "Tab") {
    menuOpen.value = false;
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End", "Escape"].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "Escape") {
    menuOpen.value = false;
    trigger.value?.focus();
    return;
  }
  const buttons = items(),
    index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  buttons[
    event.key === "Home"
      ? 0
      : event.key === "End"
      ? buttons.length - 1
      : (index + (event.key === "ArrowUp" ? buttons.length - 1 : 1)) % buttons.length
  ]?.focus();
}
function outside(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) menuOpen.value = false;
}
const stopOutsideListener = watch(
  () => props.menu,
  (menu) => {
    document.removeEventListener("pointerdown", outside);
    if (menu) document.addEventListener("pointerdown", outside);
    else menuOpen.value = false;
  }
);
onMounted(() => {
  if (props.menu) document.addEventListener("pointerdown", outside);
});
onBeforeUnmount(() => {
  active = false;
  generation++;
  stopOutsideListener();
  document.removeEventListener("pointerdown", outside);
});
</script>

<template>
  <div ref="root" class="instance-secondary-actions" @click.stop @keydown.stop>
    <template v-if="menu">
      <a-tooltip :title="t('TXT_CODE_server_actions_more', { name })">
        <button
          ref="trigger"
          type="button"
          class="secondary-icon"
          :disabled="unavailable"
          :aria-label="t('TXT_CODE_server_actions_more', { name })"
          aria-haspopup="menu"
          :aria-expanded="menuOpen"
          @keydown="triggerKey"
          @click="menuOpen ? (menuOpen = false) : openMenu()"
        >
          <EllipsisOutlined aria-hidden="true" />
        </button>
      </a-tooltip>
      <div
        v-if="menuOpen"
        role="menu"
        class="secondary-menu"
        :aria-label="t('TXT_CODE_server_actions_more', { name })"
        @keydown="menuKey"
      >
        <button type="button" role="menuitem" :disabled="unavailable" @click="act('tags')">
          <TagsOutlined aria-hidden="true" /> {{ t("TXT_CODE_78e88c3f") }}
        </button>
        <button
          type="button"
          role="menuitem"
          class="delete-action"
          :disabled="unavailable"
          @click="act('delete')"
        >
          <DeleteOutlined aria-hidden="true" /> {{ t("TXT_CODE_a0e19f38") }}
        </button>
      </div>
    </template>
    <template v-else>
      <a-tooltip :title="t('TXT_CODE_server_actions_tags', { name })">
        <button
          type="button"
          class="secondary-icon"
          :disabled="unavailable"
          :aria-label="t('TXT_CODE_server_actions_tags', { name })"
          @click="act('tags')"
        >
          <TagsOutlined aria-hidden="true" />
        </button>
      </a-tooltip>
      <a-tooltip :title="t('TXT_CODE_server_actions_delete', { name })">
        <button
          type="button"
          class="secondary-icon delete-action"
          :disabled="unavailable"
          :aria-label="t('TXT_CODE_server_actions_delete', { name })"
          @click="act('delete')"
        >
          <DeleteOutlined aria-hidden="true" />
        </button>
      </a-tooltip>
    </template>
  </div>
</template>

<style scoped>
.instance-secondary-actions {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex: none;
}
button {
  font: inherit;
  cursor: pointer;
  color: var(--text-color);
}
.secondary-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  font-size: 16px;
}
.secondary-icon:hover {
  background: var(--background-color);
  color: var(--nx-accent, var(--color-blue-6));
}
.delete-action {
  color: var(--color-red-7);
}
button:focus-visible {
  outline: 2px solid var(--nx-accent, var(--color-blue-6));
  outline-offset: 2px;
}
button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.secondary-menu {
  position: absolute;
  z-index: 20;
  top: calc(100% + 6px);
  right: 0;
  min-width: 168px;
  padding: 5px;
  background: var(--background-color-white);
  border: 1px solid var(--card-border-color);
  border-radius: 6px;
  box-shadow: 0 5px 18px #0002;
}
.secondary-menu button {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 40px;
  padding: 8px 12px;
  text-align: left;
  border: 0;
  border-radius: 3px;
  background: transparent;
}
.secondary-menu button:hover {
  background: var(--background-color);
}
@media (max-width: 560px) {
  .secondary-icon {
    width: 44px;
    height: 44px;
  }
}
</style>
