# Themes (full palette per theme) — Design

Date: 2026-05-30
Status: Approved (pending spec review)

## Goal

Let each user pick a full visual theme for NexCraft — accent color + header/
sidebar gradient (over a stone texture) + light/dark base — saved to their
account so it follows them across devices. Ship six themes and a picker in the
Profile dialog.

## Scope

In scope:
- A data-driven theme registry (6 themes): NexCraft, Crafty, Nether, Emerald,
  Amethyst, Diamond.
- Applying a theme: accent (Ant `colorPrimary`/`colorLink`), header + sidebar
  gradients via CSS variables over a generated stone texture, and a light/dark
  base per theme.
- A generated seamless stone texture asset used by the header (new) + sidebar.
- Server-side per-user storage of the chosen theme id (like `avatar`), with a
  localStorage mirror for instant apply (incl. the login page).
- A theme picker (swatch grid) in the Profile dialog.

Out of scope:
- Custom user-defined colors (only the 6 presets).
- Per-instance theming.
- Keeping a separate light/dark/auto toggle — each theme carries its own base,
  so the theme list replaces that toggle.

## Background (current state)

- `frontend/src/stores/useAppConfigStore.ts` owns theming: a reactive Ant
  `ThemeConfig` with hardcoded `colorPrimary: "#3179bd"`, light/dark via
  `antTheme.defaultAlgorithm`/`darkAlgorithm`, `currentTheme` in localStorage
  (`THEME_KEY`), and `setTheme(AppTheme)`. `AppTheme` enum = AUTO/LIGHT/DARK in
  `types/const.ts`.
- The header gradient is hardcoded in `AppHeader.vue`
  (`background-image: linear-gradient(90deg,#162961…#1587ac)`); the sidebar
  gradient + `assets/side.png` texture are hardcoded in `AppSidebarMenu.vue`.
- The user record already carries `avatar` (added recently) through
  `userSystem.edit()`, self-info (`getInstancesByUuid`), and a self endpoint —
  the theme field mirrors that exact pattern.
- `MyselfInfoDialog.vue` already has the avatar picker; the theme picker sits
  alongside it.

## Theme registry

`frontend/src/config/themes.ts`:

```ts
export interface ThemeDef {
  id: string;            // stable id stored on the user
  name: string;          // display name (i18n key recommended)
  base: "light" | "dark";
  accent: string;        // hex; drives Ant colorPrimary + colorLink
  headerGradient: string;  // CSS gradient (90deg)
  sidebarGradient: string; // CSS gradient (160deg)
}
export const THEMES: ThemeDef[] = [ /* 6 entries */ ];
export const DEFAULT_THEME_ID = "nexcraft";
export const themeById = (id?: string) =>
  THEMES.find((t) => t.id === id) || THEMES[0];
```

The six themes (gradients abbreviated; full hex in implementation):
- **nexcraft** (light, accent `#3179bd`) — navy→indigo→purple→teal (current brand).
- **crafty** (dark, accent `#20a4a4`) — navy→teal→purple.
- **nether** (dark, accent `#e0552b`) — dark reds/oranges.
- **emerald** (light, accent `#2f9e44`) — greens.
- **amethyst** (dark, accent `#9c6cf0`) — purples.
- **diamond** (light, accent `#1aa3c4`) — cyan/aqua.

## Applying a theme

A single `applyTheme(themeDef)` in `useAppConfigStore`:
1. Sets CSS custom properties on `document.body`:
   - `--nx-header-grad`: `headerGradient`
   - `--nx-sidebar-grad`: `sidebarGradient`
   - `--nx-accent`: `accent`
2. Sets the Ant `themeConfig.token.colorPrimary` and `colorLink` to `accent`.
3. Sets the algorithm from `base` (`defaultAlgorithm` / `darkAlgorithm`) and the
   existing `app-light-theme` / `app-dark-theme` body classes.

`AppHeader.vue` and `AppSidebarMenu.vue` change their hardcoded gradient to
`background-image: var(--nx-header-grad)` / `var(--nx-sidebar-grad)`, layered
over the stone texture (see below). No other component reads theme internals.

The existing `currentTheme: AppTheme` (AUTO/LIGHT/DARK) and `setTheme(AppTheme)`
are replaced by `currentThemeId: string` + `setThemeId(id)`. The header's
light/dark dropdown is removed (themes carry their own base); any remaining
callers of `setTheme` are updated to `setThemeId`.

## Stone texture (generated)

