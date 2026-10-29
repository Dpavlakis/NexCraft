import { t } from "@/lang/i18n";
import { Modal } from "ant-design-vue";

export function confirmServerPropertiesSave(path: string, changed: boolean): Promise<boolean> {
  if (!changed || path.replace(/\\/g, "/").split("/").pop() !== "server.properties") {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    Modal.confirm({
      title: t("TXT_CODE_config_properties_save_title"),
      content: t("TXT_CODE_config_properties_save_help"),
      okText: t("TXT_CODE_abfe9512"),
      cancelText: t("TXT_CODE_3b1cc020"),
      onOk: () => {
        resolve(true);
      },
      onCancel: () => {
        resolve(false);
      },
      afterClose: () => {
        resolve(false);
      }
    });
  });
}
