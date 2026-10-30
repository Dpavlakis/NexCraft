<script setup lang="ts">
import { t } from "@/lang/i18n";
import { useAppConfigStore } from "@/stores/useAppConfigStore";
import { DownOutlined } from "@ant-design/icons-vue";

const { currentMode, isDarkTheme, setMode } = useAppConfigStore();
const selectMode = (event: Event) => {
  const mode = (event.target as HTMLSelectElement).value;
  if (mode === "auto" || mode === "light" || mode === "dark") setMode(mode);
};
</script>

<template>
  <div class="color-mode-control">
    <button
      type="button"
      role="switch"
      class="color-mode-switch"
      :class="{ 'is-night': isDarkTheme }"
      :aria-checked="isDarkTheme"
      :aria-label="t('TXT_CODE_appearance_night_mode')"
      :title="currentMode === 'auto' ? t('TXT_CODE_appearance_following_system') : t('TXT_CODE_appearance_switch_day_night')"
      @click="setMode(isDarkTheme ? 'light' : 'dark')"
    >
      <span class="mode-track" aria-hidden="true">
        <svg
          class="mode-sun"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
        >
          <circle cx="12" cy="12" r="4" />
          <path
            d="M12 1v3m0 16v3M1 12h3m16 0h3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"
          />
        </svg>
        <svg class="mode-moon" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20.6 14A9 9 0 0 1 10 3.4 9 9 0 1 0 20.6 14Z" />
        </svg>
        <span class="mode-thumb"></span>
      </span>
    </button>
    <span class="mode-options-wrap">
      <select
        class="mode-options"
        :value="currentMode"
        :aria-label="t('TXT_CODE_appearance_mode')"
        :title="currentMode === 'auto' ? t('TXT_CODE_appearance_system_auto_title') : t('TXT_CODE_appearance_options')"
        @change="selectMode"
      >
        <option value="auto">{{ t('TXT_CODE_appearance_system_auto') }}</option>
        <option value="light">{{ t('TXT_CODE_appearance_day') }}</option>
        <option value="dark">{{ t('TXT_CODE_appearance_night') }}</option>
      </select>
      <DownOutlined class="mode-chevron" aria-hidden="true" />
      <span v-if="currentMode === 'auto'" class="auto-indicator" aria-hidden="true"></span>
    </span>
  </div>
</template>

<style scoped>
.color-mode-control {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  color: var(--app-header-text-color, #fff);
}
.color-mode-switch,
.mode-options {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  touch-action: manipulation;
}
.color-mode-switch {
  width: 60px;
}
.mode-options-wrap {
  position: relative;
  display: inline-flex;
}
.mode-options {
  width: 26px;
  appearance: none;
  font: inherit;
  color: transparent;
}
.mode-options option {
  color: #182142;
  background: #fff;
}
.mode-chevron {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  pointer-events: none;
}
.color-mode-switch:focus-visible,
.mode-options:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: -2px;
}
.mode-options:focus-visible {
  outline-color: var(--app-header-text-color, #fff);
}
.mode-options:hover {
  background: rgba(255, 255, 255, 0.14);
}
.auto-indicator {
  position: absolute;
  top: 9px;
  right: 5px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
  pointer-events: none;
}
.mode-track {
  position: relative;
  display: block;
  width: 58px;
  height: 30px;
  border-radius: 999px;
  background: #d6ebff;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
  transition: background-color 180ms ease;
}
.mode-track svg {
  position: absolute;
  top: 7px;
  width: 16px;
  height: 16px;
  z-index: 1;
}
.mode-sun {
  left: 7px;
  color: #8b5a00;
}
.mode-moon {
  right: 7px;
  color: #42627d;
}
.mode-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
  transition: transform 180ms ease;
}
.is-night .mode-track {
  background: #26344f;
}
.is-night .mode-thumb {
  transform: translateX(28px);
}
.is-night .mode-sun {
  color: #f3cc78;
}
.is-night .mode-moon {
  color: #26344f;
}
@media (prefers-reduced-motion: reduce) {
  .mode-track,
  .mode-thumb {
    transition: none;
  }
}
</style>
