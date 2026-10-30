<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { DeleteOutlined, DownloadOutlined, RedoOutlined } from "@ant-design/icons-vue";
import { t } from "@/lang/i18n";
import type { BackupItem } from "@/services/apis/backup";
import { backupKind, backupSize, backupTime } from "@/tools/backupPresentation";

const props = defineProps<{ backups: BackupItem[]; taskRunning: boolean }>();
const emit = defineEmits<{
  download: [record: BackupItem];
  restore: [record: BackupItem];
  remove: [record: BackupItem];
}>();
const page = ref(1);
const pageSize = 10;
const visibleBackups = computed(() =>
  props.backups.slice((page.value - 1) * pageSize, page.value * pageSize)
);
watch(
  () => props.backups.length,
  (length) => {
    page.value = Math.min(page.value, Math.max(1, Math.ceil(length / pageSize)));
  }
);
</script>

<template>
  <div class="backup-list">
    <a-empty v-if="backups.length === 0" :image="undefined" />
    <ul v-else class="backup-entries">
      <li v-for="record in visibleBackups" :key="record.name" class="backup-entry">
        <div class="backup-summary">
          <a-tag
            class="backup-kind"
            :color="backupKind(record.name) === 'world' ? 'blue' : undefined"
          >
            {{ t(`TXT_CODE_backup_kind_${backupKind(record.name)}`) }}
          </a-tag>
          <time
            :datetime="
              record.time > 0 &&
              Number.isFinite(record.time) &&
              !Number.isNaN(new Date(record.time).getTime())
                ? new Date(record.time).toISOString()
                : undefined
            "
            >{{ backupTime(record.time) }}</time
          >
          <span class="backup-size">{{ backupSize(record.size) }}</span>
        </div>
        <p class="backup-filename">{{ record.name }}</p>
        <div class="backup-actions">
          <a-button size="small" @click="emit('download', record)">
            <DownloadOutlined />{{ t("TXT_CODE_backup_download") }}
          </a-button>
          <a-popconfirm
            :title="t('TXT_CODE_backup_restore_confirm')"
            :disabled="taskRunning"
            @confirm="emit('restore', record)"
          >
            <a-button size="small" :disabled="taskRunning">
              <RedoOutlined />{{ t("TXT_CODE_backup_restore") }}
            </a-button>
          </a-popconfirm>
          <a-popconfirm
            :title="t('TXT_CODE_backup_delete_confirm')"
            @confirm="emit('remove', record)"
          >
            <a-button danger size="small"><DeleteOutlined />{{ t("TXT_CODE_ecbd7449") }}</a-button>
          </a-popconfirm>
        </div>
      </li>
    </ul>
    <a-pagination
      v-if="backups.length > pageSize"
      v-model:current="page"
      class="backup-pagination"
      :page-size="pageSize"
      :total="backups.length"
      :show-size-changer="false"
      size="small"
    />
  </div>
</template>

<style scoped>
.backup-list {
  min-width: 0;
  word-break: normal;
}
.backup-entries {
  list-style: none;
  margin: 0;
  padding: 0;
}
.backup-entry {
  min-width: 0;
  padding: 12px 0;
  border-bottom: 1px solid var(--card-border-color);
}
.backup-entry:first-child {
  padding-top: 0;
}
.backup-entry:last-child {
  border-bottom: 0;
}
.backup-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  font-size: 13px;
}
.backup-kind {
  margin: 0;
}
.backup-size {
  white-space: nowrap;
  opacity: 0.7;
}
.backup-filename {
  margin: 6px 0 10px;
  font-size: 12px;
  line-height: 1.5;
  opacity: 0.65;
  overflow-wrap: anywhere;
}
.backup-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.backup-actions :deep(.ant-btn) {
  height: auto;
  min-height: 28px;
  white-space: normal;
}
.backup-pagination {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  margin-top: 12px;
}
</style>
