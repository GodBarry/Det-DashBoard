const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./test/e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "line",
  use: {
    baseURL: process.env.TEST_BASE_URL || "http://127.0.0.1:15173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
  },
});
