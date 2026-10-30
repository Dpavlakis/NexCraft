<script setup lang="ts">
import { h, onBeforeUnmount, ref } from "vue";
import { t } from "@/lang/i18n";
import { Modal } from "ant-design-vue";

import { batchDelete } from "@/services/apis/instance";
import { reportErrorMsg } from "@/tools/validator";

const props = defineProps<{
  // eslint-disable-next-line no-unused-vars
  emitResult: (ok: boolean) => void;
  destroyComponent: () => void;
  instanceId: string;
  daemonId: string;
  nickname?: string;
}>();

const target = { instanceId: props.instanceId, daemonId: props.daemonId, nickname: props.nickname };
let active = true;
let settled = false;
onBeforeUnmount(() => {
  active = false;
});
const finish = (ok: boolean) => {
  if (!active || settled) return;
  settled = true;
  isOpen.value = false;
  props.emitResult(ok);
  props.destroyComponent();
};

const deleteFiles = ref(false);
const isOpen = ref(true);
const submitBtnLoading = ref(false);

const submit = async (deleteFile: boolean | null = deleteFiles.value) => {
  if (!active || settled || submitBtnLoading.value) return;
  const { execute } = batchDelete();
  submitBtnLoading.value = true;
  try {
    const result = await execute({
      params: {
        daemonId: target.daemonId || ""
      },
      data: {
        uuids: [target.instanceId || ""],
        deleteFile: deleteFile || false
      }
    });
    if (
      !Array.isArray(result.value?.instances) ||
      !result.value.instances.some((instance) => instance?.instanceUuid === target.instanceId)
    ) {
      throw new Error(
        t("TXT_CODE_server_delete_unconfirmed", { name: target.nickname || target.instanceId })
      );
    }
    finish(true);
  } catch (error) {
    if (active && !settled) reportErrorMsg(error);
    finish(false);
  }
};

const onCancel = () => {
  finish(false);
};

const onDelete = async () => {
  if (!deleteFiles.value) return await submit();
  Modal.confirm({
    title: t("TXT_CODE_584d786d"),
    content: h("div", [
      h("strong", target.nickname || target.instanceId),
      h("p", t("TXT_CODE_90508729"))
    ]),
    okText: t("TXT_CODE_10088738"),
    onOk: async () => {
      await submit(true);
    },
    okType: "danger"
  });
};
</script>

<template>
  <a-modal :visible="isOpen" :title="t('TXT_CODE_a0e19f38')" @cancel="onCancel">
    <p v-if="target.nickname" class="delete-target">
      <strong>{{ target.nickname }}</strong
      ><br />{{ target.instanceId }}
    </p>
    <a-typography-paragraph>
      <a-typography-text>
        {{ t("TXT_CODE_1981470a") }}
      </a-typography-text>
    </a-typography-paragraph>

    <a-checkbox v-model:checked="deleteFiles">
      {{ t("TXT_CODE_7542201a") }}
    </a-checkbox>

    <template #footer>
      <a-button key="back" @click="onCancel">
        {{ t("TXT_CODE_a0451c97") }}
      </a-button>
      <a-button
        key="submit"
        :danger="deleteFiles"
        :loading="submitBtnLoading"
        type="primary"
        @click="onDelete"
      >
        {{ deleteFiles ? t("TXT_CODE_584d786d") : t("TXT_CODE_a0e19f38") }}
      </a-button>
    </template>
  </a-modal>
</template>

<style scoped>
.delete-target {
  overflow-wrap: anywhere;
}
</style>
