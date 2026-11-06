// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { defineConfig, devices } from "@playwright/test";

// Not the dev server's port (1420, tauri.conf.json devUrl): a running `tauri dev`
// is never mistaken for the build under test, because the preview has a port of its own.
const PORT = 4173;
const FRAME_GAP = /without_holding_up_a_frame/;
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
  projects: [
    { name: "chromium", grepInvert: FRAME_GAP, use: { ...devices["Desktop Chrome"] } },
    // The frame-gap measurement runs alone, after every other test has finished, so no
    // other worker takes the CPU or the page's frames while it measures.
    {
      name: "frame-gap",
      grep: FRAME_GAP,
      dependencies: ["chromium"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // The production build, served by Vite's preview server: the Rust backend is
    // replaced by the IPC mock. Not the dev server, because React's development
    // build adds work per render that grows with the size of the props (about
    // 250 ms for a 100 000-entry list), which would make the frame-gap test
    // measure the development build instead of the app that ships.
    command: "npx vite build && npx vite preview --port 4173 --strictPort",
    url: `http://localhost:${PORT}`,
    // Always started here: a server already on the port is an error, never reused.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
