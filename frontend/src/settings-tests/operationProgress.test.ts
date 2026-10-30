import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { useOperationProgress } from "@/hooks/useOperationProgress";
import { presentOperationProgress, type OperationTask } from "@/tools/operationProgress";
import OperationProgress from "@/components/OperationProgress.vue";

vi.mock("@/lang/i18n", () => ({
  t: (key: string, args?: Record<string, unknown>) => key + (args ? " " + JSON.stringify(args) : "")
}));
const pending = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const running = (progress?: OperationTask["progress"]): OperationTask => ({
  taskId: "job",
  status: 1,
  progress
});
let wrappers: VueWrapper[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  wrappers.forEach((w) => w.unmount());
  wrappers = [];
  vi.useRealTimers();
});
const setup = (read = vi.fn().mockResolvedValue(running())) => {
  const target = ref("node/alpha");
  let flow!: ReturnType<typeof useOperationProgress<OperationTask>>;
  wrappers.push(
    mount(
      defineComponent({
        setup() {
          flow = useOperationProgress(() => target.value, read);
          return () => h("div");
        }
      })
    )
  );
  const onSuccess = vi.fn();
  const onFailure = vi.fn();
  const onStarted = vi.fn();
  const callbacks = { onSuccess, onFailure, onStarted };
  return { flow, target, read, onSuccess, onFailure, onStarted, callbacks };
};

