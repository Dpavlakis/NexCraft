<script setup lang="ts">
import { computed, ref } from "vue";
import { t } from "@/lang/i18n";

export type ServerLayout = "compact" | "list" | "overview";
const props = defineProps<{ modelValue: ServerLayout }>();
const emit = defineEmits<{ "update:modelValue": [value: ServerLayout] }>();
const options = [
  { value: "compact", path: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z" },
  { value: "list", path: "M3 5h2 M9 5h12 M3 12h2 M9 12h12 M3 19h2 M9 19h12" },
  { value: "overview", path: "M4 20a10 10 0 1 1 16 0z M12 5v2 M5 12h2 M17 12h2 M12 16l4-7" }
] as const;
const selectedIndex = computed(() =>
  options.findIndex((option) => option.value === props.modelValue)
);
const root = ref<HTMLElement>();
function onKey(event: KeyboardEvent) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const index =
    event.key === "Home"
      ? 0
      : event.key === "End"
      ? 2
      : (selectedIndex.value + (event.key === "ArrowRight" ? 1 : 2)) % 3;
  emit("update:modelValue", options[index].value);
  root.value?.querySelectorAll<HTMLButtonElement>("button")[index]?.focus({ preventScroll: true });
}
</script>

<template>
  <div
    ref="root"
    class="server-layout-switch"
    role="radiogroup"
    :aria-label="t('TXT_CODE_server_layout_label')"
    :style="{ '--selected': selectedIndex }"
    @keydown="onKey"
  >
    <span class="server-layout-thumb" aria-hidden="true" />
    <a-tooltip
      v-for="option in options"
      :key="option.value"
      :title="t('TXT_CODE_server_layout_' + option.value)"
    >
      <button
        type="button"
        role="radio"
        :data-layout="option.value"
        :aria-label="t('TXT_CODE_server_layout_' + option.value)"
        :title="t('TXT_CODE_server_layout_' + option.value)"
        :aria-checked="modelValue === option.value"
        :tabindex="modelValue === option.value ? 0 : -1"
        @click="emit('update:modelValue', option.value)"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          aria-hidden="true"
        >
          <path :d="option.path" />
        </svg>
      </button>
    </a-tooltip>
  </div>
</template>

<style scoped>
.server-layout-switch {
  position: relative;
  display: inline-flex;
  flex: none;
  isolation: isolate;
  padding: 3px;
  border: 1px solid var(--card-border-color);
  border-radius: 7px;
  background: var(--background-color);
}
.server-layout-thumb {
  position: absolute;
  left: 3px;
  top: 3px;
  width: 44px;
  height: 44px;
  border-radius: 4px;
  background: var(--nx-accent, var(--color-blue-6));
  z-index: -1;
  pointer-events: none;
  transform: translateX(calc(var(--selected) * 100%));
  transition: transform 160ms ease;
}
button {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 4px;
  padding: 0;
  font: inherit;
  font-size: 18px;
  background: transparent;
  color: var(--text-color);
  cursor: pointer;
}
button[aria-checked="true"] {
  color: #fff;
}
button:hover {
  box-shadow: inset 0 0 0 1px var(--nx-accent, var(--color-blue-6));
}
button:focus-visible {
  outline: 2px solid var(--nx-accent, var(--color-blue-6));
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .server-layout-thumb {
    transition: none;
  }
}
</style>
