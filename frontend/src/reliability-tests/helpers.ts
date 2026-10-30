import { createApp, defineComponent, h, nextTick } from "vue";

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Drain bounded promise continuations without advancing clocks or waiting on I/O.
export async function flushPromises() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  await nextTick();
}

export function mountHook<T>(setup: () => T) {
  let result!: T;
  const errors: unknown[] = [];
  const element = document.createElement("div");
  document.body.appendChild(element);
  const app = createApp(
    defineComponent({
      setup() {
        result = setup();
        return () => h("div");
      }
    })
  );
  app.config.errorHandler = (error) => {
    errors.push(error);
  };
  app.mount(element);
  let mounted = true;
  return {
    result,
    errors,
    unmount() {
      if (!mounted) return;
      mounted = false;
      app.unmount();
      element.remove();
    }
  };
}
