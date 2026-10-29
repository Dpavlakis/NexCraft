import { mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lang/i18n", () => ({ t: (key: string) => key }));
import ServerLayoutSwitch, { type ServerLayout } from "@/components/ServerLayoutSwitch.vue";

describe("production server layout keyboard control", () => {
  it("uses three named icon-only choices, roving focus and wrapping arrow/Home/End keys", async () => {
    const host = mount(
      defineComponent({
        setup() {
          const layout = ref<ServerLayout>("compact");
          return () =>
            h(ServerLayoutSwitch, {
              modelValue: layout.value,
              "onUpdate:modelValue": (value) => {
                layout.value = value;
              }
            });
        }
      }),
      { attachTo: document.body, global: { stubs: { "a-tooltip": { template: "<slot />" } } } }
    );
    const buttons = host.findAll("button");
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button.text()).toBe("");
      expect(button.attributes("aria-label")).toBeTruthy();
      expect(button.find("svg").exists()).toBe(true);
    }
    expect(buttons.map((b) => b.attributes("tabindex"))).toEqual(["0", "-1", "-1"]);
    await buttons[0].trigger("keydown", { key: "ArrowLeft" });
    expect(buttons[2].attributes("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(buttons[2].element);
    await buttons[2].trigger("keydown", { key: "ArrowRight" });
    expect(buttons[0].attributes("aria-checked")).toBe("true");
    await buttons[0].trigger("keydown", { key: "End" });
    expect(buttons[2].attributes("aria-checked")).toBe("true");
    await buttons[2].trigger("keydown", { key: "Home" });
    expect(buttons[0].attributes("aria-checked")).toBe("true");
    await buttons[1].trigger("click");
    expect(buttons[1].attributes("aria-checked")).toBe("true");
    host.unmount();
  });
});
