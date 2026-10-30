import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import ServerGroup from "@/widgets/instance/ServerGroup.vue";

vi.mock("@/lang/i18n", () => ({ t: (key: string) => key }));
const hosts: VueWrapper[] = [];
afterEach(() => {
  hosts.splice(0).forEach((host) => host.unmount());
});
const host = (kind: "modpack" | "custom" = "modpack") => {
  const wrapper = mount(ServerGroup, {
    attachTo: document.body,
    props: { kind, count: 2 },
    slots: { default: "<button data-server-card>server control</button>" }
  });
  hosts.push(wrapper);
  return wrapper;
};

describe("server group chevron", () => {
  it("renders a decorative SVG chevron and preserves the native disclosure button", () => {
    const group = host();
    const toggle = group.get(".server-group-toggle");
    expect(toggle.element.tagName).toBe("BUTTON");
    expect(toggle.attributes("type")).toBe("button");
    expect(toggle.attributes("aria-expanded")).toBe("true");
    const chevron = toggle.get(".server-group-chevron");
    expect(chevron.attributes("aria-hidden")).toBe("true");
    expect(chevron.get("svg").attributes("data-icon")).toBe("down");
    expect(chevron.get("svg").attributes("focusable")).toBe("false");
    expect(chevron.text()).toBe("");
    expect(toggle.text()).toContain("TXT_CODE_server_groups_modpack");
    expect(group.get(".server-group-count").text()).toBe("2 TXT_CODE_server_groups_on_page");
  });

  it("keeps focus on the same native button while toggling content and disclosure state", async () => {
    const group = host();
    const button = group.get<HTMLButtonElement>(".server-group-toggle");
    button.element.focus();
    expect(document.activeElement).toBe(button.element);
    button.element.click();
    await nextTick();
    expect(button.attributes("aria-expanded")).toBe("false");
    expect(group.find("[data-server-card]").exists()).toBe(false);
    expect(document.activeElement).toBe(button.element);
    button.element.click();
    await nextTick();
    expect(button.attributes("aria-expanded")).toBe("true");
    expect(group.find("[data-server-card]").exists()).toBe(true);
    expect(document.activeElement).toBe(button.element);
  });

  it("shows the expanded state during batch selection and restores the collapsed preference", async () => {
    const group = host();
    const button = group.get(".server-group-toggle");
    await button.trigger("click");
    await group.setProps({ forceOpen: true });
    expect(button.attributes("aria-expanded")).toBe("true");
    expect(button.attributes("aria-disabled")).toBe("true");
    expect(group.find("[data-server-card]").exists()).toBe(true);
    await button.trigger("click");
    expect(button.attributes("aria-expanded")).toBe("true");
    await group.setProps({ forceOpen: false });
    expect(button.attributes("aria-expanded")).toBe("false");
    expect(group.find("[data-server-card]").exists()).toBe(false);
  });

  it("keeps group collapse state independent and updates the count without resetting it", async () => {
    const modpack = host("modpack");
    const custom = host("custom");
    await modpack.get(".server-group-toggle").trigger("click");
    await modpack.setProps({ count: 3 });
    expect(modpack.get(".server-group-toggle").attributes("aria-expanded")).toBe("false");
    expect(modpack.get(".server-group-count").text()).toBe("3 TXT_CODE_server_groups_on_page");
    expect(custom.get(".server-group-toggle").attributes("aria-expanded")).toBe("true");
  });
});
