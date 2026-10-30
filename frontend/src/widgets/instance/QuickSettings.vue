<script setup lang="ts">
import { computed, getCurrentInstance, inject, onBeforeUnmount, watch } from "vue";
import { useRoute } from "vue-router";
import { ReloadOutlined, RollbackOutlined, SaveOutlined } from "@ant-design/icons-vue";
import CardPanel from "@/components/CardPanel.vue";
import { getConfigFile, getInstanceInfo, updateConfigFile } from "@/services/apis/instance";
import { useAppRouters } from "@/hooks/useAppRouters";
import { t } from "@/lang/i18n";
import { confirmServerPropertiesSave } from "@/tools/confirmServerPropertiesSave";
import { createQuickSettings, quickEdition, type QuickTarget } from "@/tools/quickSettings";
import type { LayoutCard } from "@/types";

const props = defineProps<{ card: LayoutCard }>();
const route = useRoute();
const { toPage } = useAppRouters();
const embeddedInManageModal = inject<boolean>("embeddedInManageModal", false);
const fullPage = computed(() => route.path === "/instances/quickSettings");
const prefix = `quick-${getCurrentInstance()?.uid}`;
const target = computed<QuickTarget>(() => {
  const value = (key: string) => String(props.card.meta?.[key] ?? route.query[key] ?? "");
  return { uuid: value("instanceId"), daemonId: value("daemonId"), type: value("type") };
});
const params = (context: QuickTarget) => ({
  uuid: context.uuid,
  daemonId: context.daemonId,
  fileName: "server.properties",
  type:
    quickEdition(context.type) === "bedrock"
      ? "properties_not_unicode_lossless"
      : "properties_lossless"
});
const model = createQuickSettings({
  readType: async (context, signal) => {
    const result = await getInstanceInfo().execute({
      params: { uuid: context.uuid, daemonId: context.daemonId },
      signal,
      forceRequest: true,
      errorAlert: false
    });
    return result.value?.config.type ?? "";
  },
  read: async (context, signal) =>
    (
      await getConfigFile().execute({
        params: params(context),
        signal,
        forceRequest: true,
        errorAlert: false
      })
    ).value,
  write: async (context, properties) =>
    (
      await updateConfigFile().execute({
        params: params(context),
        data: properties,
        forceRequest: true,
        errorAlert: false
      })
    ).value,
  confirm: () => confirmServerPropertiesSave("server.properties", true)
});
const { state, fields, changes, validation, busy } = model;
watch(
  () => [props.card, target.value.uuid, target.value.daemonId, target.value.type],
  () => {
    void model.setTarget(target.value);
  },
  { immediate: true, flush: "sync" }
);
onBeforeUnmount(model.dispose);
const groups = ["gameplay", "access", "world"] as const;
const options = (kind: string) =>
  (kind === "mode"
    ? [
        "survival",
        "creative",
        "adventure",
        ...(quickEdition(state.target?.type ?? "") === "java" ? ["spectator"] : [])
      ]
    : ["peaceful", "easy", "normal", "hard"]
  ).map((value) => ({ value, label: t(`TXT_CODE_quick_${value}`) }));
const navigate = (path: string) => {
  const context = state.target ?? target.value;
  if (!context.uuid || !context.daemonId || busy.value) return;
  void toPage({
    path,
    query: { instanceId: context.uuid, daemonId: context.daemonId, type: context.type }
  });
};
</script>

