import { beforeEach, describe, expect, it, vi } from "vitest";
import labels from "../../../../languages/en_US.json";
const fixture = vi.hoisted(() => ({
  state: { userInfo: { apiKey: "" }, settings: { panelId: "panel" } },
  tools: { showUserInfoDialog: false },
  mint: vi.fn(),
  settings: vi.fn(),
  refreshNodes: vi.fn(),
  warning: vi.fn()
}));
vi.mock("@/stores/useAppStateStore", () => ({
  useAppStateStore: () => ({ state: fixture.state })
}));
vi.mock("@/stores/useAppToolsStore", () => ({
  useAppToolsStore: () => ({ state: fixture.tools })
}));
vi.mock("@/stores/useAppConfigStore", () => ({
  useAppConfigStore: () => ({ isDarkTheme: { value: false } })
}));
vi.mock("@/lang/i18n", () => ({
  t: (key: string) => (labels as Record<string, string>)[key] || key
}));
vi.mock("ant-design-vue", () => ({ message: { warning: fixture.warning } }));
vi.mock("@/services/apis/user", () => ({ setUserApiKey: fixture.mint }));
vi.mock("@/services/apis", () => ({ settingInfo: fixture.settings, setSettingInfo: vi.fn() }));
vi.mock("@/services/apis/redeem", () => ({ requestBuyInstance: vi.fn() }));
vi.mock("@/hooks/useRemoteNode", () => ({
  useRemoteNode: () => ({ refresh: fixture.refreshNodes })
}));
vi.mock("../IframeModal/useIframeModal", () => ({ openIframeModal: vi.fn() }));
vi.mock("../fc", () => ({ openMarketDialog: vi.fn() }));
import { autoOpenUserApiKey, iframeRouters } from "../IframeBox/handler";

beforeEach(() => {
  vi.clearAllMocks();
  fixture.state.userInfo.apiKey = "";
  fixture.tools.showUserInfoDialog = false;
});
describe("legacy iframe API-key recovery", () => {
  it("uses an existing key without proof requests or opening settings", async () => {
    fixture.state.userInfo.apiKey = "existing-key";
    await expect(autoOpenUserApiKey()).resolves.toEqual({ apiKey: "existing-key" });
    expect(fixture.tools.showUserInfoDialog).toBe(false);
    expect(fixture.warning).not.toHaveBeenCalled();
    expect(fixture.mint).not.toHaveBeenCalled();
  });
  it("opens account settings with localized explicit generation/retry guidance and no fake key", async () => {
    await expect(autoOpenUserApiKey()).rejects.toThrow(
      labels.TXT_CODE_auth_integration_key_required
    );
    expect(fixture.tools.showUserInfoDialog).toBe(true);
    expect(fixture.warning).toHaveBeenCalledWith(
      expect.objectContaining({ content: labels.TXT_CODE_auth_integration_key_required })
    );
    expect(fixture.mint).not.toHaveBeenCalled();
    expect(fixture.settings).not.toHaveBeenCalled();
    fixture.state.userInfo.apiKey = "explicitly-generated-key";
    fixture.tools.showUserInfoDialog = false;
    await expect(autoOpenUserApiKey()).resolves.toEqual({ apiKey: "explicitly-generated-key" });
    expect(fixture.tools.showUserInfoDialog).toBe(false);
  });
  it("stops daemon integration work until the user explicitly creates a key", async () => {
    await expect(iframeRouters.GetRemoteAppDaemons({})).rejects.toThrow(
      labels.TXT_CODE_auth_integration_key_required
    );
    expect(fixture.refreshNodes).not.toHaveBeenCalled();
    expect(fixture.mint).not.toHaveBeenCalled();
  });
  it("shows recovery guidance even when MainAppInfo returns its legacy fallback", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(iframeRouters.MainAppInfo({})).resolves.toMatchObject({ userInfo: null });
    expect(fixture.tools.showUserInfoDialog).toBe(true);
    expect(fixture.warning).toHaveBeenCalled();
    expect(fixture.settings).not.toHaveBeenCalled();
    expect(fixture.mint).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
