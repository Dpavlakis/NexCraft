# User Avatars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each NexCraft user an uploadable avatar (with an initials fallback), shown as avatar + username in the header, in the profile dialog, and in the Users list.

**Architecture:** Store the avatar as a small base64 data URL on the panel `User` record (no upload endpoint, no file serving). The single persistence point is `userSystem.edit()`, used by both self-update and admin-update. The frontend crops/resizes images to 128px before saving, renders via a reusable `UserAvatar` component, and reads `userInfo.avatar` from the app state store.

**Tech Stack:** Koa (panel backend), Vue 3 + Ant Design Vue 4 + vue-i18n (frontend), webpack (panel build), vue-tsc + vite (frontend).

**Verification methodology:** This project uses type-check + build as the gate (no unit-test runner in the workflow). Each task ends by building the affected package(s) and committing. Run commands from `D:\NexCraft` with the Node PATH prefix the project uses.

PATH prefix for every PowerShell command:
```
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
```

Build commands:
- Panel: `npm run build --prefix panel`
- Frontend type-check: `npm run type-check --prefix frontend`
- Frontend build: `npm run build --prefix frontend`

---

## File Structure

Backend (panel):
- `panel/src/app/entity/entity_interface.ts` — add `avatar?` to `IUser`.
- `panel/src/app/entity/user.ts` — add `avatar` field to `User`.
- `panel/src/app/service/user_service.ts` — persist `avatar` in `edit()`; export `validateAvatarString()`.
- `panel/src/app/service/instance_service.ts` — include `avatar` in self-info response.
- `panel/src/app/routers/general_user_router.ts` — new `PUT /auth/avatar` (self, no logout).
- `panel/src/app/routers/user_overview_router.ts` — validate `avatar` on admin `PUT /auth/`.

Frontend:
- `frontend/src/types/user.ts` — add `avatar?` to `BaseUserInfo`.
- `frontend/src/tools/avatar.ts` (new) — `fileToAvatarDataUrl()`.
- `frontend/src/components/UserAvatar.vue` (new) — image-or-initials avatar.
- `frontend/src/services/apis/user.ts` — `updateMyAvatar` (self).
- `frontend/src/components/MyselfInfoDialog.vue` — avatar uploader.
- `frontend/src/hooks/useHeaderMenus.ts` — flag Profile/Logout for the user dropdown.
- `frontend/src/components/AppHeader.vue` — desktop avatar + username dropdown.
- `frontend/src/widgets/UserList.vue` — avatar next to username + admin "Set avatar".
- `languages/en_US.json` — new i18n keys.

---

## Task 1: Backend — avatar field, persistence, and validation

**Files:**
- Modify: `panel/src/app/entity/entity_interface.ts`
- Modify: `panel/src/app/entity/user.ts`
- Modify: `panel/src/app/service/user_service.ts`

- [ ] **Step 1: Add `avatar` to the `IUser` interface**

In `panel/src/app/entity/entity_interface.ts`, inside `interface IUser { ... }` (after the `ssoBound?: boolean;` line, before the closing brace):

```ts
  ssoBound?: boolean;
  avatar?: string;
```

- [ ] **Step 2: Add `avatar` to the `User` class**

In `panel/src/app/entity/user.ts`, in `class User implements IUser`, after `ssoBound = false;`:

```ts
  ssoBound = false;
  avatar: string = "";
```

- [ ] **Step 3: Add the validation helper + persist avatar in `edit()`**

In `panel/src/app/service/user_service.ts`:

Add an exported validation helper near the top of the file (after the imports). It allows an empty string (clear) or a bounded image data URL:

```ts
// Avatars are stored as small base64 data URLs on the user record. Reject
// anything that is not an image data URL or exceeds the size cap (~256 KB
// binary ≈ 400k base64 chars). Empty string clears the avatar.
const AVATAR_DATA_URL_RE = /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/=]+$/;
const AVATAR_MAX_LEN = 400_000;
export function validateAvatarString(avatar: string): void {
  if (avatar === "") return;
  if (typeof avatar !== "string" || !AVATAR_DATA_URL_RE.test(avatar) || avatar.length > AVATAR_MAX_LEN) {
    throw new Error($t("TXT_CODE_avatar.invalid"));
  }
}
```

If `$t` is not already imported in this file, add: `import { $t } from "../i18n";` (check the existing imports first; only add if missing).

Then, inside the `edit(uuid, config)` method, add an avatar branch alongside the other `if (config.x != null)` lines (e.g. right after the `ssoBound` line):

