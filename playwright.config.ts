// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { defineConfig, devices } from "@playwright/test";

const PORT = 1420;
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 1 : undefined,
  reporter: isCI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // The production build, served by Vite's preview server: the Rust backend is
    // replaced by the IPC mock. Not the dev server, because React's development
    // build adds work per render that grows with the size of the props (about
    // 250 ms for a 100 000-entry list), which would make the frame-gap test
    // measure the development build instead of the app that ships.
    command: "npx vite build && npx vite preview --port 1420 --strictPort",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
