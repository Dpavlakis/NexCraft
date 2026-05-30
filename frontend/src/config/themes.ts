export interface ThemeDef {
  id: string;
  nameKey: string; // i18n key for the display name
  base: "light" | "dark";
  accent: string;
  headerGradient: string;
  sidebarGradient: string;
}

export const THEMES: ThemeDef[] = [
  {
    id: "nexcraft",
    nameKey: "TXT_CODE_theme_name_nexcraft",
    base: "light",
    accent: "#3179bd",
    headerGradient: "linear-gradient(90deg, #162961 0%, #393f98 32%, #5c469c 58%, #1587ac 100%)",
    sidebarGradient: "linear-gradient(160deg, #162961 0%, #393f98 40%, #5c469c 65%, #1587ac 100%)"
  },
  {
    id: "crafty",
    nameKey: "TXT_CODE_theme_name_crafty",
    base: "dark",
    accent: "#20a4a4",
    headerGradient: "linear-gradient(90deg, #1b2240 0%, #20a4a4 45%, #6c4bd1 100%)",
    sidebarGradient: "linear-gradient(160deg, #161c33 0%, #1b2240 55%, #2a2150 100%)"
  },
  {
    id: "nether",
    nameKey: "TXT_CODE_theme_name_nether",
    base: "dark",
    accent: "#e0552b",
    headerGradient: "linear-gradient(90deg, #3a0d0d 0%, #7a1f12 50%, #c0392b 100%)",
    sidebarGradient: "linear-gradient(160deg, #2a0a0a 0%, #4a1410 60%, #6e1f15 100%)"
  },
  {
    id: "emerald",
    nameKey: "TXT_CODE_theme_name_emerald",
    base: "light",
    accent: "#2f9e44",
    headerGradient: "linear-gradient(90deg, #0b3d1f 0%, #1a7a3c 50%, #37b24d 100%)",
    sidebarGradient: "linear-gradient(160deg, #0b3d1f 0%, #155c30 60%, #1f7a3f 100%)"
  },
  {
    id: "amethyst",
    nameKey: "TXT_CODE_theme_name_amethyst",
    base: "dark",
    accent: "#9c6cf0",
    headerGradient: "linear-gradient(90deg, #2a1a4a 0%, #5e3bb0 50%, #9c6cf0 100%)",
    sidebarGradient: "linear-gradient(160deg, #1f1438 0%, #3a2470 60%, #5a3aa0 100%)"
  },
  {
    id: "diamond",
    nameKey: "TXT_CODE_theme_name_diamond",
    base: "light",
    accent: "#1aa3c4",
    headerGradient: "linear-gradient(90deg, #0a3a4a 0%, #1488a8 50%, #3fd0e8 100%)",
    sidebarGradient: "linear-gradient(160deg, #0a3a4a 0%, #10657f 60%, #1a8aa8 100%)"
  }
];

export const DEFAULT_THEME_ID = "nexcraft";
export const THEME_ID_KEY = "nx-theme-id";
export const themeById = (id?: string): ThemeDef =>
  THEMES.find((t) => t.id === id) || THEMES[0];