```ts
    if (config.ssoBound != null) instance.ssoBound = Boolean(config.ssoBound);
    if (config.avatar != null) {
      validateAvatarString(String(config.avatar));
      instance.avatar = String(config.avatar);
    }
```

- [ ] **Step 4: Build the panel**

Run:
```
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); cd D:\NexCraft; npm run build --prefix panel
```
Expected: `webpack ... compiled successfully`. (The `TXT_CODE_avatar.invalid` key is added in Task 7; the build does not fail on a missing key — it resolves at runtime — but if you prefer, do Task 7 first.)

- [ ] **Step 5: Commit**

```
cd D:\NexCraft; git add panel/src/app/entity/entity_interface.ts panel/src/app/entity/user.ts panel/src/app/service/user_service.ts; git commit -m "feat(user): add avatar field + validation/persistence" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Backend — expose avatar in self-info and accept on update

**Files:**
- Modify: `panel/src/app/service/instance_service.ts:136-148`
- Modify: `panel/src/app/routers/general_user_router.ts`
- Modify: `panel/src/app/routers/user_overview_router.ts`

- [ ] **Step 1: Include avatar in the self-info response**

In `panel/src/app/service/instance_service.ts`, in `getInstancesByUuid`, the final `return { ... }` object (currently ends with `secret: user.secret, token: ""`). Add `avatar`:

```ts
  return {
    uuid: user.uuid,
    userName: user.userName,
    loginTime: user.loginTime,
    registerTime: user.registerTime,
    instances: resInstances,
    permission: user.permission,
    apiKey: user.apiKey,
    isInit: user.isInit,
    open2FA: user.open2FA,
    secret: user.secret,
    avatar: user.avatar,
    token: ""
  };
```

- [ ] **Step 2: Add a self-service avatar endpoint (no logout)**

In `panel/src/app/routers/general_user_router.ts`, add a new route after the existing `PUT /update` handler. It validates and saves the current user's avatar without logging them out (unlike `/update`):

```ts
// [Low-level Permission]
// Update only the current user's avatar (does not log out, unlike /update)
router.put(
  "/avatar",
  permission({ level: ROLE.USER }),
  validator({ body: { avatar: String } }),
  async (ctx: Koa.ParameterizedContext) => {
    const userUuid = getUserUuid(ctx);
    if (!userUuid) return;
    const avatar = String(ctx.request.body.avatar ?? "");
    userSystem.validateAvatarString(avatar);
    await userSystem.edit(userUuid, { avatar });
    ctx.body = true;
  }
);
```

Add the import for `validateAvatarString`. `userSystem` is the default export (a singleton); confirm whether `validateAvatarString` is reachable as `userSystem.validateAvatarString`. It is exported as a standalone function in Task 1, so import it directly instead:

```ts
import { validateAvatarString } from "../service/user_service";
```

and call `validateAvatarString(avatar);` (not `userSystem.validateAvatarString`). Update the route body accordingly.

- [ ] **Step 3: Validate avatar on the admin edit endpoint**

In `panel/src/app/routers/user_overview_router.ts`, the admin `PUT /` handler passes `config` straight to `userSystem.edit`. Add explicit validation before the edit so a bad avatar is rejected with a clear error. Add the import:

```ts
import { validateAvatarString } from "../service/user_service";
```

Then inside the handler, before `await userSystem.edit(uuid, config);`:

```ts
    if (config.avatar != null) validateAvatarString(String(config.avatar));
    await userSystem.edit(uuid, config);
```

(`edit()` already persists `avatar` from Task 1. The `GET /auth/search` list endpoint returns the full user record minus password/salt, so avatars appear there automatically — no change needed.)

- [ ] **Step 4: Build the panel**

Run:
```
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); cd D:\NexCraft; npm run build --prefix panel
```
Expected: `compiled successfully`.

- [ ] **Step 5: Commit**

```
cd D:\NexCraft; git add panel/src/app/service/instance_service.ts panel/src/app/routers/general_user_router.ts panel/src/app/routers/user_overview_router.ts; git commit -m "feat(user): expose avatar in self-info; accept on self/admin update" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Frontend — i18n keys, types, avatar util, UserAvatar component

**Files:**
- Modify: `languages/en_US.json`
- Modify: `frontend/src/types/user.ts`
- Create: `frontend/src/tools/avatar.ts`
- Create: `frontend/src/components/UserAvatar.vue`

- [ ] **Step 1: Add i18n keys**

In `languages/en_US.json`, add these keys (place alphabetically among the `TXT_CODE_*` entries; en_US is the source of truth):

