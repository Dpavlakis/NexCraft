<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    avatar?: string;
    name?: string;
    size?: number;
  }>(),
  { avatar: "", name: "", size: 32 }
);

const hasImage = computed(() => !!props.avatar && props.avatar.startsWith("data:image/"));

const initials = computed(() => {
  const n = (props.name || "").trim();
  if (!n) return "?";
  const parts = n.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
});

// Deterministic HSL color from the name so each user is stably colored.
const bgColor = computed(() => {
  const n = props.name || "";
  let hash = 0;
  for (let i = 0; i < n.length; i++) hash = (hash * 31 + n.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360}, 55%, 45%)`;
});

const boxStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  fontSize: `${Math.round(props.size * 0.4)}px`,
  backgroundColor: hasImage.value ? "transparent" : bgColor.value
}));
</script>

<template>
  <span class="user-avatar" :style="boxStyle">
    <img v-if="hasImage" :src="avatar" alt="" />
    <span v-else class="user-avatar-initials">{{ initials }}</span>
  </span>
</template>

<style lang="scss" scoped>
.user-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  overflow: hidden;
  color: #fff;
  font-weight: 600;
  line-height: 1;
  user-select: none;
  flex-shrink: 0;
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
}
</style>
