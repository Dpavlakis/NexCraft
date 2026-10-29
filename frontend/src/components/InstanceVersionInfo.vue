<script setup lang="ts">
import { t } from "@/lang/i18n";
import { useAppRouters } from "@/hooks/useAppRouters";
import { useInstanceVersions } from "@/hooks/useInstanceVersions";
import { getInstanceVersionTarget, instanceReleaseId } from "@/tools/instanceVersions";
import { useAppStateStore } from "@/stores/useAppStateStore";
import type { InstanceDetail } from "@/types";
import { computed } from "vue";

const props = defineProps<{
  instance: InstanceDetail;
  daemonId: string;
  compact?: boolean;
}>();

const { installed, update } = useInstanceVersions(() => props.instance);
const { isAdmin } = useAppStateStore();
const { toPage } = useAppRouters();
const statusText = computed(
  () =>
    ({
      loading: t("TXT_CODE_instance_version_checking"),
      available: t("TXT_CODE_instance_version_update_available"),
      current: t("TXT_CODE_instance_version_up_to_date"),
      unknown: t("TXT_CODE_instance_version_status_unknown"),
      unsupported: t("TXT_CODE_instance_version_updates_unsupported"),
      error: t("TXT_CODE_instance_version_check_failed")
    })[update.value.status]
);
const canOpenUpdate = computed(
  () =>
    isAdmin.value &&
    !!props.daemonId &&
    !!props.instance.instanceUuid &&
    update.value.status === "available"
);
const latestLabel = computed(() => {
  const release = update.value.latest;
  return (
    release?.displayName ||
    release?.name ||
    release?.version_number ||
    release?.id ||
    release?.fileId
  );
});
const openUpdate = () => {
  if (!canOpenUpdate.value || !update.value.latest) return;
  const target = getInstanceVersionTarget(props.instance.config.packInfo);
  if (!target) return;
  toPage({
    path: "/instances/modpackUpdate",
    query: {
      daemonId: props.daemonId,
      instanceId: props.instance.instanceUuid,
      updateVersionId: instanceReleaseId(update.value.latest, target.source),
      updateSource: target.source,
      updateProjectId: target.projectId,
      // Keep candidate provenance distinct from the route context, which toPage merges.
      updateDaemonId: props.daemonId,
      updateInstanceId: props.instance.instanceUuid
    }
  });
};
</script>

<template>
  <div class="instance-versions" :class="{ 'is-compact': compact }">
    <dl class="version-metadata">
      <template v-if="installed.isBedrock">
        <div class="version-row">
          <dt>{{ t('TXT_CODE_instance_version_bedrock_bds') }}</dt>
          <dd :title="installed.bdsVersion">{{ installed.bdsVersion || t('TXT_CODE_import_loader_unknown') }}</dd>
        </div>
      </template>
      <template v-else>
        <div v-if="installed.isModpack" class="version-row">
          <dt>{{ t('TXT_CODE_instance_version_installed_pack') }}</dt>
          <dd :title="installed.packVersion">{{ installed.packVersion || t('TXT_CODE_import_loader_unknown') }}</dd>
        </div>
        <div class="version-row">
          <dt>{{ t('TXT_CODE_minecraft_menu') }}</dt>
          <dd :title="installed.minecraftVersion">{{ installed.minecraftVersion || t('TXT_CODE_import_loader_unknown') }}</dd>
        </div>
      </template>
      <div v-if="installed.liveVersion" class="version-row">
        <dt>{{ t('TXT_CODE_instance_version_live_server') }}</dt>
        <dd :title="installed.liveVersion">{{ installed.liveVersion }}</dd>
      </div>
    </dl>
    <div class="version-status" :data-status="update.status" role="status" aria-live="polite">
      <button
        v-if="canOpenUpdate"
        type="button"
        class="version-update-button"
        :title="latestLabel"
        :aria-label="t('TXT_CODE_instance_version_open_updates')"
        @click.stop="openUpdate"
      >
        <span class="status-dot" aria-hidden="true"></span>
        {{ statusText }}
      </button>
      <span v-else class="status-text">
        <span class="status-dot" aria-hidden="true"></span>
        {{ statusText }}
      </span>
    </div>
  </div>
</template>

<style scoped lang="scss">
.instance-versions {
  min-width: 0;
  font-size: var(--font-body2);
  line-height: 1.5;
}
.version-metadata {
  margin: 0;
}
.version-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  padding-block: 1px;
  dt {
    flex: 0 0 auto;
    color: var(--color-gray-9);
  }
  dd {
    min-width: 0;
    margin: 0 0 0 auto;
    color: var(--color-gray-12);
    text-align: right;
    overflow-wrap: anywhere;
  }
}
.version-status {
  margin-top: 4px;
  color: var(--color-gray-12);
  &[data-status="available"] .status-dot {
    background: var(--color-warning);
  }
  &[data-status="current"] .status-dot {
    background: var(--color-success);
  }
  &[data-status="error"] .status-dot {
    background: var(--color-danger);
  }
}
.status-text,
.version-update-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.status-dot {
  flex: 0 0 5px;
  width: 5px;
  height: 5px;
  background: currentColor;
  border-radius: 50%;
}
.version-update-button {
  max-width: 100%;
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
  &:hover {
    color: var(--color-gray-12);
    text-decoration-thickness: 2px;
  }
  &:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 3px;
    border-radius: 2px;
  }
}
.is-compact .version-row dd {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
