// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
//
// WebdriverIO configuration for the real-app driver suite: the debug build of
// Kern driven through tauri-driver, which runs WebKitWebDriver (WebKitGTK's
// W3C WebDriver server) and starts the application for each session. The
// driver is a localhost harness; the application itself opens no socket.
//
// Run through e2e-app/run.sh, which builds the isolated world (see
// support/world.ts) before this file is read.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { world } from "./support/world";

// Throws unless the run is isolated.
world();

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set: run the suite through e2e-app/run.sh`);
  return v;
}

const application = need("KERN_E2E_APP");
const driverBinary = need("KERN_E2E_TAURI_DRIVER");
// Two free loopback ports chosen by run.sh for each run.
const port = Number(need("KERN_E2E_DRIVER_PORT"));
const nativePort = Number(need("KERN_E2E_NATIVE_PORT"));

if (!existsSync(application)) {
  throw new Error(
    `${application} does not exist: build it with npx tauri build --debug --no-bundle`
  );
}

/** How long tauri-driver gets to start listening: it binds within a fraction of a second. */
const DRIVER_START_MS = 20_000;

/** Resolves once something accepts connections on the harness port (localhost only). */
async function listening(p: number): Promise<void> {
  const until = Date.now() + DRIVER_START_MS;
  for (;;) {
    const open = await new Promise<boolean>((resolve) => {
      const s = connect({ host: "127.0.0.1", port: p });
      s.once("connect", () => {
        s.destroy();
        resolve(true);
      });
      s.once("error", () => resolve(false));
    });
    if (open) return;
    if (Date.now() > until) throw new Error(`tauri-driver is not listening on port ${p}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

let driver: ChildProcess | undefined;

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./*.spec.ts"],
  maxInstances: 1,
  hostname: "127.0.0.1",
  port,
  path: "/",
  capabilities: [
    {
      maxInstances: 1,
      // tauri-driver starts this binary for each session.
      "tauri:options": { application },
    } as WebdriverIO.Capabilities,
  ],
  logLevel: "warn",
  // The wait for an element is the wait for a window to show something.
  waitforTimeout: 15_000,
  // Starting a session starts the app, which takes seconds; a minute is WebdriverIO's
  // own default for it.
  connectionRetryTimeout: 60_000,
  connectionRetryCount: 1,
  framework: "mocha",
  reporters: ["spec"],
  // A test restarts the app and then waits up to 15 seconds for each thing it
  // checks, of which the longest test has four or five.
  mochaOpts: { ui: "bdd", timeout: 90_000 },

  // tauri-driver listens on `port` and forwards to WebKitWebDriver on
  // `nativePort`.
  beforeSession: async () => {
    driver = spawn(
      driverBinary,
      [
        "--port",
        String(port),
        "--native-port",
        String(nativePort),
        "--native-driver",
        need("KERN_E2E_WEBKIT_DRIVER"),
      ],
      { stdio: ["ignore", "inherit", "inherit"], env: process.env }
    );
    const started = driver;
    const failed = new Promise<never>((_, reject) => {
      started.once("error", reject);
      started.once("exit", (code) =>
        reject(new Error(`tauri-driver exited with ${code} at start`))
      );
    });
    await Promise.race([listening(port), failed]);
    started.removeAllListeners("exit");
    started.removeAllListeners("error");
  },
  afterSession: () => {
    driver?.kill();
    driver = undefined;
  },
};
