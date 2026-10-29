import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOMWrapper, flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import Antd, { message } from "ant-design-vue";
import axios, { type InternalAxiosRequestConfig } from "axios";
import labels from "../../../../languages/en_US.json";

const fixture = vi.hoisted(() => ({ state: null as any, tools: null as any, refresh: vi.fn() }));
vi.mock("@/stores/useAppStateStore", async () => {
  const { reactive } = await import("vue");
  fixture.state = reactive({ userInfo: null, settings: { ssoEnabled: false } });
  return { useAppStateStore: () => ({ state: fixture.state, updateUserInfo: fixture.refresh }) };
});
vi.mock("@/stores/useAppToolsStore", async () => {
  const { reactive } = await import("vue");
  fixture.tools = reactive({ showUserInfoDialog: true });
  return { useAppToolsStore: () => ({ state: fixture.tools }) };
});
vi.mock("@/stores/useAppConfigStore", async () => {
  const { ref } = await import("vue");
  return { useAppConfigStore: () => ({ currentThemeId: ref("default"), setThemeId: vi.fn() }) };
});
vi.mock("@/lang/i18n", () => ({
  t: (key: string, args?: Record<string, string>) => {
    let text = (labels as Record<string, string>)[key] || key;
    for (const [name, value] of Object.entries(args || {}))
      text = text.replace("{" + name + "}", value);
    return text;
  }
}));
vi.mock("@/components/UserAvatar.vue", () => ({ default: { template: "<span />" } }));
vi.mock("@/components/CopyButton.vue", () => ({ default: { template: "<span />" } }));
vi.mock("@/tools/validator", () => ({ reportErrorMsg: vi.fn() }));
import Dialog from "../MyselfInfoDialog.vue";
import { apiService } from "@/services/apiService";

let mounted: VueWrapper;
let wrapper: DOMWrapper<Element>;
let requests: InternalAxiosRequestConfig[];
let responder: (config: InternalAxiosRequestConfig) => unknown;
const t = (key: keyof typeof labels) => labels[key];
const section = (name: string) => wrapper.get('[data-security="' + name + '"]');
const click = async (text: string, target: any = wrapper) => {
  await nextTick();
  const button = target.findAll("button").find((item: any) => item.text().trim() === text);
  if (!button) throw new Error("Button missing: " + text);
  await button.trigger("click");
  await settle();
};
const input = async (id: string, value: string) => {
  await wrapper.get("#security-" + id).setValue(value);
};
const settle = async () => {
  await flushPromises();
  await nextTick();
};
const payload = (index = requests.length - 1) => JSON.parse(requests[index].data);
const pending = (id = "setup-a", expiresAt = Date.now() + 300000) => ({
  setupId: id,
  qrcode: "data:image/png;base64,cXJjb2Rl",
  expiresAt,
  replacing: !!fixture.state.userInfo.open2FA
});
const cache = () => (apiService as unknown as { responseMap: Map<string, unknown> }).responseMap;
const openPassword = async () => click(t("TXT_CODE_50d471b2"));
const openFactor = async () =>
  click(t(fixture.state.userInfo.open2FA ? "TXT_CODE_85a33a84" : "TXT_CODE_a492ae63"));
const openApi = async () => click(t("TXT_CODE_d51cd7ae"));
const fillPassword = async () => {
  await input("password-current", "OldPassword1");
  await input("password-new", "NewPassword2");
  await input("password-confirm", "NewPassword2");
};
const stage = async (id = "setup-a") => {
  await openFactor();
  await input("factor-current", "OldPassword1");
  if (fixture.state.userInfo.open2FA) await input("factor-totp", "123456");
  responder = () => pending(id);
  await click(t("TXT_CODE_auth_start_setup"), section("factor"));
};
const deferred = () => {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
};

