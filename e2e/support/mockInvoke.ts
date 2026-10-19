// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { test as base, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Command name to canned response. A value may be a literal or a function of
 * the invoke arguments; functions must be self-contained, since they are
 * serialised into the page.
 */
export type MockResponses = Record<string, unknown | ((args: Record<string, unknown>) => unknown)>;

export type InvokeCall = { cmd: string; args: Record<string, unknown> };

/**
 * Install `window.__TAURI_INTERNALS__.invoke` before the app's scripts run, so
 * a plain Chromium page with no Rust backend can boot. Anything unmocked
 * resolves to null and logs a warning.
 */
export async function installTauriMocks(page: Page, handlers: MockResponses = {}): Promise<void> {
  const literals: Record<string, unknown> = {};
  const fns: Record<string, string> = {};
  for (const [name, value] of Object.entries(handlers)) {
    if (typeof value === "function") fns[name] = `(${value.toString()})`;
    else literals[name] = value;
  }

  await page.addInitScript(
    ({ literals, fns }) => {
      const compiled: Record<string, (args: Record<string, unknown>) => unknown> = {};
      for (const [name, source] of Object.entries(fns)) {
        compiled[name] = (0, eval)(source as string);
      }
      const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
      (window as unknown as { __tauriCalls: typeof calls }).__tauriCalls = calls;

      const invoke = (cmd: string, args: Record<string, unknown> = {}) => {
        calls.push({ cmd, args });
        const handler = compiled[cmd];
        if (handler) return Promise.resolve(handler(args));
        if (cmd in literals) return Promise.resolve(literals[cmd]);
        console.warn(`[mockInvoke] unmocked Tauri command: ${cmd}`);
        return Promise.resolve(null);
      };

      (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
        invoke,
        transformCallback: (callback: unknown) => callback,
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      };
    },
    { literals, fns }
  );
}

/** The IPC calls the page made during the test. */
export async function getInvokeCalls(page: Page): Promise<InvokeCall[]> {
  return page.evaluate(
    () => (window as unknown as { __tauriCalls?: InvokeCall[] }).__tauriCalls ?? []
  );
}

/** Playwright's `test` with the IPC mock installed for every test. */
export const test = base.extend<{
  _autoTauriMock: void;
  mockTauri: (handlers: MockResponses) => Promise<void>;
  invokeCalls: () => Promise<InvokeCall[]>;
}>({
  _autoTauriMock: [
    async ({ page }, use) => {
      await installTauriMocks(page);
      await use();
    },
    { auto: true },
  ],
  mockTauri: async ({ page }, use) => {
    await use((handlers) => installTauriMocks(page, handlers));
  },
  invokeCalls: async ({ page }, use) => {
    await use(() => getInvokeCalls(page));
  },
});

export { expect };
