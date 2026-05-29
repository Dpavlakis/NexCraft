<script setup lang="ts">
import { t } from "@/lang/i18n";
import { fileList } from "@/services/apis/fileManager";
import { reportErrorMsg } from "@/tools/validator";
import { ArrowUpOutlined, FileOutlined, FolderOutlined } from "@ant-design/icons-vue";
import { ref } from "vue";

const props = defineProps<{
  daemonId: string;
  instanceId: string;
}>();

const emit = defineEmits<{
  (e: "update", patterns: string[]): void;
}>();

interface Entry {
  name: string;
  type: number; // 0 = directory, 1 = file
}

const open = ref(false);
const loading = ref(false);
const currentPath = ref("/");
const items = ref<Entry[]>([]);
// relative path -> isDir
const selected = ref(new Map<string, boolean>());

const fullRel = (name: string) => (currentPath.value + name).replace(/^\/+/, "");

const load = async (path: string) => {
  loading.value = true;
  try {
    const { execute } = fileList();
    const res = await execute({
      params: {
        daemonId: props.daemonId,
        uuid: props.instanceId,
        target: path,
        page: 0,
        page_size: 100,
        file_name: ""
      },
      forceRequest: true
    });
    const list = (res.value?.items || []).map((i) => ({ name: i.name, type: i.type }));
    list.sort((a, b) => a.type - b.type || a.name.localeCompare(b.name));
    items.value = list;
    currentPath.value = path;
  } catch (err: any) {
    reportErrorMsg(err.message);
  } finally {
    loading.value = false;
  }
};

const enterDir = (entry: Entry) => {
  if (entry.type !== 0) return;
  load(currentPath.value + entry.name + "/");
};

const goUp = () => {
  if (currentPath.value === "/") return;
  const trimmed = currentPath.value.replace(/\/+$/, "");
  const parent = trimmed.slice(0, trimmed.lastIndexOf("/") + 1) || "/";
  load(parent);
};

const isChecked = (entry: Entry) => selected.value.has(fullRel(entry.name));

const toggle = (entry: Entry) => {
  const rel = fullRel(entry.name);
  if (selected.value.has(rel)) selected.value.delete(rel);
  else selected.value.set(rel, entry.type === 0);
};

const removeSelected = (rel: string) => selected.value.delete(rel);

const openDialog = (current: string[] = []) => {
  const map = new Map<string, boolean>();
  for (const pat of current) {
    if (!pat) continue;
    if (pat.endsWith("/**")) map.set(pat.slice(0, -3), true);
    else map.set(pat, false);
  }
  selected.value = map;
  open.value = true;
  load("/");
};

const confirm = () => {
  const patterns: string[] = [];
  selected.value.forEach((isDir, rel) => {
    patterns.push(isDir ? `${rel}/**` : rel);
  });
  emit("update", patterns);
  open.value = false;
};

defineExpose({ openDialog });
</script>

<template>
  <a-modal
    v-model:open="open"
    :title="t('TXT_CODE_backup_exclusions_title')"
    :width="600"
    @ok="confirm"
  >
    <div class="exclusions-picker">
      <div class="toolbar mb-12">
        <a-button size="small" :disabled="currentPath === '/'" @click="goUp">
          <ArrowUpOutlined />
          {{ t("TXT_CODE_backup_up") }}
        </a-button>
        <a-typography-text class="ml-8" code>{{ currentPath }}</a-typography-text>
      </div>
      <a-spin :spinning="loading">
        <div class="file-list">
          <div v-for="entry in items" :key="entry.name" class="file-row">
            <a-checkbox :checked="isChecked(entry)" @change="toggle(entry)" />
            <span
              class="entry-name"
              :class="{ clickable: entry.type === 0 }"
              @click="enterDir(entry)"
            >
              <FolderOutlined v-if="entry.type === 0" />
              <FileOutlined v-else />
              {{ entry.name }}
            </span>
          </div>
          <a-empty v-if="!items.length && !loading" />
        </div>
      </a-spin>
      <div v-if="selected.size" class="selected-box mt-12">
        <div class="mb-4">
          <a-typography-text type="secondary">{{ t("TXT_CODE_backup_selected") }}</a-typography-text>
        </div>
        <a-tag
          v-for="[rel, isDir] in Array.from(selected.entries())"
          :key="rel"
          closable
          @close="removeSelected(rel)"
        >
          {{ isDir ? rel + "/**" : rel }}
        </a-tag>
      </div>
    </div>
  </a-modal>
</template>

<style lang="scss" scoped>
.file-list {
  max-height: 320px;
  overflow-y: auto;
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-radius: 6px;
  padding: 8px;
}
.file-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 4px;
}
.file-row:hover {
  background: rgba(128, 128, 128, 0.08);
}
.entry-name.clickable {
  cursor: pointer;
}
.ml-8 {
  margin-left: 8px;
}
.mb-4 {
  margin-bottom: 4px;
}
.mb-12 {
  margin-bottom: 12px;
}
.mt-12 {
  margin-top: 12px;
}
</style>
