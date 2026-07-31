import { defineConfig, devices } from "@playwright/test";

const isCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  workers: isCi ? 1 : undefined,
  reporter: isCi ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "pnpm run dev:api:fixture",
      url: "http://127.0.0.1:8787/api/v1/health",
      reuseExistingServer: !isCi,
      timeout: 30_000,
    },
    {
      command: "pnpm run dev:web",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: !isCi,
      timeout: 30_000,
    },
  ],
});
