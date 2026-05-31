<script setup lang="ts">
import nexcraftLogo from "@/assets/nexcraft_logo.svg";
import { useHeaderMenus } from "@/hooks/useHeaderMenus";
import { useScreen } from "@/hooks/useScreen";
import { useLayoutContainerStore } from "@/stores/useLayoutContainerStore";
import { MenuUnfoldOutlined } from "@ant-design/icons-vue";
import { useScroll } from "@vueuse/core";
import { computed, h } from "vue";
import { useRoute } from "vue-router";
import CardPanel from "./CardPanel.vue";
import UserAvatar from "@/components/UserAvatar.vue";
import { useAppStateStore } from "@/stores/useAppStateStore";

const route = useRoute();
const { containerState } = useLayoutContainerStore();

const { menus, appMenus, handleToPage } = useHeaderMenus();
const { state: appState, isLogged } = useAppStateStore();
const userMenuItems = computed(() =>
  (appMenus.value as any[]).filter((i) => i.inUserDropdown && i.conditions)
);

/** Whether route menu item is active (current path equals or is child of this path) */
const isRouteActive = (path: string): boolean => {
  if (route.path === path) return true;
  if (path === "/") return false;
  return route.path.startsWith(path + "/");
};

const { y } = useScroll(document.body);

const isScroll = computed(() => {
  return y.value > 10;
});

const headerStyle = computed(() => {
  return {
    "--header-height": isScroll.value ? "60px" : "64px"
  };
});

const { isPhone } = useScreen();

const openPhoneMenu = (b = false) => {
  containerState.showPhoneMenu = b;
};
</script>

<template>
  <header class="app-header-wrapper" :style="headerStyle">
    <div v-if="!isPhone" class="app-header-content">
      <nav class="btns">
        <a href="." class="brand-link" style="margin-right: 16px">
          <img :src="nexcraftLogo" class="brand-logo" alt="NexCraft" />
          <span class="nexcraft-brand-text">NexCraft</span>
        </a>

        <div
          v-for="item in menus"
          :key="item.path"
          class="nav-button"
          :class="[item.customClass, { 'nav-button-active': isRouteActive(item.path) }]"
          @click="handleToPage(item.path)"
        >
          <span>{{ item.name }}</span>
        </div>
      </nav>
      <div class="btns">
        <div v-for="(item, index) in appMenus as any" :key="index">
          <a-dropdown v-if="item.menus && item.conditions && !item.inUserDropdown" placement="bottom">
            <div
              :class="item.customClass"
              class="nav-button right-nav-button flex-center"
              @click.prevent
            >
              <component :is="item.icon" v-if="item.icon"></component>
            </div>
            <template #overlay>
              <a-menu @click="(e: any) => item.click(String(e.key))">
                <a-menu-item v-for="m in item.menus" :key="m.value">
                  {{ m.title }}
                </a-menu-item>
              </a-menu>
            </template>
          </a-dropdown>
          <a-tooltip v-else-if="item.conditions && !item.inUserDropdown" placement="bottom">
            <template #title>
              <span>{{ item.title }}</span>
            </template>
            <div
              :class="item.customClass"
              class="nav-button right-nav-button flex-center"
              type="text"
              @click="(e: any) => item.click(e.key)"
            >
              <component :is="item.icon" v-if="item.icon"></component>
              <span v-if="item?.iconText" class="ml-6" style="font-size: 12px">
                {{ item?.iconText }}
              </span>
            </div>
          </a-tooltip>
        </div>
        <a-dropdown v-if="isLogged" placement="bottomRight">
          <div class="nav-button right-nav-button user-chip flex-center" @click.prevent>
            <UserAvatar
              :avatar="appState.userInfo?.avatar"
              :name="appState.userInfo?.userName"
              :size="28"
            />
            <span class="user-chip-name">{{ appState.userInfo?.userName }}</span>
          </div>
          <template #overlay>
            <a-menu>
              <a-menu-item
                v-for="(item, i) in userMenuItems"
                :key="i"
                :class="item.customClass"
                @click="item.click()"
              >
                {{ item.title }}
              </a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </div>
    </div>
  </header>
  <div v-if="!isPhone" style="height: 64px"></div>

  <!-- Menus for phone -->
  <header v-if="isPhone" class="app-header-content-for-phone">
    <CardPanel class="card-panel">
      <template #body>
        <div style="display: flex; justify-content: space-between; align-items: center">
          <div style="width: 100px" class="flex">
            <a-button
              type="text"
              :icon="h(MenuUnfoldOutlined)"
              size="small"
              @click="openPhoneMenu(true)"
            ></a-button>
            <div v-for="(item, index) in appMenus" :key="index">
              <a-dropdown
                v-if="item.menus && item.conditions && !item.onlyPC"
                class="phone-nav-button"
                placement="bottom"
              >
                <a-button type="text" :icon="h(item.icon)" size="small" @click.prevent></a-button>
                <template #overlay>
                  <a-menu @click="(e: any) => item.click(String(e.key))">
                    <a-menu-item v-for="m in item.menus" :key="m.value">
                      {{ m.title }}
                    </a-menu-item>
                  </a-menu>
                </template>
              </a-dropdown>
            </div>
          </div>
          <div class="brand-link">
            <img :src="nexcraftLogo" class="brand-logo" alt="NexCraft" />
            <span class="nexcraft-brand-text" style="font-size: 16px">NexCraft</span>
          </div>
          <div style="width: 100px" class="justify-end">
            <div v-for="(item, index) in appMenus" :key="index">
              <a-button
                v-if="item.conditions && !item.onlyPC && !item.menus"
                class="phone-nav-button"
                type="text"
                :icon="h(item.icon)"
                size="small"
                @click="item.click"
              ></a-button>
            </div>
          </div>
        </div>
      </template>
    </CardPanel>
  </header>

  <a-drawer
    :width="500"
    title="MENU"
    placement="top"
    :open="containerState.showPhoneMenu"
    @close="() => (containerState.showPhoneMenu = false)"
  >
    <div class="phone-menu">
      <div
        v-for="item in menus"
        :key="item.path"
        class="phone-menu-btn"
        :class="{ 'phone-menu-btn-active': isRouteActive(item.path) }"
        @click="handleToPage(item.path)"
      >
        {{ item.name }}
      </div>
    </div>
  </a-drawer>
