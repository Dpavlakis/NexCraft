<script setup lang="ts">
import type { RouterMetaInfo } from "@/config/router";
import { useAppRouters } from "@/hooks/useAppRouters";
import { t } from "@/lang/i18n";
import { useAppStateStore } from "@/stores/useAppStateStore";
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";

export interface BreadcrumbItem {
  title: string;
  disabled: boolean;
  // SPA target for router.push. undefined => not clickable (current page / home root).
  to?: string;
}

const route = useRoute();
const router = useRouter();
const { getRouteParamsUrl } = useAppRouters();
const { state: appState } = useAppStateStore();

const items = computed<BreadcrumbItem[]>(() => {
  const arr: BreadcrumbItem[] = [
    {
      title: t("TXT_CODE_f5b9d58f"),
      disabled: false,
      to: "/"
    }
  ];

  const queryUrl = getRouteParamsUrl();

  if (route.meta.breadcrumbs instanceof Array) {
    const meta = route.meta as RouterMetaInfo;
    meta.breadcrumbs?.forEach((v) => {
      const params = queryUrl && !v.mainMenu ? `?${queryUrl}` : "";
      if ((appState.userInfo?.permission || 0) < v.permission) return;
      arr.push({
        title: v.name,
        disabled: false,
        to: `${v.path}${params}`
      });
    });
  }

  arr.push({
    title: String(route.name),
    disabled: true
  });

  return arr;
});

// Navigate within the SPA (Vue Router) instead of following an <a href>, which
// would trigger a full page reload (the blank "Rendering Application..." screen).
const go = (item: BreadcrumbItem) => {
  if (item.disabled || !item.to) return;
  router.push(item.to);
};
</script>

<template>
  <div class="breadcrumbs">
    <a-breadcrumb>
      <a-breadcrumb-item v-for="item in items" :key="item.title">
        <a v-if="!item.disabled" href="javascript:void(0)" @click="go(item)">{{ item.title }}</a>
        <span v-else>{{ item.title }}</span>
      </a-breadcrumb-item>
    </a-breadcrumb>
  </div>
</template>

<style lang="scss" scoped>
.breadcrumbs {
  font-size: 18px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 0px;
}
</style>
