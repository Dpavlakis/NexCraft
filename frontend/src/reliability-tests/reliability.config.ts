import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { "@": fileURLToPath(new URL("../", import.meta.url)) } },
  test: {
    environment: "jsdom",
    fileParallelism: false,
    maxWorkers: 1,
    include: ["src/reliability-tests/*.test.ts"]
  }
});
