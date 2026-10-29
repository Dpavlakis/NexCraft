<script setup lang="ts">
import CopyButton from "@/components/CopyButton.vue";
import UserAvatar from "@/components/UserAvatar.vue";
import { PERMISSION_MAP } from "@/config/const";
import { t } from "@/lang/i18n";
import { THEMES } from "@/config/themes";
import {
  bind2FA,
  cancel2FA,
  confirm2FA,
  setUserApiKey,
  updateMyAvatar,
  updateMyTheme,
  updatePassword,
  type SecurityProof,
  type TwoFactorSetup
} from "@/services/apis/user";
import { useAppConfigStore } from "@/stores/useAppConfigStore";
import { useAppStateStore } from "@/stores/useAppStateStore";
import { useAppToolsStore } from "@/stores/useAppToolsStore";
import { fileToAvatarDataUrl } from "@/tools/avatar";
import { reportErrorMsg } from "@/tools/validator";
import { message } from "ant-design-vue";
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
const { state, updateUserInfo } = useAppStateStore();
const { state: tools } = useAppToolsStore();

const securityRequest = { forceRequest: true, timeout: 15000 };
const password = reactive({
  open: false,
  current: "",
  next: "",
  confirm: "",
  totp: "",
  busy: false,
  error: "",
  version: 0
});
const api = reactive({
  action: undefined as boolean | undefined,
  current: "",
  totp: "",
  sso: false,
  busy: false,
  error: "",
  version: 0
});
const factor = reactive({
  action: "" as "" | "setup" | "disable",
  current: "",
  totp: "",
  code: "",
  sso: false,
  busy: false,
  error: "",
  notice: "",
  version: 0
});
const setup = ref<TwoFactorSetup>();
const remaining = ref(0);
const expiryText = computed(
  () => Math.floor(remaining.value / 60) + ":" + String(remaining.value % 60).padStart(2, "0")
);
let epoch = 0;
let expiryTimer: ReturnType<typeof setInterval> | undefined;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const invalidResponse = () => new Error(t("TXT_CODE_auth_invalid_response"));
const validCode = (code: string) => /^\d{6}$/.test(code);
const isCurrent = (section: { version: number }, request: { epoch: number; version: number }) =>
  tools.showUserInfoDialog && epoch === request.epoch && section.version === request.version;
const begin = (section: { busy: boolean; error: string; version: number }) => {
  section.busy = true;
  section.error = "";
  return { epoch, version: ++section.version };
};
const clearPassword = () => {
  password.version++;
  Object.assign(password, {
    open: false,
    current: "",
    next: "",
    confirm: "",
    totp: "",
    busy: false,
    error: ""
  });
};
const clearApi = () => {
  api.version++;
  Object.assign(api, {
    action: undefined,
    current: "",
    totp: "",
    sso: false,
    busy: false,
    error: ""
  });
};
const clearFactor = () => {
  factor.version++;
  if (expiryTimer) clearInterval(expiryTimer);
  expiryTimer = undefined;
  setup.value = undefined;
  remaining.value = 0;
  Object.assign(factor, {
    action: "",
    current: "",
    totp: "",
    code: "",
    sso: false,
    busy: false,
    error: "",
    notice: ""
  });
};
const cancelSetup = async (setupId: string) => {
  const result = await cancel2FA().execute({ data: { setupId }, ...securityRequest });
  if (result.value !== true) throw invalidResponse();
};
const discardSetup = (setupId?: string) => {
  if (setupId)
    void cancelSetup(setupId).catch(() => {
      // Local secrets are already cleared; abandoned server setups also expire.
    });
};
const clearSecurity = () => {
  const setupId = setup.value?.setupId;
  epoch++;
  clearPassword();
  clearApi();
  clearFactor();
  discardSetup(setupId);
};
watch(() => tools.showUserInfoDialog, clearSecurity, { flush: "sync" });
watch(() => state.userInfo?.token, clearSecurity, { flush: "sync" });
onBeforeUnmount(clearSecurity);

