import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    fileParallelism: false,
    env: {
      LOG_LEVEL: "silent",
      NODE_ENV: "test",
    },
  },
});
