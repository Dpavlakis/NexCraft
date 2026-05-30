# User Avatars — Design

Date: 2026-05-30
Status: Approved (pending spec review)

## Goal

Give each NexCraft user an avatar so you can see who is logged in. Show the
logged-in user's avatar and username in the top-right of the header, let users
upload a custom image (with an auto-generated initials fallback), and surface
avatars in the Users list.

## Scope

In scope:
- `avatar` field on the panel user record, stored as a small base64 data URL.
- Self-service upload/change/remove (any logged-in user, for themselves).
- Admin set/clear of any user's avatar from the Users page.
- Header: avatar + username with a dropdown (Profile / change avatar, Logout).
- Reusable avatar component (uploaded image, else initials circle).
- Avatars shown in the Users list table.

Out of scope:
- Status/presence dot (chosen: none).
- Online/last-seen tracking.
- Avatars on the daemon side (this is panel-only; the daemon has no users).

## Data model

Add to the panel `User` entity (`panel/src/app/entity/user.ts`) and the `IUser`
interface (`panel/src/app/entity/entity_interface.ts`):

```
avatar: string = ""; // base64 data URL, e.g. "data:image/webp;base64,...", or "" for none
```

Stored through the existing user storage (no schema migration; absent field
reads back as `""`). No new files on disk, no static serving, no daemon work.

### Why a data URL on the record
Avatars are tiny (a 128px square webp is a few KB). Storing the data URL on the
user record means it flows through the user APIs we already have, renders
directly in an `<img src>`, and needs no upload endpoint, file storage, or
serving route. For a handful of users this is simpler and fully sufficient.

## Image handling (client side)

When a user picks an image:
1. Load into a canvas, center-crop to a square, resize to 128x128.
2. Encode to webp (fallback png) via `canvas.toDataURL`.
3. Preview, then send the resulting data URL on save.
4. "Remove" sets `avatar` to `""` (falls back to the initials circle).

Keeps the stored string small and the format predictable.

## Backend (panel, `/api/auth`)

- **Self info** (`GET /api/auth/`): include `avatar` in the response so the
  header can render it.
- **User list / search**: include each user's `avatar` so the Users table can
  render everyone's.
- **Self-profile update**: accept `avatar` for the current user.
- **Admin user-update** (existing edit-user endpoint): accept `avatar` so an
  admin can set/clear any user's.

### Validation (security)
Reject any `avatar` that is not either:
- the empty string (clear), or
- a string matching `^data:image/(png|webp|jpeg);base64,` and under a size cap
  (256 KB).

This bounds storage growth and prevents storing arbitrary/huge payloads. Data
URLs restricted to image mimetypes render safely in `<img>`.

## Frontend

### Reusable component: `UserAvatar.vue`
Props: `avatar?: string`, `name: string`, `size?: number`.
- If `avatar` is a non-empty data URL → render `<img>`.
- Else → render a circle with the user's initials (1-2 chars from `name`),
  background color derived deterministically from `name` (stable per user).
Used in the header, `MyselfInfoDialog`, and `UserList`.

### Header (`AppHeader.vue` + `useHeaderMenus.ts`)
Replace the generic `UserOutlined` top-right item with an avatar + username
control that opens a dropdown:
- **Profile / change avatar** → opens the existing `MyselfInfoDialog`.
- **Logout** → the existing logout confirm flow (moved into this dropdown).
Phone layout: keep an avatar button that opens the same actions.

### Profile dialog (`MyselfInfoDialog.vue`)
Add an avatar uploader: current avatar preview, "Change" (file pick → crop/
resize → preview), and "Remove". Save calls the self-profile update with the
new `avatar` (or `""`).

### Users list (`UserList.vue`)
- Show a small `UserAvatar` next to each username.
- Admin row action "Set avatar" → same uploader, calls the admin user-update
  for that user.

### Avatar in app state
Extend the frontend user types (`types/user.ts`: `LoginUserInfo`,
`BaseUserInfo`/list type, `EditUserInfo`) with `avatar?: string`, and surface it
from `useAppStateStore` so the header reads `state.userInfo.avatar`.

## i18n

Add en_US keys (source of truth) for: Profile, Change avatar, Remove avatar,
and any uploader labels/errors (e.g. "Image too large", "Unsupported format").

## Files touched

Backend (panel):
- `entity/user.ts`, `entity/entity_interface.ts` — add `avatar`.
- the auth/user router + service — include `avatar` in self-info and list
  responses; accept + validate `avatar` on self-update and admin update.

Frontend:
- `components/UserAvatar.vue` (new).
- `components/AppHeader.vue`, `hooks/useHeaderMenus.ts` — header avatar + dropdown.
- `components/MyselfInfoDialog.vue` — uploader.
- `widgets/UserList.vue` — column + admin set.
- `types/user.ts`, `stores/useAppStateStore.ts` — `avatar` field.
- `languages/en_US.json` — new keys.

## Verification

1. Fresh login shows an initials circle + username top-right; dropdown has
   Profile and Logout.
2. Upload an image in the profile dialog → header updates to the image; reload
   persists it; Users list shows it.
3. Remove → falls back to initials everywhere.
4. Admin sets another user's avatar from the Users page → that row updates.
5. Backend rejects a non-image data URL and an over-cap image.
6. Non-admin cannot change another user's avatar.
7. Builds green: daemon, panel, frontend type-check + build.
