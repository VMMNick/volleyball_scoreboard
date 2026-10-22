// e2e-тести: справжній браузер (Chromium), справжній сервер, кілька пристроїв одночасно.
// Запуск: npm run e2e  (перший раз: npx playwright install chromium)
"use strict";
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "tests/e2e",
  timeout: 60000,
  expect: { timeout: 8000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: { browserName: "chromium", headless: true, trace: "retain-on-failure" }
});
