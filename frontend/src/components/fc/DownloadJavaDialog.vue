<script setup lang="ts">
import { t } from "@/lang/i18n";
import { javaMajors, javaVersions, type JavaReleaseItem } from "@/services/apis/javaManager";
import type { DownloadJavaConfigItem } from "@/types/javaManager";
import type { MountComponent } from "@/types/index";
import { reportErrorMsg } from "@/tools/validator";
import { onMounted, ref } from "vue";

const props = defineProps<MountComponent & { installedJavaList?: string[]; daemonId?: string }>();

const open = ref(true);

const vendors = [
  { value: "adoptium", label: "Adoptium (Temurin)" },
  { value: "zulu", label: "Azul Zulu" }
];
const vendor = ref("adoptium");
const majors = ref<number[]>([]);
const selectedMajor = ref<number | undefined>(undefined);
const releases = ref<JavaReleaseItem[]>([]);
const selected = ref<JavaReleaseItem | null>(null);
const loadingMajors = ref(false);
const loadingReleases = ref(false);

const columns = [
  { title: t("TXT_CODE_modpack_version"), dataIndex: "version", key: "version" },
  { title: "Type", dataIndex: "type", key: "type", width: 90 }
];

const selectRow = (r: JavaReleaseItem) => (selected.value = r);
const isSelected = (r: JavaReleaseItem) => !!selected.value && selected.value.version === r.version;

const fmtDate = (s?: string) => {
  if (!s) return "";
  const d = new Date(s);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString();
};

const loadReleases = async () => {
  const major = selectedMajor.value;
  if (major == null) return;
  selected.value = null;
  releases.value = [];
  loadingReleases.value = true;
  try {
    const { execute } = javaVersions();
    const res = await execute({
      params: { daemonId: props.daemonId ?? "", vendor: vendor.value, major }
    });
    releases.value = res.value || [];
    selected.value = releases.value[0] || null;
  } catch (err: any) {
    reportErrorMsg(err.message);
  } finally {
    loadingReleases.value = false;
  }
};

const loadMajors = async () => {
  majors.value = [];
  selectedMajor.value = undefined;
  releases.value = [];
  selected.value = null;
  loadingMajors.value = true;
  try {
    const { execute } = javaMajors();
    const res = await execute({ params: { daemonId: props.daemonId ?? "", vendor: vendor.value } });
    majors.value = (res.value || []).slice().sort((a, b) => b - a);
    selectedMajor.value = majors.value[0] ?? undefined;
    await loadReleases();
  } catch (err: any) {
    reportErrorMsg(err.message);
  } finally {
    loadingMajors.value = false;
  }
};

const onVendorChange = () => loadMajors();
const onMajorChange = () => loadReleases();

const cancel = async () => {
  open.value = false;
  if (props.destroyComponent) props.destroyComponent();
};

const submit = async () => {
  if (!selected.value) return;
  const result: DownloadJavaConfigItem = {
    name: selected.value.vendor,
    version: selected.value.version,
    downloadUrl: selected.value.downloadUrl
  };
  props.emitResult(result);
  await cancel();
};

onMounted(loadMajors);
</script>

<template>
  <a-modal
    v-model:open="open"
    width="760px"
    centered
    :title="t('TXT_CODE_84588601')"
    :closable="false"
    :destroy-on-close="true"
    @cancel="cancel"
  >
    <a-form layout="vertical">
      <a-form-item label="Vendor">
        <a-radio-group v-model:value="vendor" button-style="solid" @change="onVendorChange">
          <a-radio-button v-for="v in vendors" :key="v.value" :value="v.value">
            {{ v.label }}
          </a-radio-button>
        </a-radio-group>
      </a-form-item>

      <a-form-item :label="t('TXT_CODE_modpack_version')">
        <a-select
          v-model:value="selectedMajor"
          :loading="loadingMajors"
          style="width: 200px"
          @change="onMajorChange"
        >
          <a-select-option v-for="m in majors" :key="m" :value="m">Java {{ m }}</a-select-option>
        </a-select>
      </a-form-item>
    </a-form>

    <a-spin :spinning="loadingReleases">
      <a-table
        :data-source="releases"
        :columns="columns"
        size="small"
        :pagination="false"
        :scroll="{ y: 280 }"
        row-key="version"
        :custom-row="(record: JavaReleaseItem) => ({ onClick: () => selectRow(record) })"
        :row-class-name="(record: JavaReleaseItem) => (isSelected(record) ? 'java-row-selected' : '')"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'version'">
            <span>{{ record.version }}</span>
            <span style="opacity: 0.55; margin-left: 10px">{{ fmtDate(record.releaseTime) }}</span>
          </template>
        </template>
      </a-table>
    </a-spin>

    <template #footer>
      <a-button @click="cancel">{{ t("TXT_CODE_a0451c97") }}</a-button>
      <a-button type="primary" :disabled="!selected" @click="submit">
        {{ t("TXT_CODE_d507abff") }}
      </a-button>
    </template>
  </a-modal>
</template>

<style scoped>
:deep(.java-row-selected) > td {
  background: var(--color-blue-1, #e6f4ff) !important;
}
:deep(.ant-table-tbody) > tr {
  cursor: pointer;
}
</style>