Generate a seamless ~64×64 grayscale stone tile, commit as
`frontend/src/assets/stone-tile.png` (or `.webp`). Used as a `background-image`
(repeat) base layer:
- **Header** (`AppHeader.vue`): new — texture layer behind `--nx-header-grad`,
  blended with `background-blend-mode: overlay` (or a stacked element at ~82%).
- **Sidebar** (`AppSidebarMenu.vue`): replace `side.png` with `stone-tile.png`
  for consistency, gradient = `--nx-sidebar-grad`.

Swapping themes changes only the gradient var; the texture stays.

## Storage — server-side per user

Backend (panel), mirroring `avatar`:
- Add `theme: string = ""` to `User` (`entity/user.ts`) + `IUser`
  (`entity_interface.ts`).
- Persist in `userSystem.edit()` (`if (config.theme != null) instance.theme = …`),
  validated against the known ids (reject unknown → ignore/empty).
- Include `theme` in the self-info response (`getInstancesByUuid`).
- New self endpoint `PUT /api/auth/theme` (ROLE.USER), validates the id, calls
  `edit(uuid, { theme })`. Admin edit (`PUT /auth`) also accepts `theme`.
- Validation helper `isValidThemeId(id)` — but the panel can't import the
  frontend registry, so it validates against a small hardcoded id list in the
  panel (kept in sync with the 6 ids; documented in code).

Frontend:
- Add `theme?: string` to `BaseUserInfo` (`types/user.ts`).
- API `updateMyTheme` (`services/apis/user.ts`) → `PUT /api/auth/theme`.
- On first paint, `useAppConfigStore.initAppTheme()` reads `nx-theme-id` from
  localStorage and applies that theme immediately (covers the login page, before
  any user info exists). Default to `DEFAULT_THEME_ID` when absent.
- When user info loads/updates (`useAppStateStore.updateUserInfo`), call
  `setThemeId(userInfo.theme)` if present — which applies it AND writes the
  localStorage mirror, so the two stay reconciled. `setThemeId` is the single
  entry point: it applies the theme, updates `currentThemeId`, and mirrors to
  localStorage (it does NOT itself call the server — the picker does that).

## Picker — Profile dialog

In `MyselfInfoDialog.vue`, add a "Theme" section: a grid of swatch cards (one
per `THEMES` entry) showing the gradient + accent + name, current one marked.
Selecting a card calls `applyTheme` (live preview) and `updateMyTheme().execute`
to persist, then `updateUserInfo()`. i18n keys for the section label + theme
names.

## i18n

`languages/en_US.json`: `TXT_CODE_theme_label` ("Theme") + a name key per theme
(`TXT_CODE_theme_name_<id>`), used by the picker.

## Files touched

Backend (panel):
- `entity/user.ts`, `entity/entity_interface.ts` — add `theme`.
- `service/user_service.ts` — persist + `isValidThemeId`.
- `service/instance_service.ts` — include `theme` in self-info.
- `routers/general_user_router.ts` — `PUT /auth/theme`.
- `routers/user_overview_router.ts` — accept `theme` on admin edit.

Frontend:
- `config/themes.ts` (new) — registry.
- `stores/useAppConfigStore.ts` — `applyTheme`, `currentThemeId`, `setThemeId`;
  drop AppTheme light/dark toggle path.
- `assets/stone-tile.png` (new, generated).
- `components/AppHeader.vue` — texture + `var(--nx-header-grad)`; remove the
  light/dark dropdown item.
- `components/AppSidebarMenu.vue` — `var(--nx-sidebar-grad)` + stone-tile.
- `components/MyselfInfoDialog.vue` — theme picker grid.
- `hooks/useHeaderMenus.ts` — remove the theme (light/dark) menu entry.
- `services/apis/user.ts` — `updateMyTheme`.
- `types/user.ts` — `theme?` on `BaseUserInfo`.
- `stores/useAppStateStore.ts` — apply theme from `userInfo.theme` on load.
- `languages/en_US.json` — theme keys.

Daemon: none.

## Verification

1. Profile → Theme grid shows 6 themes; current marked.
2. Selecting a theme live-updates accent (buttons/links), header + sidebar
   gradient (texture visible beneath), and light/dark base; reload persists it;
   logging in on another browser shows the same theme (server-side).
3. Stone texture shows under the header and sidebar for every theme.
4. Login page applies the last-used theme (localStorage mirror) before auth.
5. Admin can set a user's theme from the Users page; backend rejects an unknown
   id.
6. No leftover light/dark/auto toggle conflicts; `setThemeId` replaces
   `setTheme` everywhere.
7. Builds green: panel (webpack), frontend (vue-tsc + vite).
