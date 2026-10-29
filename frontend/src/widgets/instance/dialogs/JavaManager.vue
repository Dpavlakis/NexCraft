<script setup lang="ts">
import { useAddJavaDialog, useDownloadJavaDialog } from "@/components/fc";
import { t } from "@/lang/i18n";
import { getInstanceInfo } from "@/services/apis/instance";
import {
  addJava,
  deleteJava,
  downloadJava,
  getJavaList,
  usingJava
} from "@/services/apis/javaManager";
import { parseTimestamp } from "@/tools/time";
import type { InstanceDetail } from "@/types";
import type { AntColumnsType } from "@/types/ant";
import type { JavaInfo, JavaRuntime } from "@/types/javaManager";
import {
  DeleteOutlined,
  DownloadOutlined,
  PlusOutlined,
  ReloadOutlined
} from "@ant-design/icons-vue";
import { message } from "ant-design-vue";
import { h, onBeforeUnmount, ref, type Ref } from "vue";

const props = defineProps<{
  instanceInfo?: InstanceDetail;
  daemonId?: string;
  instanceId?: string;
}>();

const columns: AntColumnsType[] = [
  {
    align: "center",
    title: t("TXT_CODE_151d2bb7"),
    dataIndex: ["info", "fullname"],
    key: "fullname"
  },
  {
    align: "center",
    title: t("TXT_CODE_a2e79565"),
    dataIndex: ["info", "installTime"],
    key: "installTime",
    customRender: (e: { text: number }) => t(parseTimestamp(e.text))
  },
  {
    align: "center",
    title: t("TXT_CODE_759fb403"),
    key: "status",
    customRender: ({ record }: { record: JavaRuntime }) => {
      return t(record.info.downloading ? "TXT_CODE_java_downloading" : "TXT_CODE_java_installed");
    }
  },
  {
    align: "center",
    title: t("TXT_CODE_fe731dfc"),
    key: "actions",
    width: 250
  }
];

const open = ref(false);
const busy = ref("");
const listLoading = ref(false);
const selectionRefreshNeeded = ref(false);
let active = true;
onBeforeUnmount(() => {
  active = false;
});

const selectionContext = () => ({
  instanceInfo: props.instanceInfo,
  config: props.instanceInfo?.config,
  startCommand: props.instanceInfo?.config.startCommand,
  daemonId: props.daemonId ?? "",
  instanceId: props.instanceId ?? ""
});
const isCurrentSelection = (context: ReturnType<typeof selectionContext>) =>
  active &&
  props.instanceInfo === context.instanceInfo &&
  props.instanceInfo?.config === context.config &&
  (props.daemonId ?? "") === context.daemonId &&
  (props.instanceId ?? "") === context.instanceId;

const refreshSavedJava = async (context: ReturnType<typeof selectionContext>) => {
  try {
    const response = await getInstanceInfo().execute({
      forceRequest: true,
      params: { daemonId: context.daemonId, uuid: context.instanceId }
    });
    if (!isCurrentSelection(context) || !context.config) return false;
    const saved = response.value?.config;
    if (typeof saved?.java?.id !== "string" || typeof saved.startCommand !== "string") return false;
    context.config.java.id = saved.java.id;
    // A command edited while the request was pending needs explicit reconciliation.
    if (context.config.startCommand !== context.startCommand) return false;
    context.config.startCommand = saved.startCommand;
    return true;
  } catch {
    return false;
  }
};
const javaList: Ref<JavaRuntime[] | undefined> = ref([]);
const openDialog = async () => {
  open.value = true;
  await refreshJavaList();
};

const close = async () => {
  open.value = false;
};

const refreshJavaList = async (out: boolean = false, reportError: boolean = true) => {
  if (listLoading.value) return;
  listLoading.value = true;
  try {
    const list = await getJavaList().execute({
      forceRequest: true,
      params: {
        daemonId: props.daemonId ?? "",
        instanceId: props.instanceId ?? ""
      }
    });
    javaList.value = list.value;
    if (out) message.success(t("TXT_CODE_fbde647e"));
    return true;
  } catch (err: any) {
    if (reportError) message.error(err.message);
    return false;
  } finally {
    listLoading.value = false;
  }
};

