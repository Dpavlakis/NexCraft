<script setup lang="ts">
import { getFileConfigAddr } from "@/hooks/useFileManager";
import { QUICKSTART_METHOD } from "@/hooks/widgets/quickStartFlow";
import { t } from "@/lang/i18n";
import { createInstance as createInstanceApi, uploadAddress } from "@/services/apis/instance";
import uploadService, { UploadFiles } from "@/services/uploadService";
import { parseForwardAddress } from "@/tools/protocol";
import { reportErrorMsg } from "@/tools/validator";
import { defaultInstanceInfo } from "@/types/const";
import {
  InfoCircleOutlined,
  UploadOutlined
} from "@ant-design/icons-vue";
import type { FormInstance } from "ant-design-vue";
import { message, Modal, type UploadProps } from "ant-design-vue";
import type { Rule } from "ant-design-vue/es/form";
import { computed, createVNode, onUnmounted, reactive, ref } from "vue";
import { router } from "@/config/router";
import SelectUnzipCode from "../instance/dialogs/SelectUnzipCode.vue";
import ImportServerReview from "./ImportServerReview.vue";

const selectUnzipCodeDialog = ref<InstanceType<typeof SelectUnzipCode>>();

// Review/detect/finalize dialog opened after a compressed-package import succeeds.
const importReviewOpen = ref(false);
const importReviewUuid = ref("");
const importReviewDaemonId = ref("");

const goToTerminal = (instanceId: string, daemonId: string) => {
  router.push({
    path: "/instances/terminal",
    query: { daemonId, instanceId }
  });
};

const onImportReviewDone = (instanceUuid: string) => {
  importReviewOpen.value = false;
  goToTerminal(instanceUuid, importReviewDaemonId.value);
};
const emit = defineEmits(["nextStep"]);

const props = defineProps<{
  createMethod: QUICKSTART_METHOD;
  daemonId: string;
}>();

const zipCode = ref("utf-8");
const formRef = ref<FormInstance>();
const formData = reactive<IGlobalInstanceConfig>(defaultInstanceInfo);

const isImportMode = props.createMethod === QUICKSTART_METHOD.IMPORT;
const needUpload = isImportMode;

const rules: Record<string, Rule[]> = {
  nickname: [{ required: true, message: t("TXT_CODE_68a504b3") }],
  stopCommand: [{ required: true, message: t("TXT_CODE_83053cd5") }]
};

const uFile = ref<File>();

const beforeUpload: UploadProps["beforeUpload"] = async (file) => {
  uFile.value = file;

  if (isImportMode) {
    const extName = file.name.split(".").pop()?.toLowerCase() || "";
    if (!["zip", "jar"].includes(extName)) return reportErrorMsg(t("TXT_CODE_808e5ad9"));
    // NexCraft is UTF-8 only: skip the decompression-encoding prompt and use the
    // default (utf-8, already set on `zipCode`). One fewer click on import.
    finalConfirm();
  } else {
    finalConfirm();
  }

  return false;
};

const setUnzipCode = async (code: string) => {
  zipCode.value = code;
  finalConfirm();
};

const finalConfirm = async () => {
  try {
    await formRef.value?.validate();
  } catch (err: any) {
    return reportErrorMsg(t("TXT_CODE_47e21c80"));
  }
  const thisModal = Modal.confirm({
    title: t("TXT_CODE_2a3b0c17"),
    icon: createVNode(InfoCircleOutlined),
    content: needUpload ? t("TXT_CODE_e06841b5") : t("TXT_CODE_5deeefb5"),
    okText: t("TXT_CODE_d507abff"),
    async onOk() {
      thisModal.destroy();
      try {
        needUpload ? await selectedFile() : await createInstance();
      } catch (err: any) {
        return reportErrorMsg(err);
      }
    },
    onCancel() {}
  });
};

const uploadStarted = ref(false);
const uploadFileInstance = ref<UploadFiles>();
let uploadStartCallback: (() => void) | undefined = undefined;
let uploadEndCallback: (() => void) | undefined = undefined;
onUnmounted(() => {
  if (uploadFileInstance.value) {
    if (uploadStartCallback) uploadFileInstance.value.removeCallback("start", uploadStartCallback);
    if (uploadEndCallback) uploadFileInstance.value.removeCallback("end", uploadEndCallback);
  }
});

const { state: cfg, execute: getCfg } = uploadAddress();
const percentComplete = computed(() => {
  if (!uploadStarted.value) return 0;
  const uploadData = uploadService.uiData.value;
  if (!uploadData.current) return 0;
  return (uploadData.current[0] / uploadData.current[1]) * 100;
});