```json
  "TXT_CODE_avatar.invalid": "Invalid avatar image. Use a PNG, WebP, or JPEG under 256 KB.",
  "TXT_CODE_avatar.change": "Change avatar",
  "TXT_CODE_avatar.remove": "Remove avatar",
  "TXT_CODE_avatar.label": "Avatar",
  "TXT_CODE_avatar.tooLarge": "That image is too large. Please pick a smaller one.",
  "TXT_CODE_avatar.badType": "Unsupported image format. Use PNG, WebP, or JPEG.",
  "TXT_CODE_user.profile": "Profile"
```

- [ ] **Step 2: Add `avatar` to `BaseUserInfo`**

In `frontend/src/types/user.ts`, add to `interface BaseUserInfo` (after `ssoBound: boolean;`):

```ts
  ssoBound: boolean;
  avatar?: string;
```

(`EditUserInfo` and `LoginUserInfo` extend `BaseUserInfo`, so they inherit it.)

- [ ] **Step 3: Create the avatar image util**

Create `frontend/src/tools/avatar.ts`:

```ts
import { t } from "@/lang/i18n";

const ACCEPTED = ["image/png", "image/webp", "image/jpeg"];
const MAX_INPUT_BYTES = 8 * 1024 * 1024; // 8 MB raw input cap

/**
 * Read an image File, center-crop to a square, resize to `size`x`size`, and
 * return a small base64 data URL (webp). Throws a localized error on bad input.
 */
export function fileToAvatarDataUrl(file: File, size = 128): Promise<string> {
  if (!ACCEPTED.includes(file.type)) return Promise.reject(new Error(t("TXT_CODE_avatar.badType")));
  if (file.size > MAX_INPUT_BYTES) return Promise.reject(new Error(t("TXT_CODE_avatar.tooLarge")));
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error(t("TXT_CODE_avatar.badType")));
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
      let dataUrl = canvas.toDataURL("image/webp", 0.9);
      if (!dataUrl.startsWith("data:image/webp")) dataUrl = canvas.toDataURL("image/png");
      resolve(dataUrl);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(t("TXT_CODE_avatar.badType")));
    };
    img.src = url;
  });
}
```

- [ ] **Step 4: Create the `UserAvatar` component**

Create `frontend/src/components/UserAvatar.vue`:

```vue
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
```

- [ ] **Step 5: Type-check the frontend**

Run:
```
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); cd D:\NexCraft; npm run type-check --prefix frontend
```
Expected: no errors (command prints the vue-tsc invocation and exits 0).

- [ ] **Step 6: Commit**

```
cd D:\NexCraft; git add languages/en_US.json frontend/src/types/user.ts frontend/src/tools/avatar.ts frontend/src/components/UserAvatar.vue; git commit -m "feat(frontend): avatar types, util, and UserAvatar component" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Frontend — self avatar API + profile dialog uploader

**Files:**
- Modify: `frontend/src/services/apis/user.ts`
- Modify: `frontend/src/components/MyselfInfoDialog.vue`

- [ ] **Step 1: Add the self avatar API**

In `frontend/src/services/apis/user.ts`, append:

```ts
export const updateMyAvatar = useDefineApi<
  {
    data: {
      avatar: string;
    };
  },
  boolean
>({
  url: "/api/auth/avatar",
  method: "PUT"
});
```

- [ ] **Step 2: Add the uploader to the profile dialog**

In `frontend/src/components/MyselfInfoDialog.vue`:

Add imports to `<script setup>`:

```ts
import UserAvatar from "@/components/UserAvatar.vue";
import { updateMyAvatar } from "@/services/apis/user";
import { fileToAvatarDataUrl } from "@/tools/avatar";
import { ref } from "vue"; // merge with the existing `vue` import line
```

Add handler logic (after the existing handlers, before `</script>`):

```ts
const avatarUploading = ref(false);
const avatarInput = ref<HTMLInputElement | null>(null);

const pickAvatar = () => avatarInput.value?.click();

const onAvatarFile = async (e: Event) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    avatarUploading.value = true;
    const dataUrl = await fileToAvatarDataUrl(file, 128);
    await updateMyAvatar().execute({ data: { avatar: dataUrl } });
    await updateUserInfo();
    message.success(t("TXT_CODE_d3de39b4"));
  } catch (error: any) {
    reportErrorMsg(error.message);
  } finally {
    avatarUploading.value = false;
  }
};