const refreshDetails = async () => {
  if (busy.value || listLoading.value) return;
  if (!selectionRefreshNeeded.value) return refreshJavaList(true);
  busy.value = "refresh";
  const context = selectionContext();
  try {
    const saved = await refreshSavedJava(context);
    const listed = await refreshJavaList(false, false);
    if (!isCurrentSelection(context)) return;
    selectionRefreshNeeded.value = !(saved && listed);
    if (!selectionRefreshNeeded.value) message.success(t("TXT_CODE_fbde647e"));
  } finally {
    busy.value = "";
  }
};

const handleDownloadJava = async () => {
  if (busy.value || listLoading.value) return;
  busy.value = "download";
  try {
    const installedList = javaList.value?.map((item) => item.info.fullname) ?? [];
    const data = await useDownloadJavaDialog(installedList, props.daemonId ?? "");
    if (!data) return;
    const result = await downloadJava().execute({
      params: { daemonId: props.daemonId ?? "", instanceId: props.instanceId ?? "" },
      data: { name: data.name, version: data.version, downloadUrl: data.downloadUrl }
    });
    if (result.value !== true) throw new Error(t("TXT_CODE_java_not_confirmed"));
    message.success(t("TXT_CODE_5e7a4c02"));
    await refreshJavaList();
  } catch (err: any) {
    message.error(err.message);
  } finally {
    busy.value = "";
  }
};

const handleAddJava = async () => {
  if (busy.value || listLoading.value) return;
  busy.value = "add";
  try {
    const data = await useAddJavaDialog();
    if (!data) return;
    const result = await addJava().execute({
      params: { daemonId: props.daemonId ?? "" },
      data: { name: data.name, path: data.path }
    });
    if (result.value !== true) throw new Error(t("TXT_CODE_java_not_confirmed"));
    message.success(t("TXT_CODE_10f0f8d"));
    await refreshJavaList();
  } catch (err: any) {
    message.error(err.message);
  } finally {
    busy.value = "";
  }
};

const handleDeleteJava = async (info: JavaInfo) => {
  if (busy.value || listLoading.value || info.downloading) return;
  busy.value = "delete:" + info.fullname;
  try {
    const result = await deleteJava().execute({
      params: { daemonId: props.daemonId ?? "", instanceId: props.instanceId ?? "" },
      data: { id: info.fullname }
    });
    if (result.value !== true) throw new Error(t("TXT_CODE_java_not_confirmed"));
    await refreshJavaList();
  } catch (err: any) {
    message.error(err.message);
  } finally {
    busy.value = "";
  }
};

const handleUsingJava = async (info: JavaInfo) => {
  if (busy.value || listLoading.value || info.downloading) return;
  busy.value = "select:" + info.fullname;
  const context = selectionContext();
  try {
    const result = await usingJava().execute({
      params: { daemonId: context.daemonId, instanceId: context.instanceId },
      data: { id: info.fullname }
    });
    if (result.value !== true) throw new Error(t("TXT_CODE_java_not_confirmed"));
    if (!isCurrentSelection(context)) return;
    if (context.config) context.config.java.id = info.fullname;
    message.success(t("TXT_CODE_java_saved"));
    const saved = await refreshSavedJava(context);
    const listed = await refreshJavaList(false, false);
    if (isCurrentSelection(context)) selectionRefreshNeeded.value = !(saved && listed);
  } catch (err: any) {
    if (isCurrentSelection(context)) message.error(err.message);
  } finally {
    busy.value = "";
  }
};

defineExpose({
  openDialog
});
</script>

