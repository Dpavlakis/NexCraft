<script setup lang="ts">
import connectErrorImage from "@/assets/daemon_connection_error.png";
import { useCommandHistory } from "@/hooks/useCommandHistory";
import { useXhrPollError } from "@/hooks/useXhrPollError";
import { t } from "@/lang/i18n";
import { getInstanceOutputLog } from "@/services/apis/instance";
import { useLayoutContainerStore } from "@/stores/useLayoutContainerStore";
import { CodeOutlined, DeleteOutlined, DownOutlined, LoadingOutlined } from "@ant-design/icons-vue";
import { Terminal } from "@xterm/xterm";
import { message } from "ant-design-vue";
import { onMounted, ref, watch } from "vue";
import { INSTANCE_STATUS_CODE } from "@/types/const";
import { encodeConsoleColor, type UseTerminalHook } from "../hooks/useTerminal";
import { getRandomId } from "../tools/randId";

const props = defineProps<{
  instanceId: string;
  daemonId: string;
  height: string;
  useTerminalHook: UseTerminalHook;
}>();

const { containerState } = useLayoutContainerStore();

const {
  focusHistoryList,
  selectLocation,
  history,
  commandInputValue,
  handleHistorySelect,
  clickHistoryItem
} = useCommandHistory();

const {
  state,
  events,
  isConnect,
  socketAddress,
  execute: setUpTerminal,
  initTerminalWindow,
  sendCommand,
  clearTerminal
} = props.useTerminalHook;

const instanceId = props.instanceId;
const daemonId = props.daemonId;

const terminalDomId = `terminal-window-${getRandomId()}`;

const socketError = ref<Error>();
const { isXhrPollError, xhrPollErrorReason } = useXhrPollError(socketError);

let term: Terminal | undefined;

// Show a "jump to latest" button while the user has scrolled up the console.
const showScrollBottom = ref(false);
const updateScrollState = () => {
  if (!term) return;
  const b = term.buffer.active;
  showScrollBottom.value = b.viewportY < b.baseY;
};
const scrollToBottom = () => {
  term?.scrollToBottom();
  showScrollBottom.value = false;
};

let inputRef = ref<HTMLElement | null>(null);

const handleSendCommand = () => {
  if (focusHistoryList.value) return;
  sendCommand(commandInputValue.value || "");
  commandInputValue.value = "";
};

const handleClickHistoryItem = (item: string) => {
  clickHistoryItem(item);
  inputRef.value?.focus();
};

const initTerminal = async () => {
  if (containerState.isDesignMode) return;
  const dom = document.getElementById(terminalDomId);
  if (dom) {
    const term = initTerminalWindow(dom);
    return term;
  }
  throw new Error(t("TXT_CODE_42bcfe0c"));
};

// Start/run notifications:
//  - "opened" means the process just launched -> show "Instance is starting…".
//  - Only show "Instance Running" once the status actually reaches RUNNING
//    (the daemon holds Minecraft instances at STARTING until the server logs
//    that it's ready), so the running toast confirms a real, up server.
let startPhase: "idle" | "starting" | "running" = "idle";

const notifyStarting = () => {
  if (startPhase !== "starting") {
    startPhase = "starting";
    message.success(t("TXT_CODE_instance_starting"));
  }
};

const notifyRunning = () => {
  startPhase = "running";
  message.success(t("TXT_CODE_e13abbb1"));
};

events.on("opened", () => {
  // If a non-Minecraft instance comes up immediately, confirm running now;
  // otherwise announce starting and wait for the RUNNING status transition.
  if (state.value?.status === INSTANCE_STATUS_CODE.RUNNING) {
    notifyRunning();
  } else {
    notifyStarting();
  }
});

watch(
  () => state.value?.status,
  (s) => {
    if (s === INSTANCE_STATUS_CODE.STARTING) {
      notifyStarting();
    } else if (s === INSTANCE_STATUS_CODE.RUNNING) {
      // Only confirm running if we were tracking a start (avoids a toast when
      // simply opening the console of an already-running instance).
      if (startPhase === "starting") notifyRunning();
    } else if (s === INSTANCE_STATUS_CODE.STOPPED) {
      startPhase = "idle";
    }
  }
);

