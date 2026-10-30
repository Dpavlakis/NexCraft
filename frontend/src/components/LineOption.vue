<script setup lang="ts">
import { t } from "@/lang/i18n";
import { EditOutlined } from "@ant-design/icons-vue";
import { computed, watch, ref } from "vue";

const LONG_MAGIC_PREFIX = "<__long__>";
const FLOAT_MAGIC_PREFIX = "<__float__>";
const props = defineProps<{
  optionValue?: Record<string, any>;
  optionKey?: any;
  custom?: boolean;
  booleanSwitch?: boolean;
}>();

enum CONTROL {
  SELECT = 1,
  INPUT = 2
}

const value = ref<Record<string, any>>({});
const key = ref();
const type = ref(2);

const computedValue = computed({
  get: () => {
    const v = value.value[key.value];
    if (typeof v === "string") {
      if (v.startsWith(LONG_MAGIC_PREFIX)) {
        return v.replace(LONG_MAGIC_PREFIX, "");
      } else if (v.startsWith(FLOAT_MAGIC_PREFIX)) {
        return v.replace(FLOAT_MAGIC_PREFIX, "");
      }
    }
    return v;
  },
  set: (v) => {
    const preValue = value.value[key.value];
    if (typeof preValue === "string") {
      if (preValue.startsWith(LONG_MAGIC_PREFIX)) {
        value.value[key.value] = `${LONG_MAGIC_PREFIX}${v}`;
        return;
      } else if (preValue.startsWith(FLOAT_MAGIC_PREFIX)) {
        value.value[key.value] = `${FLOAT_MAGIC_PREFIX}${v}`;
        return;
      }
      // Plain string value: assign it directly. A bare `return` here previously
      // discarded the edit, making every non-numeric/non-boolean field (e.g.
      // level-name, level-seed, default-player-permission-level) impossible to edit.
      value.value[key.value] = v;
      return;
    }
    value.value[key.value] =
      props.booleanSwitch &&
      typeof preValue === "number" &&
      typeof v === "string" &&
      v.trim() !== "" &&
      Number.isFinite(Number(v))
        ? Number(v)
        : v;
  }
});

const valueType = computed(() => {
  if (typeof value.value[key.value] === "boolean") {
    return CONTROL.SELECT;
  }
  return CONTROL.INPUT;
});

const forceType = () => {
  if (type.value >= 2) return (type.value = 1);
  type.value = type.value + 1;
};

watch(
  () => [props.optionValue, props.optionKey],
  () => {
    if (props.custom) return;
    value.value = props.optionValue ?? {};
    key.value = props.optionKey;
    type.value = valueType.value;
  },
  { immediate: true }
);
</script>

<template>
  <div class="line-option-wrapper">
    <a-card class="line-option-card" :body-style="{ padding: '10px' }">
      <div v-if="!custom">
        <a-row :gutter="[10, 10]" align="middle">
          <a-col :md="7" :span="24">
            <span class="line-option-title"><slot name="title"></slot></span>
          </a-col>
          <a-col :md="11" :span="24">
            <span class="line-option-info"><slot name="info"></slot></span>
          </a-col>
          <a-col :md="6" :span="24">
            <div v-if="$slots.optionInput">
              <slot name="optionInput"></slot>
            </div>
            <div v-else class="flex">
              <a-input v-if="type == CONTROL.INPUT" v-model:value="computedValue" />
              <div v-if="booleanSwitch && valueType === CONTROL.SELECT" class="config-boolean">
                <a-switch
                  v-model:checked="computedValue"
                  :aria-label="String(optionKey)"
                  class="config-boolean-switch"
                />
                <span>{{ computedValue ? t("TXT_CODE_addfcb6b") : t("TXT_CODE_1e9c479e") }}</span>
              </div>
              <a-select
                v-else-if="type == CONTROL.SELECT"
                v-model:value="computedValue"
                style="width: 100%"
                :placeholder="t('TXT_CODE_fe3f34e6')"
              >
                <a-select-option :value="true">{{ t("TXT_CODE_addfcb6b") }}</a-select-option>
                <a-select-option :value="false">{{ t("TXT_CODE_1e9c479e") }}</a-select-option>
              </a-select>
              <a-button
                v-if="type == CONTROL.SELECT && !booleanSwitch"
                class="ml-8"
                @click="forceType"
              >
                <EditOutlined />
              </a-button>
            </div>
          </a-col>
        </a-row>
      </div>
      <div v-else>
        <slot></slot>
      </div>
    </a-card>
  </div>
</template>

<style lang="scss" scoped>
.line-option-title {
  overflow-wrap: anywhere;
}
.line-option-info {
  word-break: normal;
  overflow-wrap: break-word;
  line-height: 1.6;
}
.config-boolean {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 32px;
}
.config-boolean-switch {
  min-width: 44px;
  border-radius: 999px;
}
.line-option-wrapper {
  width: 100%;
  margin-bottom: 6px;
  .line-option-card {
    transition: all 0.4s;
    border-radius: 6px;
  }
  .line-option-card:hover {
    border: 1px solid var(--color-gray-6) !important;
    box-shadow: 0 2px 4px 0 rgba(0, 0, 0, 0.16);
  }
}
</style>
