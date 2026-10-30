<script setup lang="ts">
import { ref, computed } from "vue";
import { DownOutlined } from "@ant-design/icons-vue";
import { t } from "@/lang/i18n";
import type { ServerGroupKind } from "@/tools/serverGroups";

const props = defineProps<{ kind: ServerGroupKind; count: number; forceOpen?: boolean }>();
const collapsed = ref(false);
const expanded = computed(() => props.forceOpen || !collapsed.value);
const toggle = () => {
  if (!props.forceOpen) collapsed.value = !collapsed.value;
};
</script>

<template>
  <section class="server-group" :data-server-group="kind">
    <h3 class="server-group-heading">
      <button
        type="button"
        class="server-group-toggle"
        :aria-expanded="!!expanded"
        :aria-disabled="!!forceOpen"
        @click="toggle"
      >
        <DownOutlined class="server-group-chevron" aria-hidden="true" />
        <span>{{ t(`TXT_CODE_server_groups_${kind}`) }}</span>
        <span class="server-group-count"
          >{{ count }} {{ t("TXT_CODE_server_groups_on_page") }}</span
        >
      </button>
    </h3>
    <div v-if="expanded" class="server-group-content"><slot /></div>
  </section>
</template>

<style scoped>
.server-group + .server-group {
  margin-top: 24px;
}
.server-group-heading {
  margin: 0 0 12px;
  font: inherit;
}
.server-group-toggle {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
  padding: 8px 0;
  border: 0;
  border-bottom: 1px solid var(--card-border-color);
  background: transparent;
  color: var(--text-color);
  font: inherit;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.server-group-toggle:focus-visible {
  outline: 2px solid var(--color-blue-6);
  outline-offset: 3px;
}
.server-group-toggle[aria-disabled="true"] {
  cursor: default;
}
.server-group-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 14px;
  width: 14px;
  height: 14px;
  font-size: 12px;
  line-height: 1;
  transform: rotate(-90deg);
  transition: transform 160ms ease;
}
.server-group-toggle[aria-expanded="true"] .server-group-chevron {
  transform: rotate(0deg);
}
@media (prefers-reduced-motion: reduce) {
  .server-group-chevron {
    transition: none;
  }
}
.server-group-count {
  margin-left: auto;
  font-size: 12px;
  font-weight: 400;
  opacity: 0.7;
}
.server-group-content {
  min-width: 0;
}
</style>
