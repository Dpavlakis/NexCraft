<script setup lang="ts">
import { computed } from "vue";
import curseforge from "@/assets/curseforge.svg";
import modrinth from "@/assets/modrinth.svg";
import ftb from "@/assets/ftb.svg";

const props = defineProps<{ source?: string }>();
const providers: Record<string, { name: string; icon: string }> = {
  curseforge: { name: "CurseForge", icon: curseforge },
  modrinth: { name: "Modrinth", icon: modrinth },
  ftb: { name: "FTB", icon: ftb }
};
const provider = computed(() =>
  typeof props.source === "string" && Object.prototype.hasOwnProperty.call(providers, props.source)
    ? providers[props.source]
    : undefined
);
</script>

<template>
  <span v-if="provider" class="server-source-badge">
    <img :src="provider.icon" alt="" width="14" height="14" />
    {{ provider.name }}
  </span>
</template>

<style scoped>
.server-source-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 6px;
  border: 1px solid var(--card-border-color);
  border-radius: 4px;
  color: var(--text-color);
  font-size: 12px;
  line-height: 20px;
  white-space: nowrap;
  vertical-align: middle;
}
.server-source-badge img {
  object-fit: contain;
  flex: none;
}
</style>