events.on("stopped", () => {
  startPhase = "idle";
  message.success(t("TXT_CODE_efb6d377"));
});

events.on("error", (error: Error) => {
  socketError.value = error;
});

events.once("detail", async () => {
  try {
    const { value } = await getInstanceOutputLog().execute({
      params: { uuid: instanceId || "", daemonId: daemonId || "" }
    });

    if (value) {
      if (state.value?.config?.terminalOption?.haveColor) {
        term?.write(encodeConsoleColor(value));
      } else {
        term?.write(value);
      }
    }
  } catch (error: any) {}
});

const refreshPage = () => {
  window.location.reload();
};

// Initialize the terminal when the component is mounted.
// Do not reinitialize it in the parent component.
onMounted(async () => {
  try {
    if (instanceId && daemonId) {
      await setUpTerminal({
        instanceId,
        daemonId
      });
    }
    term = await initTerminal();
    if (term) {
      term.onScroll(() => updateScrollState());
      updateScrollState();
    }
  } catch (error: any) {
    console.error(error);
    throw error;
  }
});
</script>

<template>
  <!-- Terminal Page View -->
  <div class="console-wrapper">
    <div v-if="!isConnect" class="terminal-loading">
      <LoadingOutlined style="font-size: 72px; color: white" />
    </div>
    <div class="terminal-button-group position-absolute-right position-absolute-top">
      <ul>
        <li @click="clearTerminal()">
          <a-tooltip placement="top">
            <template #title>
              <span>{{ t("TXT_CODE_b1e2e1b4") }}</span>
            </template>
            <delete-outlined />
          </a-tooltip>
        </li>
      </ul>
    </div>
    <div class="terminal-wrapper global-card-container-shadow position-relative">
      <div class="terminal-container">
        <div
          v-if="!containerState.isDesignMode"
          :id="terminalDomId"
          :style="{ height: props.height }"
        ></div>
        <div v-else :style="{ height: props.height }">
          <p class="terminal-design-tip">{{ $t("TXT_CODE_7ac6f85c") }}</p>
        </div>
      </div>
      <div
        v-if="showScrollBottom"
        class="scroll-bottom-btn"
        :title="t('TXT_CODE_terminal_scroll_bottom')"
        @click="scrollToBottom"
      >
        <DownOutlined />
      </div>
    </div>
    <div class="command-input">
      <div v-show="focusHistoryList" class="history">
        <li v-for="(item, key) in history" :key="item">
          <a-tag
            :color="key !== selectLocation ? 'blue' : '#108ee9'"
            @click="handleClickHistoryItem(item)"
          >
            {{ item.length > 14 ? item.slice(0, 14) + "..." : item }}
          </a-tag>
        </li>
      </div>
      <a-input
        ref="inputRef"
        v-model:value="commandInputValue"
        :placeholder="t('TXT_CODE_555e2c1b')"
        autofocus
        :disabled="containerState.isDesignMode || !isConnect"
        @press-enter="handleSendCommand"
        @keydown="handleHistorySelect"
      >
        <template #prefix>
          <CodeOutlined style="font-size: 18px" />
        </template>
      </a-input>
    </div>

    <!-- Error Dialog -->
    <div v-if="socketError" class="error-card">
      <div class="error-card-container">
        <a-typography-title :level="5">{{ $t("TXT_CODE_6929b0b2") }}</a-typography-title>
        <a-typography-paragraph>
          {{ $t("TXT_CODE_812a629e") + socketAddress }}
        </a-typography-paragraph>
        <div>
          <img :src="connectErrorImage" style="width: 100%; height: 110px" />
        </div>
        <a-typography-title :level="5">{{ $t("TXT_CODE_9c95b60f") }}</a-typography-title>
        <a-typography-paragraph>
          <pre style="font-size: 12px"><code>{{ socketError?.message||"" }}</code></pre>

          <div v-if="isXhrPollError" style="font-size: 12px">
            <span> {{ xhrPollErrorReason }}</span>
          </div>
        </a-typography-paragraph>
        <a-typography-paragraph v-if="isXhrPollError">
          <div class="flex" style="gap: 8px; font-size: 12px">
            <span>
              <strong>{{ $t("TXT_CODE_d4c8fb3b") }}</strong>
            </span>
            <a
              href="https://dpavlakis.github.io/NexCraft/"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{ $t("TXT_CODE_9b3ce825") }}
            </a>
            <span>|</span>
            <a
              href="https://dpavlakis.github.io/NexCraft/"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{ $t("TXT_CODE_10cc2794") }}
            </a>
          </div>
        </a-typography-paragraph>
        <a-typography-title :level="5">{{ $t("TXT_CODE_f1c96d8a") }}</a-typography-title>
        <a-typography-paragraph>
          <ul>
            <li>
              {{ $t("TXT_CODE_ceba9262") }}
            </li>
            <li>
              {{ $t("TXT_CODE_84099e5") }}
            </li>
            <li>
              {{ $t("TXT_CODE_86ff658a") }}
            </li>
          </ul>
          <div class="flex flex-center">
            <a-typography-link @click="refreshPage">
              {{ $t("TXT_CODE_f8b28901") }}
            </a-typography-link>
          </div>
        </a-typography-paragraph>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.error-card {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  top: 0;
  z-index: 10;
  border-radius: 20px;

  display: flex;
  align-items: center;
  justify-content: center;

  .error-card-container {
    overflow: hidden;
    max-width: 440px;
    border: 1px solid var(--color-gray-6) !important;
    background-color: var(--color-gray-1);
    border-radius: 4px;
    padding: 12px;
    box-shadow: 0px 0px 2px var(--color-gray-7);
  }

  @media (max-width: 992px) {
    .error-card-container {
      max-width: 90vw !important;
    }
  }
}
.console-wrapper {
  position: relative;

  .terminal-loading {
    z-index: 12;
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  }

  .terminal-button-group {
    z-index: 11;
    margin-right: 20px;
    padding-bottom: 50px;
    padding-left: 50px;
    border-radius: 6px;
    color: #fff;

    &:hover {
      ul {
        transition: all 1s;
        opacity: 0.8;
      }
    }

    ul {
      display: flex;
      opacity: 0;

      li {
        cursor: pointer;
        list-style: none;
        padding: 5px;
        margin-left: 5px;
        border-radius: 6px;
        font-size: 20px;

        &:hover {
          background-color: #3e3e3e;
        }
      }
    }
  }

  .terminal-wrapper {
    border: 1px solid var(--card-border-color);
    position: relative;
    overflow: hidden;
    height: 100%;
    background-color: #1e1e1e;
    padding: 8px;
    border-radius: 6px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    .terminal-container {
      // min-width: 1200px;
      height: 100%;
    }

    .scroll-bottom-btn {
      position: absolute;
      right: 16px;
      bottom: 16px;
      z-index: 6;
      width: 34px;
      height: 34px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      background-color: rgba(40, 40, 40, 0.92);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #fff;
      font-size: 16px;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
      transition: background-color 0.2s ease;

      &:hover {
        background-color: #3e3e3e;
      }
    }

    margin-bottom: 12px;
  }

  .command-input {
    position: relative;

    .history {
      display: flex;
      max-width: 100%;
      overflow: scroll;
      z-index: 10;
      position: absolute;
      top: -35px;
      left: 0;

      li {
        list-style: none;
        span {
          padding: 3px 20px;
          max-width: 300px;
          overflow: hidden;
          text-overflow: ellipsis;
          cursor: pointer;
        }
      }

      &::-webkit-scrollbar {
        width: 0 !important;
        height: 0 !important;
      }
    }
  }

  .terminal-design-tip {
    color: rgba(255, 255, 255, 0.584);
  }
}
</style>