</template>

<style lang="scss" scoped>
@import "@/assets/global.scss";

.nav-button-warning:hover {
  background-color: rgba(255, 193, 7, 0.34) !important;
}

.nav-button-success:hover {
  background-color: rgba(64, 156, 216, 0.12) !important;
}

.nav-button-danger:hover {
  background-color: #ff19116f !important;
}

.nav-button-primary:hover {
  background-color: rgba(255, 255, 255, 0.25) !important;
}

.nav-button-success:hover {
  background-color: #48e6635a !important;
}

.phone-menu {
  .phone-menu-btn {
    padding: 16px 8px;
    border-bottom: 1px solid var(--color-gray-4);
    color: var(--color-gray-12);
  }

  .phone-menu-btn-active {
    background-color: rgba(64, 156, 216, 0.12);
  }
}

.app-header-content-for-phone {
  height: 60px;
  width: 100%;

  // display: flex;
  // justify-content: space-between;
  // align-items: center;
  // margin: 0px;
  .card-panel {
    background-color: var(--app-header-bg);
    margin-top: 8px;

    button {
      color: var(--color-always-white) !important;
    }
  }

  .phone-nav-button,
  .phone-nav-button * {
    margin: 0px 6px;
  }
}

.brand-link {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  cursor: pointer;
}
.brand-logo {
  height: 30px;
  width: auto;
  display: block;
}

.app-header-wrapper {
  box-shadow: 0 2px 4px 0 var(--card-shadow-color);
  // Theme gradient at full strength; the stone texture sits behind it as a
  // faint overlay (see ::before) so the gradient leads and the blocks are subtle.
  background-image: var(
    --nx-header-grad,
    linear-gradient(90deg, #162961 0%, #393f98 32%, #5c469c 58%, #1587ac 100%)
  );
  width: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  background-color: var(--app-header-bg);
  backdrop-filter: saturate(180%) blur(20px);
  color: var(--app-header-text-color);

  position: fixed;
  top: 0;
  left: 0;
  right: 0;

  z-index: 20;

  // Smooth height transition
  transition: height 0.3s ease-in-out;

  // Faint stone texture behind the gradient (9% — a subtle hint, not blocks).
  &::before {
    content: "";
    position: absolute;
    inset: 0;
    background-image: url("@/assets/stone-tile.png");
    background-repeat: repeat;
    opacity: 0.09;
    pointer-events: none;
    z-index: 0;
  }

  .app-header-content {
    @extend .global-app-container;
    position: relative;
    z-index: 1;

    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    height: var(--header-height);

    // Smooth height transition
    transition: height 0.3s ease-in-out;

    .btns {
      display: flex;
      align-items: center;
    }
  }

  .nav-button {
    margin: 0 4px;
    font-size: 14px;
    transition: all 0.4s;
    color: var(--app-header-text-color) !important;
    text-align: center;
    padding: 8px 12px;
    min-width: 40px;
    cursor: pointer;
    border-radius: 6px;
    user-select: none;
  }

  .right-nav-button {
    margin: 0 2px;
    font-size: 14px;
    padding: 8px 8px;
  }

  .user-chip {
    gap: 8px;
    .user-chip-name {
      font-size: 14px;
      max-width: 140px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .icon-button {
    font-size: 16px !important;
  }
  .nav-button:hover {
    background-color: rgba(215, 215, 215, 0.261);
  }

  .nav-button-active {
    background-color: rgba(215, 215, 215, 0.35);
  }

  .logo {
    cursor: pointer;
  }

  .pro-mode-order-container {
    @extend .nav-button;
    @extend .nav-button-success;
  }

  // Sync margin
  @media (max-width: 1470px) {
    .app-header-content,
    .app-header-content-for-phone {
      margin: 0px 25px;
    }
  }

  @media (max-width: 992px) {
    .app-header-content {
      margin: 0px 8px;
    }
  }
}
</style>