const percentText = () => {
  if (!uploadFileInstance.value) {
    return t("TXT_CODE_c17f6488");
  }

  if (uploadStarted.value) {
    return t("TXT_CODE_b625dbf0") + percentComplete.value.toFixed(0) + "%";
  } else {
    return t("TXT_CODE_f63c4be2", {
      n: uploadService.getFileNth(uploadFileInstance.value.id || "")
    });
  }
};

const selectedFile = async () => {
  try {
    if (!formData.cwd) formData.cwd = ".";
    if (formData.docker.image) formData.processType = "docker";
    await getCfg({
      params: {
        upload_dir: ".",
        daemonId: props.daemonId
      },
      data: formData
    });
    if (!cfg.value) throw new Error(t("TXT_CODE_e8ce38c2"));

    uploadStartCallback = () => {
      uploadStarted.value = true;
    };
    const addr = parseForwardAddress(getFileConfigAddr(cfg.value), "http");
    const task = uploadService.append(
      uFile.value!,
      addr,
      cfg.value.password,
      {
        overwrite: false,
        unzip: isImportMode,
        code: zipCode.value
      },
      (task) => {
        task.addCallback("start", uploadStartCallback!);
      }
    );
    uploadFileInstance.value = task;
    const instanceUuid = cfg.value.instanceUuid;
    uploadEndCallback = () => {
      message.success(t("TXT_CODE_d28c05df"));
      // After a compressed-package import, open the review/detect/finalize dialog.
      // Fall back to the legacy navigation if we somehow lack the uuid/daemonId.
      if (isImportMode && instanceUuid && props.daemonId) {
        importReviewUuid.value = instanceUuid;
        importReviewDaemonId.value = props.daemonId;
        importReviewOpen.value = true;
        return;
      }
      return emit("nextStep", instanceUuid);
    };
    task.addCallback("end", uploadEndCallback);
  } catch (err: any) {
    console.error(err);
    return reportErrorMsg(err.message);
  }
};

const {
  state: newInstanceInfo,
  execute: executeCreateInstance,
  isLoading: createInstanceLoading
} = createInstanceApi();
const createInstance = async () => {
  try {
    if (!formData.cwd) formData.cwd = ".";
    if (formData.docker.image) formData.processType = "docker";
    await executeCreateInstance({
      params: {
        daemonId: props.daemonId
      },
      data: formData
    });
    if (newInstanceInfo.value) emit("nextStep", newInstanceInfo.value.instanceUuid);
    return message.success(t("TXT_CODE_d28c05df"));
  } catch (err: any) {
    return reportErrorMsg(err.message);
  }
};
</script>

<template>
  <div style="text-align: left">
    <a-form ref="formRef" :rules="rules" :model="formData" layout="vertical" autocomplete="off">
      <a-row :gutter="20">
        <a-col :xs="24" :md="12">
          <a-form-item name="nickname">
            <a-typography-title :level="5" class="require-field">
              {{ t("TXT_CODE_f70badb9") }}
            </a-typography-title>
            <a-typography-paragraph>
              <a-typography-text type="secondary">
                {{ t("TXT_CODE_818928ba") }}
              </a-typography-text>
            </a-typography-paragraph>
            <a-input v-model:value="formData.nickname" :placeholder="t('TXT_CODE_475c5890')" />
          </a-form-item>
        </a-col>
      </a-row>

      <a-form-item>
        <a-typography-title :level="5" class="require-field">
          {{ t("TXT_CODE_f9b6e61b") }}
        </a-typography-title>
        <a-typography-paragraph>
          <a-typography-text type="secondary">
            {{ t("TXT_CODE_510bd294") }}
            <br />
            {{ t("TXT_CODE_1561198c") }}
          </a-typography-text>
        </a-typography-paragraph>
        <a-upload
          accept=".zip"
          :before-upload="beforeUpload"
          :max-count="1"
          :change="selectedFile"
          :disabled="percentComplete > 0 || uploadFileInstance != undefined"
        >
          <a-button
            :disabled="!formData.nickname"
            type="primary"
            :loading="percentComplete > 0 || uploadFileInstance != undefined"
          >
            <upload-outlined v-if="percentComplete == 0 && uploadFileInstance == undefined" />
            {{ percentText() }}
          </a-button>
        </a-upload>
      </a-form-item>
    </a-form>
  </div>

  <SelectUnzipCode ref="selectUnzipCodeDialog" @select-code="setUnzipCode" />

  <ImportServerReview
    :open="importReviewOpen"
    :daemon-id="importReviewDaemonId"
    :instance-uuid="importReviewUuid"
    @update:open="(v: boolean) => (importReviewOpen = v)"
    @done="onImportReviewDone"
  />
</template>

<style lang="scss" scoped>
.CardWrapper {
  min-height: 500px;
}

.btn-area {
  position: absolute;
  bottom: 16px;
  right: 16px;
}
</style>