<template>
  <a-modal
    v-model:open="open"
    width="92%"
    wrap-class-name="nexcraft-wide-modal"
    centered
    :title="t('TXT_CODE_3fee13ed')"
    :confirm-loading="!!busy"
    @close="close"
  >
    <div>
      <a-alert
        v-if="selectionRefreshNeeded"
        type="warning"
        show-icon
        class="mb-12"
        :message="t('TXT_CODE_java_refresh_needed')"
      />
      <a-typography-paragraph>
        <a-typography-text type="secondary">
          {{ t("TXT_CODE_java_selection_help") }}
          <br />
          {{ t("TXT_CODE_java_script_help") }}
        </a-typography-text>
      </a-typography-paragraph>

      <div class="items-right">
        <a-button
          type="link"
          :icon="h(PlusOutlined)"
          :disabled="!!busy || listLoading"
          :loading="busy === 'add'"
          @click="handleAddJava()"
        >
          {{ t("TXT_CODE_8900e7ee") }}
        </a-button>

        <a-button
          type="link"
          :icon="h(DownloadOutlined)"
          :disabled="!!busy || listLoading"
          :loading="busy === 'download'"
          @click="handleDownloadJava()"
        >
          {{ t("TXT_CODE_9c48100e") }}
        </a-button>

        <a-button
          :icon="h(ReloadOutlined)"
          type="text"
          :disabled="!!busy"
          :loading="listLoading || busy === 'refresh'"
          @click="refreshDetails"
        >
          {{ t("TXT_CODE_b76d94e0") }}
        </a-button>
      </div>

      <a-table
        class="mt-12"
        :data-source="javaList"
        :loading="listLoading"
        :row-key="(record: JavaRuntime) => record.info.fullname"
        :columns="columns"
        :scroll="{ x: 'max-content' }"
        :pagination="{
          pageSize: 15
        }"
      >
        <template #bodyCell="{ column, record }">
          <div v-if="column.key === 'status'" class="java-runtime-status">
            <span>{{
              t(record.info.downloading ? "TXT_CODE_java_downloading" : "TXT_CODE_java_installed")
            }}</span>
            <a-tag v-if="record.info.fullname === instanceInfo?.config.java.id" color="blue">
              {{ t("TXT_CODE_java_selected") }} · {{ t("TXT_CODE_java_next_start") }}
            </a-tag>
            <span v-if="record.usingInstances.includes(instanceId)" class="java-runtime-usage">
              {{ t("TXT_CODE_java_running_here") }}
            </span>
            <span
              v-if="record.usingInstances.filter((id: string) => id !== instanceId).length"
              class="java-runtime-usage"
            >
              {{
                t("TXT_CODE_java_running_other", {
                  count: record.usingInstances.filter((id: string) => id !== instanceId).length
                })
              }}
            </span>
          </div>
          <div v-else-if="column.key === 'actions'" class="flex justify-end">
            <a-button
              v-if="record.info.fullname == instanceInfo?.config.java.id"
              class="mr-8"
              type="link"
              :disabled="true"
            >
              {{ t("TXT_CODE_java_selected") }}
            </a-button>
            <a-button
              v-else
              class="mr-8"
              type="link"
              :disabled="record.info.downloading || !!busy || listLoading"
              :loading="busy === 'select:' + record.info.fullname"
              @click="handleUsingJava(record.info as JavaInfo)"
            >
              {{ t("TXT_CODE_java_select") }}
            </a-button>
            <a-popconfirm
              :disabled="record.info.downloading || !!busy || listLoading"
              :title="t('TXT_CODE_f4f86ba8')"
              :description="t('TXT_CODE_35631d1d')"
              @confirm="handleDeleteJava(record.info as JavaInfo)"
            >
              <a-button
                danger
                type="link"
                :disabled="record.info.downloading || !!busy || listLoading"
                :loading="busy === 'delete:' + record.info.fullname"
              >
                {{ t("TXT_CODE_ecbd7449") }}
                <DeleteOutlined />
              </a-button>
            </a-popconfirm>
          </div>
        </template>
      </a-table>
    </div>

    <template #footer>
      <a-button type="primary" @click="close">{{ t("TXT_CODE_31e92ef3") }}</a-button>
    </template>
  </a-modal>
</template>

<style scoped>
.java-runtime-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.java-runtime-status .ant-tag {
  margin-inline-end: 0;
  white-space: normal;
}
.java-runtime-usage {
  color: var(--color-gray-8);
  font-size: 12px;
}
</style>