beforeEach(async () => {
  vi.useFakeTimers({
    toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"]
  });
  vi.setSystemTime(new Date("2026-10-29T12:00:00Z"));
  window.matchMedia = vi
    .fn()
    .mockImplementation(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() }));
  const computedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => computedStyle(element));
  vi.spyOn(message, "success").mockImplementation(() =>
    Object.assign(() => {}, { then: Promise.resolve().then.bind(Promise.resolve()) })
  );
  fixture.state.userInfo = {
    uuid: "test-user",
    token: "browser-token",
    userName: "Test",
    permission: 10,
    open2FA: false,
    apiKey: "",
    avatar: ""
  };
  fixture.state.settings.ssoEnabled = false;
  fixture.tools.showUserInfoDialog = true;
  fixture.refresh.mockClear();
  requests = [];
  cache().clear();
  responder = () => true;
  axios.defaults.adapter = async (config) => {
    requests.push(config);
    const data = await responder(config);
    return {
      config,
      status: 200,
      statusText: "OK",
      headers: {},
      data: { status: 200, data, time: Date.now() }
    };
  };
  mounted = mount(Dialog, {
    attachTo: document.body,
    global: { plugins: [Antd], stubs: { transition: false, "transition-group": false } }
  });
  wrapper = new DOMWrapper(document.body);
  await settle();
});
afterEach(async () => {
  mounted.unmount();
  await settle();
  document.body.innerHTML = "";
  expect(cache().size).toBe(0);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("account security rendered form", () => {
  it("renders masked current/new/confirmation fields with autocomplete and labels", async () => {
    await openPassword();
    for (const [id, autocomplete] of [
      ["current", "current-password"],
      ["new", "new-password"],
      ["confirm", "new-password"]
    ]) {
      const field = wrapper.get("#security-password-" + id);
      expect(field.attributes("type")).toBe("password");
      expect(field.attributes("autocomplete")).toBe(autocomplete);
      expect(wrapper.get('label[for="security-password-' + id + '"]').text()).toBeTruthy();
    }
    await section("password").get(".ant-input-password-icon").trigger("click");
    expect(wrapper.get("#security-password-current").attributes("type")).toBe("text");
  });

  it("sends the exact password and active-factor payload then clears and announces relogin", async () => {
    fixture.state.userInfo.open2FA = true;
    await openPassword();
    await fillPassword();
    await input("password-totp", "123456");
    await click(t("TXT_CODE_d507abff"), section("password"));
    expect(payload()).toEqual({
      passWord: "NewPassword2",
      currentPassword: "OldPassword1",
      currentTOTP: "123456"
    });
    expect(requests[0]).toMatchObject({
      method: "put",
      url: "./api/auth/update",
      forceRequest: true,
      timeout: 15000
    });
    expect(fixture.tools.showUserInfoDialog).toBe(false);
    expect(fixture.state.userInfo).toBeNull();
    expect(message.success).toHaveBeenCalledWith(t("TXT_CODE_auth_relogin"));
    fixture.tools.showUserInfoDialog = true;
    fixture.state.userInfo = { token: "new-login" };
    await settle();
    await openPassword();
    expect(wrapper.get<HTMLInputElement>("#security-password-new").element.value).toBe("");
  });

  it("keeps password proof mandatory with SSO and blocks mismatched passwords and absent factor", async () => {
    fixture.state.settings.ssoEnabled = true;
    fixture.state.userInfo.open2FA = true;
    await openPassword();
    expect(section("password").text()).toContain(t("TXT_CODE_auth_password_sso_help"));
    await click(t("TXT_CODE_d507abff"), section("password"));
    expect(section("password").get('[role="alert"]').text()).toBe(
      t("TXT_CODE_auth_password_required")
    );
    await fillPassword();
    await click(t("TXT_CODE_d507abff"), section("password"));
    expect(section("password").get('[role="alert"]').text()).toBe(
      t("TXT_CODE_auth_current_code_required")
    );
    await input("password-totp", "123456");
    await input("password-confirm", "different");
    await click(t("TXT_CODE_d507abff"), section("password"));
    expect(requests).toHaveLength(0);
  });

  it.each([false, undefined])("does not accept %s as password success", async (result) => {
    responder = () => result;
    await openPassword();
    await fillPassword();
    await click(t("TXT_CODE_d507abff"), section("password"));
    expect(section("password").get('[role="alert"]').text()).toBe(
      t("TXT_CODE_auth_invalid_response")
    );
    expect(message.success).not.toHaveBeenCalled();
    expect(fixture.state.userInfo).not.toBeNull();
  });

  it("stages a replacement without changing the active factor and distinguishes the new code", async () => {
    fixture.state.userInfo.open2FA = true;
    await stage();
    expect(payload()).toEqual({ currentPassword: "OldPassword1", currentTOTP: "123456" });
    expect(requests[0]).toMatchObject({
      method: "post",
      url: "./api/auth/bind2fa",
      forceRequest: true,
      timeout: 15000
    });
    expect(fixture.state.userInfo.open2FA).toBe(true);
    expect(fixture.refresh).not.toHaveBeenCalled();
    expect(section("factor").text()).toContain(t("TXT_CODE_auth_factor_preserved"));
    expect(section("factor").text()).toContain(t("TXT_CODE_auth_new_authenticator"));
    expect(wrapper.find("#security-factor-current").exists()).toBe(false);
    expect(wrapper.get('[role="timer"]').text()).toContain("5:00");
    await input("factor-new", "654321");
    responder = () => ({ enabled: true, reloginRequired: true });
    await click(t("TXT_CODE_auth_confirm_factor"), section("factor"));
    expect(payload()).toEqual({ enable: true, setupId: "setup-a", TOTPCode: "654321" });
    expect(requests.some((r) => r.method === "delete")).toBe(false);
    expect(message.success).toHaveBeenCalledWith(t("TXT_CODE_auth_relogin"));
  });

  it("uses fresh SSO without sending a claimed proof or local password and shows recovery guidance", async () => {
    fixture.state.settings.ssoEnabled = true;
    await openFactor();
    expect(section("factor").text()).toContain(t("TXT_CODE_auth_sso_help"));
    await section("factor").get('input[type="checkbox"]').setValue(true);
    expect(wrapper.find("#security-factor-current").exists()).toBe(false);
    responder = () => pending();
    await click(t("TXT_CODE_auth_start_setup"), section("factor"));
    expect(payload()).toEqual({});
  });

  it("requires actual current-factor proof to disable, then accepts only explicit disabled/relogin response", async () => {
    fixture.state.userInfo.open2FA = true;
    await settle();
    await click(t("TXT_CODE_edd64e4d"));
    await input("factor-current", "OldPassword1");
    await click(t("TXT_CODE_edd64e4d"), section("factor"));
    expect(requests).toHaveLength(0);
    await input("factor-totp", "234567");
    responder = () => undefined;
    await click(t("TXT_CODE_edd64e4d"), section("factor"));
    expect(payload()).toEqual({
      enable: false,
      currentPassword: "OldPassword1",
      currentTOTP: "234567"
    });
    expect(wrapper.get('[role="alert"]').text()).toBe(t("TXT_CODE_auth_invalid_response"));
    responder = () => ({ enabled: false, reloginRequired: true });
    await click(t("TXT_CODE_edd64e4d"), section("factor"));
    expect(message.success).toHaveBeenCalledWith(t("TXT_CODE_auth_relogin"));
  });

  it("shows confirmation errors verbatim, preserves factor/setup, and clears QR/code on cancel", async () => {
    fixture.state.userInfo.open2FA = true;
    await stage();
    await input("factor-new", "654321");
    responder = () => {
      throw new Error("New code rejected; 4 attempts left");
    };
    await click(t("TXT_CODE_auth_confirm_factor"), section("factor"));
    expect(wrapper.get('[role="alert"]').text()).toBe("New code rejected; 4 attempts left");
    expect(wrapper.find(".security-qr").exists()).toBe(true);
    expect(fixture.state.userInfo.open2FA).toBe(true);
    responder = () => true;
    await click(t("TXT_CODE_auth_cancel"), section("factor"));
    expect(payload()).toEqual({ setupId: "setup-a" });
    expect(requests[requests.length - 1]).toMatchObject({
      method: "delete",
      url: "./api/auth/bind2fa",
      forceRequest: true,
      timeout: 15000
    });
    expect(wrapper.find(".security-qr").exists()).toBe(false);
    await openFactor();
    expect(wrapper.get<HTMLInputElement>("#security-factor-current").element.value).toBe("");
    expect(wrapper.get<HTMLInputElement>("#security-factor-totp").element.value).toBe("");
  });

  it("expires the setup, clears secrets, cancels that setup, and offers restart", async () => {
    fixture.state.userInfo.open2FA = true;
    await stage();
    await input("factor-new", "654321");
    responder = () => true;
    await vi.advanceTimersByTimeAsync(300000);
    await settle();
    expect(wrapper.find(".security-qr").exists()).toBe(false);
    expect(wrapper.find("#security-factor-new").exists()).toBe(false);
    expect(wrapper.text()).toContain(t("TXT_CODE_auth_setup_expired"));
    expect(payload()).toEqual({ setupId: "setup-a" });
    await click(t("TXT_CODE_auth_restart_setup"));
    expect(wrapper.get<HTMLInputElement>("#security-factor-current").element.value).toBe("");
    expect(fixture.state.userInfo.open2FA).toBe(true);
  });

  it("ignores and cancels a late setup after close/reopen without overwriting a newer QR", async () => {
    const old = deferred();
    responder = () => old.promise;
    await openFactor();
    await input("factor-current", "OldPassword1");
    await click(t("TXT_CODE_auth_start_setup"), section("factor"));
    fixture.tools.showUserInfoDialog = false;
    fixture.tools.showUserInfoDialog = true;
    await settle();
    await stage("setup-new");
    old.resolve(pending("setup-old"));
    responder = () => true;
    await settle();
    expect(payload()).toEqual({ setupId: "setup-old" });
    expect(wrapper.find(".security-qr").exists()).toBe(true);
    await input("factor-new", "654321");
    responder = () => ({ enabled: true, reloginRequired: true });
    await click(t("TXT_CODE_auth_confirm_factor"), section("factor"));
    expect(payload().setupId).toBe("setup-new");
  });

  it("ignores cancelled setup errors and cancelled password success after reopening", async () => {
    const oldFactor = deferred();
    responder = () => oldFactor.promise;
    await openFactor();
    await input("factor-current", "OldPassword1");
    await click(t("TXT_CODE_auth_start_setup"), section("factor"));
    await click(t("TXT_CODE_auth_cancel"), section("factor"));
    oldFactor.reject(new Error("stale factor error"));
    await settle();
    expect(wrapper.text()).not.toContain("stale factor error");
    const oldPassword = deferred();
    responder = () => oldPassword.promise;
    await openPassword();
    await fillPassword();
    await click(t("TXT_CODE_d507abff"), section("password"));
    fixture.tools.showUserInfoDialog = false;
    fixture.tools.showUserInfoDialog = true;
    await settle();
    oldPassword.resolve(true);
    await settle();
    expect(fixture.tools.showUserInfoDialog).toBe(true);
    expect(message.success).not.toHaveBeenCalled();
    await openPassword();
    expect(wrapper.get<HTMLInputElement>("#security-password-current").element.value).toBe("");
  });

  it("clears an active QR when authentication is lost", async () => {
    await stage();
    responder = () => true;
    fixture.state.userInfo = null;
    await settle();
    expect(wrapper.find(".security-qr").exists()).toBe(false);
    expect(payload()).toEqual({ setupId: "setup-a" });
  });

  it("keeps API loading/errors separate, prevents double submission, and cancels late key results", async () => {
    const outstanding = deferred();
    responder = () => outstanding.promise;
    await openApi();
    await input("api-current", "OldPassword1");
    await click(t("TXT_CODE_d51cd7ae"), section("api"));
    await click(t("TXT_CODE_d51cd7ae"), section("api"));
    expect(requests).toHaveLength(1);
    expect(section("api").attributes("aria-busy")).toBe("true");
    await openPassword();
    expect(section("password").attributes("aria-busy")).toBe("false");
    await click(t("TXT_CODE_d507abff"), section("password"));
    expect(section("password").get('[role="alert"]').text()).toBe(
      t("TXT_CODE_auth_password_required")
    );
    await click(t("TXT_CODE_auth_cancel"), section("api"));
    outstanding.resolve("late-key");
    await settle();
    expect(fixture.state.userInfo.apiKey).toBe("");
    expect(message.success).not.toHaveBeenCalled();
    await openApi();
    expect(wrapper.get<HTMLInputElement>("#security-api-current").element.value).toBe("");
  });

  it("generates/disables API keys with per-action proof and accepts an empty key only for disable", async () => {
    fixture.state.userInfo.open2FA = true;
    await openApi();
    await input("api-current", "OldPassword1");
    await input("api-totp", "123456");
    responder = () => "";
    await click(t("TXT_CODE_d51cd7ae"), section("api"));
    expect(section("api").get('[role="alert"]').text()).toBe(t("TXT_CODE_auth_invalid_response"));
    responder = () => "new-key";
    await click(t("TXT_CODE_d51cd7ae"), section("api"));
    expect(payload()).toEqual({
      enable: true,
      currentPassword: "OldPassword1",
      currentTOTP: "123456"
    });
    expect(requests[requests.length - 1]).toMatchObject({
      method: "put",
      url: "./api/auth/api",
      forceRequest: true,
      timeout: 15000
    });
    expect(fixture.state.userInfo.apiKey).toBe("new-key");
    await click(
      t("TXT_CODE_718c9310"),
      wrapper
        .findAll(".ant-form-item")
        .find((item) => item.find(".ant-form-item-label").text() === "APIKEY")
    );
    await input("api-current", "OldPassword1");
    await input("api-totp", "234567");
    responder = () => "";
    await click(t("TXT_CODE_718c9310"), section("api"));
    expect(payload()).toEqual({
      enable: false,
      currentPassword: "OldPassword1",
      currentTOTP: "234567"
    });
    expect(fixture.state.userInfo.apiKey).toBe("");
    expect(fixture.refresh).not.toHaveBeenCalled();
  });

  it("clears pending setup immediately on cancellation even when the server rejects cancellation", async () => {
    await stage();
    responder = () => {
      throw new Error("Cancel failed; try again");
    };
    await click(t("TXT_CODE_auth_cancel"), section("factor"));
    expect(wrapper.find(".security-qr").exists()).toBe(false);
    expect(wrapper.get('[role="alert"]').text()).toBe("Cancel failed; try again");
  });

  it.each([undefined, false, { enabled: false, reloginRequired: true }, { enabled: true }])(
    "does not accept an incomplete or incorrect enrollment response: %s",
    async (response) => {
      await stage();
      await input("factor-new", "654321");
      responder = () => response;
      await click(t("TXT_CODE_auth_confirm_factor"), section("factor"));
      expect(wrapper.get('[role="alert"]').text()).toBe(t("TXT_CODE_auth_invalid_response"));
      expect(wrapper.find(".security-qr").exists()).toBe(true);
      expect(message.success).not.toHaveBeenCalled();
    }
  );

  it("sends current-factor proof with SSO for API keys and preserves the server's expired-proof error", async () => {
    fixture.state.settings.ssoEnabled = true;
    fixture.state.userInfo.open2FA = true;
    await openApi();
    await input("api-current", "MustBeCleared1");
    await section("api").get('input[type="checkbox"]').setValue(true);
    await input("api-totp", "345678");
    responder = () => {
      throw new Error("SSO proof expired. Complete SSO sign-in again.");
    };
    await wrapper.get("#security-api-totp").trigger("keydown", { key: "Enter", keyCode: 13 });
    await settle();
    expect(payload()).toEqual({ enable: true, currentTOTP: "345678" });
    expect(section("api").get('[role="alert"]').text()).toBe(
      "SSO proof expired. Complete SSO sign-in again."
    );
    expect(fixture.state.userInfo.apiKey).toBe("");
    await section("api").get('input[type="checkbox"]').setValue(false);
    expect(wrapper.get<HTMLInputElement>("#security-api-current").element.value).toBe("");
  });

  it("clears all entered credentials through the actual modal close control", async () => {
    await openPassword();
    await fillPassword();
    await openApi();
    await input("api-current", "ApiPassword1");
    await stage();
    responder = () => true;
    await wrapper.get(".ant-modal-close").trigger("click");
    await settle();
    expect(fixture.tools.showUserInfoDialog).toBe(false);
    expect(payload()).toEqual({ setupId: "setup-a" });
    fixture.tools.showUserInfoDialog = true;
    await settle();
    expect(wrapper.find(".security-qr").exists()).toBe(false);
    await openPassword();
    await openApi();
    await openFactor();
    for (const id of [
      "password-current",
      "password-new",
      "password-confirm",
      "api-current",
      "factor-current"
    ]) {
      expect(wrapper.get<HTMLInputElement>("#security-" + id).element.value).toBe("");
    }
  });
});