const removeAvatar = async () => {
  try {
    avatarUploading.value = true;
    await updateMyAvatar().execute({ data: { avatar: "" } });
    await updateUserInfo();
  } catch (error: any) {
    reportErrorMsg(error.message);
  } finally {
    avatarUploading.value = false;
  }
};
```

Add the UI block in the template, right after the opening `<a-form ... layout="vertical">` (before the first `<a-row>`):

```vue
        <a-form-item :label="t('TXT_CODE_avatar.label')">
          <div style="display: flex; align-items: center; gap: 12px">
            <UserAvatar
              :avatar="state.userInfo?.avatar"
              :name="state.userInfo?.userName"
              :size="56"
            />
            <a-button :loading="avatarUploading" @click="pickAvatar">
              {{ t("TXT_CODE_avatar.change") }}
            </a-button>
            <a-button
              v-if="state.userInfo?.avatar"
              danger
              :loading="avatarUploading"
              @click="removeAvatar"
            >
              {{ t("TXT_CODE_avatar.remove") }}
            </a-button>
            <input
              ref="avatarInput"
              type="file"
              accept="image/png,image/webp,image/jpeg"
              style="display: none"
              @change="onAvatarFile"
            />
          </div>
        </a-form-item>
```

- [ ] **Step 3: Type-check + build the frontend**

Run:
```
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); cd D:\NexCraft; npm run type-check --prefix frontend; npm run build --prefix frontend
```
Expected: type-check clean, `✓ built`.

- [ ] **Step 4: Commit**

```
cd D:\NexCraft; git add frontend/src/services/apis/user.ts frontend/src/components/MyselfInfoDialog.vue; git commit -m "feat(frontend): avatar uploader in profile dialog" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Frontend — header avatar + username dropdown

**Files:**
- Modify: `frontend/src/hooks/useHeaderMenus.ts`
- Modify: `frontend/src/components/AppHeader.vue`

- [ ] **Step 1: Flag the Profile and Logout entries for the user dropdown**

In `frontend/src/hooks/useHeaderMenus.ts`, add `inUserDropdown: true` to the two entries that should live under the avatar on desktop.

The User/profile entry (currently `title: t("TXT_CODE_8c3164c9"), icon: UserOutlined, click: () => { appTools.showUserInfoDialog = true; }`): add `inUserDropdown: true`.

The Logout entry (currently `title: t("TXT_CODE_2c69ab15"), icon: LogoutOutlined, ...`): add `inUserDropdown: true`.

Example (User entry):

```ts
      {
        title: t("TXT_CODE_8c3164c9"),
        icon: UserOutlined,
        inUserDropdown: true,
        click: () => {
          appTools.showUserInfoDialog = true;
        },
        conditions: !containerState.isDesignMode && isLogged.value,
        onlyPC: false
      },
```

Do the same (`inUserDropdown: true`) on the Logout entry.

- [ ] **Step 2: Render the avatar dropdown on the desktop header**

In `frontend/src/components/AppHeader.vue`:

Add imports to `<script setup>`:

```ts
import UserAvatar from "@/components/UserAvatar.vue";
import { useAppStateStore } from "@/stores/useAppStateStore";
```

Add after the existing `const { menus, appMenus, handleToPage } = useHeaderMenus();`:

```ts
const { state: appState, isLogged } = useAppStateStore();
const userMenuItems = computed(() => (appMenus.value as any[]).filter((i) => i.inUserDropdown));
```

In the desktop right-hand `<div class="btns">` loop, skip the items that belong in the user dropdown so they don't render as standalone icons. Change the dropdown branch and tooltip branch guards to also require `!item.inUserDropdown`:

- On the `<a-dropdown v-if="item.menus && item.conditions" ...>` line, change to `v-if="item.menus && item.conditions && !item.inUserDropdown"`.
- On the `<a-tooltip v-else-if="item.conditions" ...>` line, change to `v-else-if="item.conditions && !item.inUserDropdown"`.

Then, immediately after the `<div v-for="(item, index) in appMenus as any" ...>...</div>` block (still inside the right `<div class="btns">`), add the avatar control:

```vue
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
```

Add styles in the `<style lang="scss" scoped>` block (inside `.app-header-wrapper { ... }` near `.right-nav-button`):

```scss
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
```

(Phone layout is unchanged: the Profile/Logout entries still render there via the existing phone loop, because the `inUserDropdown` flag only affects the desktop branches you edited. The sidebar/bottom-nav consumers of `appMenus` are likewise unaffected.)

- [ ] **Step 3: Type-check + build the frontend**

Run:
```
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); cd D:\NexCraft; npm run type-check --prefix frontend; npm run build --prefix frontend
```
Expected: clean type-check, `✓ built`.

- [ ] **Step 4: Commit**