describe("operation lifecycle hook used by the native cards", () => {
  it("locks immediately while POST is delayed and never overlaps delayed polls", async () => {
    const post = pending<string>();
    const readResult = pending<OperationTask>();
    const context = setup(vi.fn().mockReturnValue(readResult.promise));
    const create = vi.fn().mockReturnValue(post.promise);
    const first = context.flow.start(create, context.callbacks);
    expect(context.flow.busy.value).toBe(true);
    await context.flow.start(create, context.callbacks);
    expect(create).toHaveBeenCalledTimes(1);
    post.resolve("job");
    await flushPromises();
    await vi.advanceTimersByTimeAsync(15000);
    expect(context.read).toHaveBeenCalledTimes(1);
    readResult.resolve(running());
    await first;
    await vi.advanceTimersByTimeAsync(1499);
    expect(context.read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(context.read).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each([
    [null, "missing"],
    [undefined, "missing"],
    [{ taskId: "other", status: 0 }, "missing"],
    [{ taskId: "job", status: -1 }, "failed"],
    [{ taskId: "job", status: 0, progress: { completed: false } }, "failed"],
    [{ taskId: "job", status: 55 }, "failed"]
  ])("never succeeds for missing/failed/inconsistent task %j", async (result, reason) => {
    const c = setup(vi.fn().mockResolvedValue(result));
    await c.flow.start(async () => "job", c.callbacks);
    expect(c.onSuccess).not.toHaveBeenCalled();
    expect(c.flow.failure.value).toBe(reason);
    expect(c.flow.busy.value).toBe(false);
    await vi.advanceTimersByTimeAsync(10000);
    expect(c.read).toHaveBeenCalledTimes(1);
  });

  it("does not replay POST or refresh success after a transport error", async () => {
    const c = setup(vi.fn().mockRejectedValue(new Error("offline")));
    const create = vi.fn().mockResolvedValue("job");
    await c.flow.start(create, c.callbacks);
    await vi.advanceTimersByTimeAsync(10000);
    expect(c.flow.failure.value).toBe("unavailable");
    expect(c.onSuccess).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
    expect(c.read).toHaveBeenCalledTimes(1);
  });

  it.each(["reject", "empty"])(
    "releases the busy lock after %s start without a read",
    async (mode) => {
      const c = setup();
      await c.flow.start(
        () => (mode === "reject" ? Promise.reject(new Error("offline")) : Promise.resolve("")),
        c.callbacks
      );
      expect(c.flow.busy.value).toBe(false);
      expect(c.flow.failure.value).toBe("start");
      expect(c.read).not.toHaveBeenCalled();
      expect(c.onSuccess).not.toHaveBeenCalled();
    }
  );

  it.each(["target", "unmount"])(
    "ignores a late POST after %s and sends no status request",
    async (change) => {
      const c = setup();
      const post = pending<string>();
      const first = c.flow.start(() => post.promise, c.callbacks);
      if (change === "target") c.target.value = "node/beta";
      else wrappers.pop()!.unmount();
      post.resolve("job");
      await first;
      expect(c.read).not.toHaveBeenCalled();
      expect(c.onStarted).not.toHaveBeenCalled();
      expect(c.onSuccess).not.toHaveBeenCalled();
    }
  );

  it.each(["target", "unmount"])("ignores a late successful poll after %s", async (change) => {
    const late = pending<OperationTask>();
    const c = setup(vi.fn().mockReturnValue(late.promise));
    const first = c.flow.start(async () => "job", c.callbacks);
    await flushPromises();
    if (change === "target") c.target.value = "node/beta";
    else wrappers.pop()!.unmount();
    late.resolve({ taskId: "job", status: 0, progress: { completed: true } });
    await first;
    expect(c.onSuccess).not.toHaveBeenCalled();
    expect(c.flow.task.value).toBeNull();
    await vi.advanceTimersByTimeAsync(10000);
    expect(c.read).toHaveBeenCalledTimes(1);
  });

  it("waits for explicit task success even when progress says completed", async () => {
    const c = setup(
      vi
        .fn()
        .mockResolvedValueOnce(running({ phase: "archive", completed: true, percentage: 100 }))
        .mockResolvedValueOnce({
          taskId: "job",
          status: 0,
          progress: { phase: "done", completed: true }
        })
    );
    await c.flow.start(async () => "job", c.callbacks);
    expect(c.flow.busy.value).toBe(true);
    expect(c.onSuccess).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);
    expect(c.onSuccess).toHaveBeenCalledTimes(1);
    expect(c.flow.busy.value).toBe(false);
    await vi.advanceTimersByTimeAsync(10000);
    expect(c.read).toHaveBeenCalledTimes(2);
  });

  it("supports explicit stopped success from old daemons", async () => {
    const c = setup(vi.fn().mockResolvedValue({ taskId: "job", status: 0 }));
    await c.flow.start(async () => "job", c.callbacks);
    expect(c.onSuccess).toHaveBeenCalledTimes(1);
  });
});

describe("truthful stage presentation", () => {
  it.each([
    ["finalization", "finalize"], ["restart", "restart"], ["cancelled", "cancelled"]
  ])("recognizes backend phase %s without claiming completion", (phase, label) => {
    const task = running({ phase, indeterminate: true, completed: false, percentage: 0 });
    if (phase === "cancelled") task.status = 0;
    const view = presentOperationProgress(task, "update");
    expect(view.phaseKey).toBe("TXT_CODE_operation_phase_" + label);
    expect(view.percent).toBeUndefined();
  });
  it("shows growing archive counts without a guessed percentage or denominator", () => {
    for (const total of [100, 500, 1000]) {
      const view = presentOperationProgress(
        running({
          percentage: 100,
          processedBytes: total,
          totalBytes: total,
          entries: total / 100
        }),
        "backup"
      );
      expect(view.percent).toBeUndefined();
      expect(view.totalBytes).toBeUndefined();
      expect(view.processedBytes).toBe(total);
      expect(view.entries).toBe(total / 100);
    }
  });
  it("treats explicit unknown progress as activity even at child backup 100", () => {
    const view = presentOperationProgress(
      running({
        phase: "backup",
        indeterminate: true,
        completed: false,
        percentage: 100,
        entries: 40,
        processedBytes: 4096
      }),
      "update"
    );
    expect(view.percent).toBeUndefined();
    expect(view.phaseKey).toBe("TXT_CODE_operation_phase_backup");
  });
  it("shows measured download progress only for that stage and discards it on apply", () => {
    const task = { ...running(), phase: "download", downloadProgress: { percentage: 63 } };
    expect(presentOperationProgress(task, "update").percent).toBe(63);
    expect(presentOperationProgress({ ...task, phase: "apply" }, "update").percent).toBeUndefined();
    expect(
      presentOperationProgress({ ...task, phase: "bootstrap" }, "update").percent
    ).toBeUndefined();
  });
  it.each([100, 120, -1, NaN, Infinity])(
    "never displays invalid or active full value %s",
    (percentage) => {
      expect(
        presentOperationProgress(
          running({ phase: "download", indeterminate: false, percentage }),
          "update"
        ).percent
      ).toBeUndefined();
    }
  );
  it("labels unknown phases safely and rejects invalid metrics", () => {
    const view = presentOperationProgress(
      running({
        phase: "future_stage",
        indeterminate: false,
        percentage: 50,
        entries: -1,
        processedBytes: NaN,
        totalBytes: Infinity
      }),
      "backup"
    );
    expect(view.phaseKey).toBe("TXT_CODE_operation_phase_unknown");
    expect(view.percent).toBeUndefined();
    expect(view.entries).toBeUndefined();
    expect(view.processedBytes).toBeUndefined();
    expect(view.totalBytes).toBeUndefined();
  });
  it("only shows 100 for finished success and keeps delayed finalization indeterminate", () => {
    const task = running({ phase: "done", completed: true, indeterminate: false, percentage: 100 });
    expect(presentOperationProgress(task, "backup").phaseKey).toBe(
      "TXT_CODE_operation_phase_finalize"
    );
    expect(presentOperationProgress(task, "backup").percent).toBeUndefined();
    expect(presentOperationProgress({ ...task, status: -1 }, "backup").percent).toBeUndefined();
    expect(presentOperationProgress({ ...task, status: 0 }, "backup").percent).toBe(100);
  });

  it("renders the shared native presenter without requests for archive, download and unknown states", async () => {
    const wrapper = mount(OperationProgress, {
      props: {
        task: running({ phase: "archive", indeterminate: true, entries: 37, processedBytes: 4096 }),
        kind: "backup",
        label: "Backup"
      },
      global: {
        stubs: {
          AProgress: { props: ["percent"], template: "<div data-percent>{{ percent }}%</div>" },
          AAlert: { props: ["message"], template: '<div role="alert">{{ message }}</div>' }
        }
      }
    });
    wrappers.push(wrapper);
    expect(wrapper.get('[role="status"]').attributes("aria-live")).toBe("polite");
    expect(wrapper.text()).toContain('"count":37');
    expect(wrapper.text()).toContain("4.00 KB");
    expect(wrapper.find("[data-percent]").exists()).toBe(false);
    expect(wrapper.find(".operation-hint").exists()).toBe(false);
    await wrapper.setProps({
      kind: "update",
      task: running({ phase: "download", indeterminate: false, percentage: 64 })
    });
    expect(wrapper.get("[data-percent]").text()).toBe("64%");
    expect(wrapper.text()).toContain("TXT_CODE_operation_stage_only");
    await wrapper.setProps({ task: running({ phase: "future_stage", percentage: 100 }) });
    expect(wrapper.find("[data-percent]").exists()).toBe(false);
    expect(wrapper.text()).toContain("TXT_CODE_operation_phase_unknown");
    expect(wrapper.find(".operation-hint").exists()).toBe(false);
    await wrapper.setProps({
      task: running({ phase: "download", indeterminate: false, percentage: 0 })
    });
    expect(wrapper.find(".operation-hint").exists()).toBe(false);
    await wrapper.setProps({
      task: { taskId: "job", status: 0, progress: { completed: true } }
    });
    expect(wrapper.find(".operation-hint").exists()).toBe(false);
    await wrapper.setProps({ failure: "missing" });
    expect(wrapper.get('[role="alert"]').text()).toContain("TXT_CODE_operation_error_missing");
  });
});