<template>
  <CardPanel class="quick-settings" :full-height="false">
    <template v-if="!embeddedInManageModal" #title>{{ t("TXT_CODE_quick_title") }}</template>
    <template #body>
      <div class="quick-toolbar">
        <span class="quick-filename">server.properties</span>
        <div class="quick-actions">
          <a-button
            v-if="fullPage && !embeddedInManageModal"
            :disabled="busy"
            @click="navigate('/instances/terminal')"
          >
            <RollbackOutlined /> {{ t("TXT_CODE_quick_return") }}
          </a-button>
          <a-button :disabled="busy" @click="navigate('/instances/terminal/serverConfig')">
            {{ t("TXT_CODE_quick_fullConfig") }}
          </a-button>
        </div>
      </div>
      <a-alert v-if="state.error" class="quick-notice" type="warning" show-icon role="alert">
        <template #message>{{ t(`TXT_CODE_quick_error_${state.error}`) }}</template>
        <template v-if="state.errorDetail || state.conflicts.length" #description>
          {{ state.conflicts.join(", ") || state.errorDetail }}
        </template>
      </a-alert>
      <div v-if="state.loading" class="quick-loading" role="status" aria-live="polite">
        <a-spin /> <span>{{ t("TXT_CODE_quick_loading") }}</span>
      </div>
      <p v-else-if="state.ready && !fields.length" class="quick-empty" role="status">
        {{ t("TXT_CODE_quick_empty") }}
      </p>
      <div v-else-if="state.ready" class="quick-grid" :aria-busy="state.saving">
        <section
          v-for="group in groups.filter((name) => fields.some((field) => field.group === name))"
          :key="group"
          :aria-labelledby="`${prefix}-${group}`"
        >
          <h2 :id="`${prefix}-${group}`">{{ t(`TXT_CODE_quick_${group}`) }}</h2>
          <div
            v-for="field in fields.filter((item) => item.group === group)"
            :key="field.key"
            class="quick-field"
            :class="{ 'quick-toggle': field.kind === 'boolean' }"
          >
            <label :id="`${prefix}-${field.key}-label`" :for="`${prefix}-${field.key}`">
              {{ t(`TXT_CODE_quick_${field.label}`) }}
            </label>
            <a-switch
              v-if="field.kind === 'boolean'"
              :id="`${prefix}-${field.key}`"
              :checked="state.draft[field.key] === true"
              :disabled="busy"
              :aria-labelledby="`${prefix}-${field.key}-label`"
              :checked-children="t('TXT_CODE_quick_yes')"
              :un-checked-children="t('TXT_CODE_quick_no')"
              @update:checked="model.edit(field.key, $event === true)"
            />
            <a-input
              v-else-if="field.kind === 'integer'"
              :id="`${prefix}-${field.key}`"
              :value="String(state.draft[field.key])"
              inputmode="numeric"
              :disabled="busy"
              :aria-labelledby="`${prefix}-${field.key}-label`"
              :aria-invalid="!!validation[field.key]"
              :aria-describedby="validation[field.key] ? `${prefix}-${field.key}-error` : undefined"
              :status="validation[field.key] ? 'error' : undefined"
              @update:value="model.edit(field.key, String($event))"
            />
            <a-select
              v-else
              :id="`${prefix}-${field.key}`"
              :value="String(state.draft[field.key])"
              :options="options(field.kind)"
              :disabled="busy"
              :aria-labelledby="`${prefix}-${field.key}-label`"
              @update:value="model.edit(field.key, String($event))"
            />
            <p
              v-if="validation[field.key]"
              :id="`${prefix}-${field.key}-error`"
              class="quick-validation"
              role="alert"
            >
              {{ t(`TXT_CODE_quick_validation_${validation[field.key]}`) }}
            </p>
          </div>
        </section>
      </div>
      <footer class="quick-footer">
        <span class="quick-feedback" role="status" aria-live="polite">
          {{
            state.saved
              ? t("TXT_CODE_quick_saved")
              : Object.keys(changes).length
              ? t("TXT_CODE_quick_unsaved")
              : ""
          }}
        </span>
        <div class="quick-actions">
          <a-button :loading="state.loading" :disabled="busy" @click="model.load()">
            <ReloadOutlined /> {{ t("TXT_CODE_quick_refresh") }}
          </a-button>
          <a-button
            type="primary"
            :loading="state.saving"
            :disabled="
              busy ||
              !state.ready ||
              !Object.keys(changes).length ||
              !!Object.keys(validation).length
            "
            @click="model.save()"
          >
            <SaveOutlined /> {{ t("TXT_CODE_quick_save") }}
          </a-button>
        </div>
      </footer>
    </template>
  </CardPanel>
</template>

<style scoped>
.quick-settings {
  min-width: 0;
  container-type: inline-size;
}
.quick-toolbar,
.quick-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.quick-toolbar {
  margin-bottom: 16px;
}
.quick-filename,
.quick-feedback {
  color: var(--color-gray-7);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.quick-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.quick-notice {
  margin-bottom: 16px;
  overflow-wrap: anywhere;
}
.quick-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.quick-grid section {
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--color-gray-4);
  border-radius: 8px;
  background: var(--background-color-white);
}
.quick-grid h2 {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
  margin: 0 0 18px;
}
.quick-field {
  min-width: 0;
  margin-top: 16px;
}
.quick-field label {
  display: block;
  font-size: 13px;
  line-height: 1.5;
  margin-bottom: 8px;
  word-break: normal;
}
.quick-field .ant-select {
  width: 100%;
}
.quick-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.quick-toggle label {
  margin: 0;
}
.quick-validation {
  color: var(--color-error, #cf3434);
  font-size: 12px;
  margin: 6px 0 0;
  word-break: normal;
}
.quick-footer {
  margin-top: 18px;
}
.quick-loading {
  display: flex;
  justify-content: center;
  gap: 12px;
  padding: 32px 12px;
}
.quick-empty {
  color: var(--color-gray-7);
  padding: 16px 0;
  word-break: normal;
}
@container (max-width: 600px) {
  .quick-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 720px) {
  .quick-grid {
    grid-template-columns: 1fr;
  }
}
</style>
