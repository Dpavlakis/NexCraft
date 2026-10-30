<script setup lang="ts">
import { computed } from "vue";
import { LoadingOutlined } from "@ant-design/icons-vue";
import { t } from "@/lang/i18n";
import { backupSize } from "@/tools/backupPresentation";
import { presentOperationProgress, type OperationTask } from "@/tools/operationProgress";
import type { OperationFailure } from "@/hooks/useOperationProgress";

const props = defineProps<{
  task: OperationTask | null;
  kind: "backup" | "update";
  label: string;
  failure?: OperationFailure;
}>();
const view = computed(() => presentOperationProgress(props.task, props.kind));
</script>

<template>
  <section class="operation-progress" role="status" aria-live="polite" aria-atomic="true">
    <div class="operation-heading">{{ label }}</div>
    <a-alert
      v-if="failure"
      type="error"
      show-icon
      :message="t('TXT_CODE_operation_error_' + failure)"
    />
    <template v-else>
      <div class="operation-stage">
        <LoadingOutlined
          v-if="view.percent === undefined"
          class="operation-spinner"
          aria-hidden="true"
        />
        <span>{{ t(view.phaseKey) }}</span>
      </div>
      <a-progress
        v-if="view.percent !== undefined"
        :percent="view.percent"
        :status="view.percent === 100 ? 'success' : 'active'"
      />
      <div
        v-if="view.entries !== undefined || view.processedBytes !== undefined"
        class="operation-counts"
      >
        <span v-if="view.entries !== undefined">{{
          t("TXT_CODE_operation_files", { count: view.entries })
        }}</span>
        <span v-if="view.processedBytes !== undefined">{{
          view.totalBytes === undefined
            ? t("TXT_CODE_operation_bytes", { bytes: backupSize(view.processedBytes) })
            : t("TXT_CODE_operation_bytes_total", {
                bytes: backupSize(view.processedBytes),
                total: backupSize(view.totalBytes)
              })
        }}</span>
      </div>
      <div
        v-if="view.percent !== undefined && view.percent > 0 && view.percent < 100"
        class="operation-hint"
      >
        {{ t("TXT_CODE_operation_stage_only") }}
      </div>
    </template>
  </section>
</template>

<style scoped>
.operation-progress {
  min-width: 0;
  overflow-wrap: anywhere;
}
.operation-heading {
  font-weight: 600;
  margin-bottom: 8px;
}
.operation-stage,
.operation-counts {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 16px;
}
.operation-counts {
  margin-top: 8px;
  font-variant-numeric: tabular-nums;
}
.operation-hint {
  margin-top: 6px;
  color: var(--color-gray-6);
  font-size: 12px;
}
@media (prefers-reduced-motion: reduce) {
  .operation-spinner :deep(svg) {
    animation: none !important;
  }
}
</style>