const proof = (section: { current: string; totp: string; sso: boolean }): SecurityProof => {
  const useSSO = state.settings.ssoEnabled && section.sso;
  if (!useSSO && !section.current) throw new Error(t("TXT_CODE_auth_password_required"));
  if (state.userInfo?.open2FA && !validCode(section.totp))
    throw new Error(t("TXT_CODE_auth_current_code_required"));
  return {
    ...(!useSSO ? { currentPassword: section.current } : {}),
    ...(state.userInfo?.open2FA ? { currentTOTP: section.totp } : {})
  };
};
const securityUpdated = () => {
  clearSecurity();
  tools.showUserInfoDialog = false;
  state.userInfo = null;
  message.success(t("TXT_CODE_auth_relogin"));
  // Match the existing password-change flow; routing then offers password/SSO login.
  setTimeout(() => window.location.reload(), 600);
};
const handleChangePassword = async () => {
  if (password.busy) return;
  const request = begin(password);
  try {
    const credentials = proof({ current: password.current, totp: password.totp, sso: false });
    if (password.next !== password.confirm) throw new Error(t("TXT_CODE_d51f5d6"));
    if (password.next.length < 9 || password.next.length > 36)
      throw new Error(t("TXT_CODE_cc5a3aea"));
    const result = await updatePassword().execute({
      data: {
        passWord: password.next,
        currentPassword: credentials.currentPassword!,
        ...(credentials.currentTOTP ? { currentTOTP: credentials.currentTOTP } : {})
      },
      ...securityRequest
    });
    if (!isCurrent(password, request)) return;
    if (result.value !== true) throw invalidResponse();
    securityUpdated();
  } catch (error) {
    if (isCurrent(password, request)) password.error = errorText(error);
  } finally {
    if (isCurrent(password, request)) password.busy = false;
  }
};
const handleGenerateApiKey = async () => {
  if (api.busy || api.action === undefined) return;
  const request = begin(api);
  const enable = api.action;
  try {
    const result = await setUserApiKey().execute({
      data: { enable, ...proof(api) },
      ...securityRequest
    });
    if (!isCurrent(api, request)) return;
    const key = result.value;
    if (typeof key !== "string" || (enable ? key.length === 0 : key !== ""))
      throw invalidResponse();
    if (state.userInfo) state.userInfo.apiKey = key;
    clearApi();
    message.success(t("TXT_CODE_d3de39b4"));
  } catch (error) {
    if (isCurrent(api, request)) api.error = errorText(error);
  } finally {
    if (isCurrent(api, request)) api.busy = false;
  }
};
const expireSetup = () => {
  const setupId = setup.value?.setupId;
  clearFactor();
  factor.notice = t("TXT_CODE_auth_setup_expired");
  discardSetup(setupId);
};
const handleBind2FA = async () => {
  if (factor.busy || setup.value) return;
  const request = begin(factor);
  try {
    const result = await bind2FA().execute({ data: proof(factor), ...securityRequest });
    if (!isCurrent(factor, request)) {
      if (typeof result.value?.setupId === "string") discardSetup(result.value.setupId);
      return;
    }
    const pending = result.value;
    if (
      !pending ||
      typeof pending.setupId !== "string" ||
      !pending.setupId ||
      typeof pending.qrcode !== "string" ||
      !pending.qrcode.startsWith("data:image/png;base64,") ||
      typeof pending.expiresAt !== "number" ||
      !Number.isFinite(pending.expiresAt) ||
      typeof pending.replacing !== "boolean"
    )
      throw invalidResponse();
    factor.current = factor.totp = factor.code = "";
    factor.sso = false;
    setup.value = {
      ...pending,
      expiresAt: Math.min(pending.expiresAt, Date.now() + 5 * 60 * 1000)
    };
    const tick = () => {
      remaining.value = Math.max(0, Math.ceil((setup.value!.expiresAt - Date.now()) / 1000));
      if (!remaining.value) expireSetup();
    };
    tick();
    if (setup.value) expiryTimer = setInterval(tick, 1000);
  } catch (error) {
    if (isCurrent(factor, request)) factor.error = errorText(error);
  } finally {
    if (isCurrent(factor, request)) factor.busy = false;
  }
};
const confirm2FACode = async () => {
  if (factor.busy || !setup.value) return;
  if (setup.value.expiresAt <= Date.now()) return expireSetup();
  const request = begin(factor);
  try {
    if (!validCode(factor.code)) throw new Error(t("TXT_CODE_auth_new_code_required"));
    const result = await confirm2FA().execute({
      data: { enable: true as const, setupId: setup.value.setupId, TOTPCode: factor.code },
      ...securityRequest
    });
    if (!isCurrent(factor, request)) return;
    if (result.value?.enabled !== true || result.value.reloginRequired !== true)
      throw invalidResponse();
    setup.value = undefined; // Committed setup is consumed; do not send cancellation.
    securityUpdated();
  } catch (error) {
    if (isCurrent(factor, request)) factor.error = errorText(error);
  } finally {
    if (isCurrent(factor, request)) factor.busy = false;
  }
};
const disable2FACode = async () => {
  if (factor.busy) return;
  const request = begin(factor);
  try {
    const credentials = proof(factor);
    if (!validCode(factor.totp)) throw new Error(t("TXT_CODE_auth_current_code_required"));
    const result = await confirm2FA().execute({
      data: { enable: false as const, ...credentials, currentTOTP: factor.totp },
      ...securityRequest
    });
    if (!isCurrent(factor, request)) return;
    if (result.value?.enabled !== false || result.value.reloginRequired !== true)
      throw invalidResponse();
    securityUpdated();
  } catch (error) {
    if (isCurrent(factor, request)) factor.error = errorText(error);
  } finally {
    if (isCurrent(factor, request)) factor.busy = false;
  }
};
const cancelFactor = async () => {
  const setupId = setup.value?.setupId;
  clearFactor();
  const request = { epoch, version: factor.version };
  if (!setupId) return;
  try {
    await cancelSetup(setupId);
  } catch (error) {
    if (isCurrent(factor, request)) factor.error = errorText(error);
  }
};

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
    message.success(t("TXT_CODE_d3de39b4"));
  } catch (error: any) {
    reportErrorMsg(error.message);
  } finally {
    avatarUploading.value = false;
  }
};

