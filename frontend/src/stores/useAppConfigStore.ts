/* eslint-disable no-unused-vars */
import logo from "@/assets/logo.png";
import { getCurrentLang, setLanguage } from "@/lang/i18n";
import { DEFAULT_THEME_ID, THEME_ID_KEY, themeById, type ThemeDef } from "@/config/themes";
import {
  createGlobalState,
  useBreakpoints,
  useLocalStorage,
  usePreferredDark
} from "@vueuse/core";
import { theme as antTheme } from "ant-design-vue";
import type { ThemeConfig } from "ant-design-vue/es/config-provider/context";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useLayoutConfigStore } from "./useLayoutConfig";

// Light/dark mode is independent of the colour theme: a theme sets the accent +
// header/sidebar gradient; the mode sets the page brightness and works with any
// theme. "auto" follows the OS preference.
export type AppMode = "auto" | "light" | "dark";
const MODE_KEY = "nx-mode";

export const useAppConfigStore = createGlobalState(() => {
  const { getSettingsConfig } = useLayoutConfigStore();

  const theme: ThemeConfig = reactive({
    algorithm: antTheme.defaultAlgorithm,
    token: {
      colorPrimary: "#3179bd", // NexCraft logo blue
      colorLink: "#3179bd",
      // Force a sans-serif stack everywhere (some titles were rendering serif)
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
      fontSizeLG: 14,
      fontSizeSM: 12,
      fontSizeXL: 18
    }
  });
  const appConfig = reactive({
    logoImage: logo as string
  });

  const logoImage = computed(() => appConfig.logoImage);

  const isPreferredDark = usePreferredDark();
  const currentThemeId = useLocalStorage<string>(THEME_ID_KEY, DEFAULT_THEME_ID);
  const currentMode = useLocalStorage<AppMode>(MODE_KEY, "auto");

  // Resolve "auto" against the OS; light/dark are explicit.
  const isDarkTheme = computed(() => {
    if (currentMode.value === "dark") return true;
    if (currentMode.value === "light") return false;
    return isPreferredDark.value;
  });

  const hasBgImage = ref(false);

  /** Main app nav layout: "left" = sidebar, "right" = top header only. Filled by initAppTheme(). */
  const sidebarPosition = ref<"left" | "right">("left");

  /** Whether to show the left sidebar; when false, only top header (AppHeader) is used. */
  const breakpoints = useBreakpoints({ sidebar: 1400 });
  const isWideEnoughForSidebar = breakpoints.greaterOrEqual("sidebar");
  const useSidebarLayout = computed(
    () => sidebarPosition.value === "left" && isWideEnoughForSidebar.value
  );

  const setBackgroundImage = (url: string) => {
    const body = document.querySelector("body");
    if (body) {
      body.style.backgroundSize = "cover";
      body.style.backgroundPosition = "center";
      body.style.backgroundRepeat = "no-repeat";
      if (isDarkTheme.value) {
        body.style.backgroundImage = `linear-gradient(135deg, rgba(0,0,0,0.65), rgba(0,0,0,0.65) 100%), url(${url})`;
        body.classList.remove("app-light-extend-theme");
        body.classList.add("app-dark-extend-theme");
      } else {
        body.style.backgroundImage = `linear-gradient(135deg, rgba(220,220,220,0.3), rgba(53,53,53,0.3) 100%), url(${url})`;
        body.classList.remove("app-dark-extend-theme");
        body.classList.add("app-light-extend-theme");
      }

      hasBgImage.value = true;
    }
  };

  const setLight = () => {
    theme.algorithm = antTheme.defaultAlgorithm;
    document.body.classList.add("app-light-theme");
    document.body.classList.remove("app-dark-theme");
  };

  const setDark = () => {
    theme.algorithm = antTheme.darkAlgorithm;
    document.body.classList.add("app-dark-theme");
    document.body.classList.remove("app-light-theme");
  };

  // A theme only sets the accent + header/sidebar gradient (no light/dark).
  const applyTheme = (themeDef: ThemeDef) => {
    const body = document.body;
    body.style.setProperty("--nx-header-grad", themeDef.headerGradient);
    body.style.setProperty("--nx-sidebar-grad", themeDef.sidebarGradient);
    body.style.setProperty("--nx-accent", themeDef.accent);
    if (theme.token) {
      theme.token.colorPrimary = themeDef.accent;
      theme.token.colorLink = themeDef.accent;
    }
  };

  const setThemeId = (id?: string) => {
    const def = themeById(id);
    currentThemeId.value = def.id;
    applyTheme(def);
  };

  // The light/dark mode is the single source of truth for page brightness.
  const applyMode = () => {
    if (isDarkTheme.value) setDark();
    else setLight();
    // Re-tint a configured background image to match the new brightness.
    const bg = document.body.style.backgroundImage;
    if (hasBgImage.value && bg) {
      const url = bg.match(/url\((.*?)\)/)?.[1]?.replace(/['"]/g, "");
      if (url) setBackgroundImage(url);
    }
  };

  const setMode = (m: AppMode) => {
    currentMode.value = m;
    applyMode();
  };

  // When in auto mode, follow OS changes live.
  watch(isPreferredDark, () => {
    if (currentMode.value === "auto") applyMode();
  });

  const initAppTheme = async () => {
    setThemeId(currentThemeId.value);
    applyMode();

    const frontendSettings = await getSettingsConfig();
    if (frontendSettings?.theme?.backgroundImage)
      setBackgroundImage(frontendSettings.theme.backgroundImage);
    const pos = frontendSettings?.theme?.sidebarPosition;
    sidebarPosition.value = pos === "left" || pos === "right" ? pos : "left";
  };

  const changeLanguage = (lang: string) => {
    setLanguage(lang);
  };

  const getCurrentLanguage = () => {
    return getCurrentLang() ?? "en_us";
  };

  const setLogoImage = (url: string) => {
    if (url) {
      appConfig.logoImage = url;
    }
  };

  onMounted(async () => {
    try {
      const settingsConfig = await getSettingsConfig();
      if (settingsConfig?.theme?.logoImage) {
        setLogoImage(settingsConfig.theme.logoImage);
      }
    } catch (error) {
      console.error("Failed to load settings config:", error);
    }
  });

  return {
    appConfig,
    logoImage,
    hasBgImage,
    sidebarPosition,
    useSidebarLayout,
    setLogoImage,
    changeLanguage,
    getCurrentLanguage,
    isDarkTheme,
    initAppTheme,
    setThemeId,
    applyTheme,
    setMode,
    currentMode,
    setBackgroundImage,
    currentThemeId,
    themeConfig: theme
  };
});
