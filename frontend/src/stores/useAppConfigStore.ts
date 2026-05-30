/* eslint-disable no-unused-vars */
import logo from "@/assets/logo.png";
import { getCurrentLang, setLanguage } from "@/lang/i18n";
import { DEFAULT_THEME_ID, THEME_ID_KEY, themeById, type ThemeDef } from "@/config/themes";
import { createGlobalState, useBreakpoints, useLocalStorage } from "@vueuse/core";
import { theme as antTheme } from "ant-design-vue";
import type { ThemeConfig } from "ant-design-vue/es/config-provider/context";
import { computed, onMounted, reactive, ref } from "vue";
import { useLayoutConfigStore } from "./useLayoutConfig";

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

  const currentThemeId = useLocalStorage<string>(THEME_ID_KEY, DEFAULT_THEME_ID);
  const activeBase = ref<"light" | "dark">("light");

  const isDarkTheme = computed(() => activeBase.value === "dark");

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

  const applyTheme = (themeDef: ThemeDef) => {
    const body = document.body;
    body.style.setProperty("--nx-header-grad", themeDef.headerGradient);
    body.style.setProperty("--nx-sidebar-grad", themeDef.sidebarGradient);
    body.style.setProperty("--nx-accent", themeDef.accent);
    if (theme.token) {
      theme.token.colorPrimary = themeDef.accent;
      theme.token.colorLink = themeDef.accent;
    }
    activeBase.value = themeDef.base;
    if (themeDef.base === "dark") setDark();
    else setLight();
  };

  const setThemeId = (id?: string) => {
    const def = themeById(id);
    currentThemeId.value = def.id;
    applyTheme(def);
  };

  const initAppTheme = async () => {
    setThemeId(currentThemeId.value);

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
    setBackgroundImage,
    currentThemeId,
    themeConfig: theme
  };
});