const { currentThemeId, setThemeId } = useAppConfigStore();
const themeSaving = ref(false);

const chooseTheme = async (id: string) => {
  if (themeSaving.value || currentThemeId.value === id) return;
  const prev = currentThemeId.value;
  setThemeId(id); // live preview + localStorage mirror
  try {
    themeSaving.value = true;
    await updateMyTheme().execute({ data: { theme: id } });
    await updateUserInfo();
    message.success(t("TXT_CODE_d3de39b4"));
  } catch (error: any) {
    setThemeId(prev); // revert the optimistic apply
    reportErrorMsg(error.message);
  } finally {
    themeSaving.value = false;
  }
};
</script>

<template>
  <a-modal
    v-model:open="tools.showUserInfoDialog"
    centered
    :title="t('TXT_CODE_9bb2f08b')"
    :footer="null"
    @ok="tools.showUserInfoDialog = false"
  >
    <div>
      <a-form layout="vertical">
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
        <a-form-item :label="t('TXT_CODE_theme_label')">
          <div class="theme-grid">
            <div
              v-for="th in THEMES"
              :key="th.id"
              class="theme-swatch"
              :class="{ 'theme-swatch-active': currentThemeId === th.id }"
              role="button"
              tabindex="0"
              @click="chooseTheme(th.id)"
              @keydown.enter.prevent="chooseTheme(th.id)"
              @keydown.space.prevent="chooseTheme(th.id)"
            >
              <span class="theme-bar" :style="{ backgroundImage: th.headerGradient }"></span>
              <span class="theme-dot" :style="{ backgroundColor: th.accent }"></span>
              <span class="theme-name">{{ t(th.nameKey) }}</span>
            </div>
          </div>
        </a-form-item>
        <a-row>
          <a-col :span="12">
            <a-form-item :label="t('TXT_CODE_eb9fcdad')">
              <a-tag>{{ state.userInfo?.userName }}</a-tag>
            </a-form-item>
          </a-col>
          <a-col>
            <a-form-item :label="t('TXT_CODE_63ccbf90')">
              <a-tag>{{ PERMISSION_MAP[String(state.userInfo?.permission)] }}</a-tag>
            </a-form-item>
          </a-col>
        </a-row>

        <a-row>
          <a-col :span="12">
            <a-form-item :label="t('TXT_CODE_c5c56801')">
              <a-tag>{{ state.userInfo?.registerTime }}</a-tag>
            </a-form-item>
          </a-col>
          <a-col>
            <a-form-item :label="t('TXT_CODE_d7ee9ba')">
              <a-tag>{{ state.userInfo?.loginTime }}</a-tag>
            </a-form-item>
          </a-col>
        </a-row>

        <a-form-item :label="t('TXT_CODE_1d9d0746')">
          <a-tag>{{ state.userInfo?.uuid }}</a-tag>
        </a-form-item>

        <a-form-item :label="t('TXT_CODE_551b0348')">
          <a-button v-if="!password.open" danger @click="password.open = true">
            {{ t("TXT_CODE_50d471b2") }}
          </a-button>
          <section
            v-else
            class="security-action"
            data-security="password"
            :aria-busy="password.busy"
          >
            <p v-if="state.settings.ssoEnabled">{{ t("TXT_CODE_auth_password_sso_help") }}</p>
            <label for="security-password-current">{{ t("TXT_CODE_auth_current_password") }}</label>
            <a-input-password
              id="security-password-current"
              v-model:value="password.current"
              autocomplete="current-password"
              :disabled="password.busy"
            />
            <label v-if="state.userInfo?.open2FA" for="security-password-totp">{{
              t("TXT_CODE_auth_current_authenticator")
            }}</label>
            <a-input
              v-if="state.userInfo?.open2FA"
              id="security-password-totp"
              v-model:value="password.totp"
              inputmode="numeric"
              autocomplete="one-time-code"
              :maxlength="6"
              :disabled="password.busy"
            />
            <label for="security-password-new">{{ t("TXT_CODE_auth_new_password") }}</label>
            <a-input-password
              id="security-password-new"
              v-model:value="password.next"
              autocomplete="new-password"
              :disabled="password.busy"
            />
            <label for="security-password-confirm">{{ t("TXT_CODE_auth_confirm_password") }}</label>
            <a-input-password
              id="security-password-confirm"
              v-model:value="password.confirm"
              autocomplete="new-password"
              :disabled="password.busy"
              @pressEnter="handleChangePassword"
            />
            <div class="security-buttons">
              <a-button :loading="password.busy" @click="handleChangePassword">{{
                t("TXT_CODE_d507abff")
              }}</a-button>
              <a-button @click="clearPassword">{{ t("TXT_CODE_auth_cancel") }}</a-button>
            </div>
            <p v-if="password.error" role="alert">{{ password.error }}</p>
          </section>
        </a-form-item>

        <a-form-item :label="t('TXT_CODE_61eae8a6')">
          <div v-if="!factor.action" class="security-buttons">
            <a-button
              @click="
                factor.action = 'setup';
                factor.notice = '';
                factor.error = '';
              "
            >
              {{
                factor.notice
                  ? t("TXT_CODE_auth_restart_setup")
                  : state.userInfo?.open2FA
                  ? t("TXT_CODE_85a33a84")
                  : t("TXT_CODE_a492ae63")
              }}
            </a-button>
            <a-button
              v-if="state.userInfo?.open2FA"
              danger
              @click="
                factor.action = 'disable';
                factor.notice = '';
                factor.error = '';
              "
              >{{ t("TXT_CODE_edd64e4d") }}</a-button
            >
          </div>
          <p v-if="factor.notice" role="status">{{ factor.notice }}</p>
          <section
            v-if="factor.action"
            class="security-action"
            data-security="factor"
            :aria-busy="factor.busy"
          >
            <p v-if="state.userInfo?.open2FA && factor.action === 'setup'">
              {{ t("TXT_CODE_auth_factor_preserved") }}
            </p>
            <template v-if="!setup">
              <template v-if="state.settings.ssoEnabled">
                <p>{{ t("TXT_CODE_auth_sso_help") }}</p>
                <a-checkbox
                  v-model:checked="factor.sso"
                  :disabled="factor.busy"
                  @change="factor.current = ''"
                  >{{ t("TXT_CODE_auth_use_sso") }}</a-checkbox
                >
              </template>
              <label
                v-if="!factor.sso || !state.settings.ssoEnabled"
                for="security-factor-current"
                >{{ t("TXT_CODE_auth_current_password") }}</label
              >
              <a-input-password
                v-if="!factor.sso || !state.settings.ssoEnabled"
                id="security-factor-current"
                v-model:value="factor.current"
                autocomplete="current-password"
                :disabled="factor.busy"
                @pressEnter="factor.action === 'setup' ? handleBind2FA() : disable2FACode()"
              />
              <label v-if="state.userInfo?.open2FA" for="security-factor-totp">{{
                t("TXT_CODE_auth_current_authenticator")
              }}</label>
              <a-input
                v-if="state.userInfo?.open2FA"
                id="security-factor-totp"
                v-model:value="factor.totp"
                inputmode="numeric"
                autocomplete="one-time-code"
                :maxlength="6"
                :disabled="factor.busy"
                @pressEnter="factor.action === 'setup' ? handleBind2FA() : disable2FACode()"
              />
              <div class="security-buttons">
                <a-button
                  v-if="factor.action === 'setup'"
                  :loading="factor.busy"
                  @click="handleBind2FA"
                  >{{ t("TXT_CODE_auth_start_setup") }}</a-button
                >
                <a-button v-else danger :loading="factor.busy" @click="disable2FACode">{{
                  t("TXT_CODE_edd64e4d")
                }}</a-button>
                <a-button @click="cancelFactor">{{ t("TXT_CODE_auth_cancel") }}</a-button>
              </div>
            </template>
            <template v-else>
              <p>{{ t("TXT_CODE_auth_scan_new") }}</p>
              <p role="timer" aria-live="off">
                {{ t("TXT_CODE_auth_setup_expiry", { time: expiryText }) }}
              </p>
              <img :src="setup.qrcode" class="security-qr" :alt="t('TXT_CODE_auth_qr_alt')" />
              <label for="security-factor-new">{{ t("TXT_CODE_auth_new_authenticator") }}</label>
              <a-input
                id="security-factor-new"
                v-model:value="factor.code"
                inputmode="numeric"
                autocomplete="one-time-code"
                :maxlength="6"
                :disabled="factor.busy"
                @pressEnter="confirm2FACode"
              />
              <div class="security-buttons">
                <a-button :loading="factor.busy" @click="confirm2FACode">{{
                  t("TXT_CODE_auth_confirm_factor")
                }}</a-button>
                <a-button @click="cancelFactor">{{ t("TXT_CODE_auth_cancel") }}</a-button>
              </div>
            </template>
          </section>
          <p v-if="factor.error" role="alert">{{ factor.error }}</p>
        </a-form-item>
        <a-form-item label="APIKEY">
          <a-typography-paragraph>{{ t("TXT_CODE_b2dbf778") }}</a-typography-paragraph>
          <a-typography-paragraph v-if="state.userInfo?.apiKey">
            <pre
              class="security-key">{{ state.userInfo.apiKey }}<CopyButton size="small" type="text" :value="state.userInfo.apiKey" /></pre>
          </a-typography-paragraph>
          <a-typography-paragraph v-else>
            <pre>{{ t("TXT_CODE_d7dbc7c2") }}</pre>
          </a-typography-paragraph>
          <div v-if="api.action === undefined" class="security-buttons">
            <a-button @click="api.action = true">{{ t("TXT_CODE_d51cd7ae") }}</a-button>
            <a-button v-if="state.userInfo?.apiKey" danger @click="api.action = false">{{
              t("TXT_CODE_718c9310")
            }}</a-button>
          </div>
          <section v-else class="security-action" data-security="api" :aria-busy="api.busy">
            <p>{{ api.action ? t("TXT_CODE_d51cd7ae") : t("TXT_CODE_6819de18") }}</p>
            <template v-if="state.settings.ssoEnabled">
              <p>{{ t("TXT_CODE_auth_sso_help") }}</p>
              <a-checkbox
                v-model:checked="api.sso"
                :disabled="api.busy"
                @change="api.current = ''"
                >{{ t("TXT_CODE_auth_use_sso") }}</a-checkbox
              >
            </template>
            <label v-if="!api.sso || !state.settings.ssoEnabled" for="security-api-current">{{
              t("TXT_CODE_auth_current_password")
            }}</label>
            <a-input-password
              v-if="!api.sso || !state.settings.ssoEnabled"
              id="security-api-current"
              v-model:value="api.current"
              autocomplete="current-password"
              :disabled="api.busy"
              @pressEnter="handleGenerateApiKey"
            />
            <label v-if="state.userInfo?.open2FA" for="security-api-totp">{{
              t("TXT_CODE_auth_current_authenticator")
            }}</label>
            <a-input
              v-if="state.userInfo?.open2FA"
              id="security-api-totp"
              v-model:value="api.totp"
              inputmode="numeric"
              autocomplete="one-time-code"
              :maxlength="6"
              :disabled="api.busy"
              @pressEnter="handleGenerateApiKey"
            />
            <div class="security-buttons">
              <a-button
                :danger="api.action === false"
                :loading="api.busy"
                @click="handleGenerateApiKey"
                >{{ api.action ? t("TXT_CODE_d51cd7ae") : t("TXT_CODE_718c9310") }}</a-button
              >
              <a-button @click="clearApi">{{ t("TXT_CODE_auth_cancel") }}</a-button>
            </div>
            <p v-if="api.error" role="alert">{{ api.error }}</p>
          </section>
        </a-form-item>
      </a-form>
    </div>
  </a-modal>
</template>

<style lang="scss" scoped>
.security-action {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.security-action p {
  margin: 0;
}
.security-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.security-qr {
  width: 180px;
  max-width: 100%;
  height: auto;
  border-radius: 6px;
}
.security-key {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.theme-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.theme-swatch {
  border: 2px solid var(--color-gray-5, #d9d9d9);
  border-radius: 8px;
  padding: 8px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: border-color 0.2s;
}
.theme-swatch:hover {
  border-color: var(--nx-accent, #3179bd);
}
.theme-swatch-active {
  border-color: var(--nx-accent, #3179bd);
}
.theme-bar {
  height: 22px;
  border-radius: 4px;
  display: block;
}
.theme-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: inline-block;
}
.theme-name {
  font-size: 12px;
}
</style>
