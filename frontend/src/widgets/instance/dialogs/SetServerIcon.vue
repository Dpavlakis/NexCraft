<script setup lang="ts">
import { t } from "@/lang/i18n";
import { saveServerIcon } from "@/services/apis/fileManager";
import { reportErrorMsg } from "@/tools/validator";
import { message } from "ant-design-vue";
import { ref } from "vue";

const props = defineProps<{
  daemonId: string;
  instanceId: string;
}>();

const open = ref(false);
const preview = ref(""); // 64x64 PNG data URL
const saving = ref(false);

const openDialog = () => {
  preview.value = "";
  open.value = true;
};

const onFile = (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, 64, 64);
    ctx.drawImage(img, 0, 0, 64, 64);
    preview.value = canvas.toDataURL("image/png");
    URL.revokeObjectURL(img.src);
  };
  img.onerror = () => {
    URL.revokeObjectURL(img.src);
    reportErrorMsg(t("TXT_CODE_server_icon_bad"));
  };
  img.src = URL.createObjectURL(file);
};

const save = async () => {
  if (!preview.value) return;
  saving.value = true;
  try {
    const { execute } = saveServerIcon();
    await execute({
      params: { uuid: props.instanceId, daemonId: props.daemonId },
      data: { base64: preview.value }
    });
    message.success(t("TXT_CODE_server_icon_saved"));
    open.value = false;
  } catch (err: any) {
    reportErrorMsg(err.message);
  } finally {
    saving.value = false;
  }
};

defineExpose({ openDialog });
</script>

<template>
  <a-modal
    v-model:open="open"
    :title="t('TXT_CODE_server_icon_title')"
    :confirm-loading="saving"
    :ok-button-props="{ disabled: !preview }"
    @ok="save"
  >
    <a-typography-paragraph type="secondary">
      {{ t("TXT_CODE_server_icon_desc") }}
    </a-typography-paragraph>
    <input type="file" accept="image/*" @change="onFile" />
    <div v-if="preview" class="preview-row">
      <img :src="preview" class="preview-img" width="64" height="64" alt="" />
      <span>{{ t("TXT_CODE_server_icon_preview") }}</span>
    </div>
  </a-modal>
</template>

<style lang="scss" scoped>
.preview-row {
  margin-top: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.preview-img {
  image-rendering: pixelated;
  border: 1px solid rgba(128, 128, 128, 0.3);
  border-radius: 4px;
}
</style>
