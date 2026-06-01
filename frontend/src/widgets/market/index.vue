<script setup lang="ts">
import { openNodeSelectDialog } from "@/components/fc/index";
import { router } from "@/config/router";
import { useLayoutCardTools } from "@/hooks/useCardTools";
import { QUICKSTART_METHOD } from "@/hooks/widgets/quickStartFlow";
import { t } from "@/lang/i18n";
import { useAppStateStore } from "@/stores/useAppStateStore";
import type { LayoutCard } from "@/types";
import ModpackBrowser from "@/widgets/market/ModpackBrowser.vue";
import { useMarketTour } from "@/widgets/market/useMarketTour";
import CreateInstanceForm from "@/widgets/setupApp/CreateInstanceForm.vue";
import { Tour } from "ant-design-vue";
import { ref } from "vue";

const props = defineProps<{
  card: LayoutCard;
}>();

const { isAdmin } = useAppStateStore();

const { step3Ref, openTour, tourCurrent, tourSteps, markTourDone } = useMarketTour(isAdmin);

const { getMetaOrRouteValue } = useLayoutCardTools(props.card);
const daemonId = getMetaOrRouteValue("daemonId", false) ?? "";

// Form data state
const formData = ref({
  createMethod: QUICKSTART_METHOD.IMPORT,
  daemonId: daemonId || ""
});

// Dialog visibility state
const showCreateForm = ref(false);

const handleNext = (instanceUuid: string) => {
  showCreateForm.value = false;
  // Navigate to instance terminal after create
  router.push({
    path: "/instances/terminal",
    query: {
      daemonId: formData.value.daemonId,
      instanceId: instanceUuid
    }
  });
};

const handleInstallAction = async (createMethod: QUICKSTART_METHOD) => {
  formData.value.createMethod = createMethod;

  try {
    const selectedNode = await openNodeSelectDialog();
    if (!selectedNode) return;
    formData.value.daemonId = selectedNode.uuid;
    showCreateForm.value = true;
  } catch (error) {
    console.error(error);
  }
};

</script>

<template>
  <div style="height: 100%">
    <div ref="step3Ref">
      <ModpackBrowser :card="card" @manual-install="handleInstallAction" />
    </div>

    <Tour
      v-model:current="tourCurrent"
      :open="openTour"
      :steps="tourSteps"
      @close="markTourDone"
      @finish="markTourDone"
    />

    <a-modal
      v-model:open="showCreateForm"
      :title="t('TXT_CODE_645bc545')"
      :width="1000"
      :footer="null"
      :destroy-on-close="true"
    >
      <CreateInstanceForm
        :create-method="formData.createMethod"
        :daemon-id="formData.daemonId"
        @next-step="handleNext"
      />
    </a-modal>
  </div>
</template>