```
cd D:\NexCraft; git add frontend/src/hooks/useHeaderMenus.ts frontend/src/components/AppHeader.vue; git commit -m "feat(frontend): header avatar + username dropdown" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Frontend — Users list avatar + admin set

**Files:**
- Modify: `frontend/src/widgets/UserList.vue`

- [ ] **Step 1: Show the avatar next to the username**

In `frontend/src/widgets/UserList.vue`:

Import the component and util in `<script setup>`:

```ts
import UserAvatar from "@/components/UserAvatar.vue";
import { fileToAvatarDataUrl } from "@/tools/avatar";
```

In the table's `#bodyCell` template, add a branch to render the username cell with an avatar. Add this inside `<template #bodyCell="{ column, record }: AntTableCell">`, before the `ssoBound` branch:

```vue
                  <template v-if="column.key === 'userName'">
                    <span style="display: inline-flex; align-items: center; gap: 8px">
                      <UserAvatar :avatar="record.avatar" :name="record.userName" :size="24" />
                      <span>{{ record.userName }}</span>
                    </span>
                  </template>
```

- [ ] **Step 2: Add an admin "Set avatar" action**

Add state + handlers in `<script setup>` (after the existing handlers):

```ts
const avatarTargetUuid = ref("");
const avatarTargetName = ref("");
const userListAvatarInput = ref<HTMLInputElement | null>(null);

const handleSetAvatar = (user: BaseUserInfo) => {
  avatarTargetUuid.value = user.uuid;
  avatarTargetName.value = user.userName;
  userListAvatarInput.value?.click();
};

const onUserAvatarFile = async (e: Event) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || !avatarTargetUuid.value) return;
  try {
    const dataUrl = await fileToAvatarDataUrl(file, 128);
    await editUserInfo().execute({
      data: { config: { avatar: dataUrl } as any, uuid: avatarTargetUuid.value }
    });
    message.success(t("TXT_CODE_27efac3b"));
    await fetchData();
  } catch (error: any) {
    reportErrorMsg(error.message);
  }
};
```

Add a hidden file input and the menu item. Put the hidden input just inside the root `<div style="height: 100%" class="container">` (first child):

```vue
    <input
      ref="userListAvatarInput"
      type="file"
      accept="image/png,image/webp,image/jpeg"
      style="display: none"
      @change="onUserAvatarFile"
    />
```

Add a menu item in the `action` dropdown's `<a-menu>` (e.g. after the Edit item, key "1"):

```vue
                          <a-menu-item key="avatar" @click="handleSetAvatar(record)">
                            {{ t("TXT_CODE_avatar.change") }}
                          </a-menu-item>
```

- [ ] **Step 3: Type-check + build the frontend**

Run:
```
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); cd D:\NexCraft; npm run type-check --prefix frontend; npm run build --prefix frontend
```
Expected: clean type-check, `✓ built`.

- [ ] **Step 4: Commit**

```
cd D:\NexCraft; git add frontend/src/widgets/UserList.vue; git commit -m "feat(frontend): avatars in Users list + admin set avatar" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Final verification + push

- [ ] **Step 1: Build all three packages**

Run:
```
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); cd D:\NexCraft; npm run build --prefix daemon; npm run build --prefix panel; npm run type-check --prefix frontend; npm run build --prefix frontend
```
Expected: all succeed.

- [ ] **Step 2: Push**

```
cd D:\NexCraft; git push nexcraft main
```

- [ ] **Step 3: Manual verification (after rebuilding the web image / running the publish workflow + updating the container)**

1. Log in → top-right shows an initials circle + your username; clicking opens a dropdown with Profile and Logout.
2. Profile → Avatar → Change → pick an image → header + dialog update to the image; reload persists it.
3. Profile → Remove → falls back to the initials circle everywhere.
4. Users page → each row shows an avatar next to the name; Actions → Change avatar sets that user's image.
5. As a non-admin user, the Users page admin action is not available (page is admin-gated already).
6. Backend rejects a non-image or oversized avatar (manually craft a bad PUT, or trust validation).

---

## Self-Review Notes

- **Spec coverage:** data model (T1), self-info exposure (T2), self update (T2/T4), admin update (T2/T6), header avatar+username+dropdown (T5), UserAvatar with initials fallback (T3), profile uploader (T4), Users list + admin set (T6), client crop/resize 128px (T3), validation + size cap (T1), i18n (T3). All spec sections covered.
- **Type consistency:** `validateAvatarString` (panel) used in T1/T2; `fileToAvatarDataUrl` (frontend) used in T4/T6; `avatar?: string` on `BaseUserInfo` flows to `EditUserInfo`/`LoginUserInfo`; `inUserDropdown` flag set in T5 step 1 and read in T5 step 2.
- **No placeholders:** every step shows concrete code/commands.
