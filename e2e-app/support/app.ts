// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
//
// What the specs share: starting a fresh app per test, launching Kern the way
// a file manager or a terminal does, calling it over the session bus, and
// reading what each window shows. Everything is read from the DOM the user
// sees; no spec asks the app for its internal state.
//
// WebDriver: W3C WebDriver, "Perform Actions" (section 17) for the pointer
// and key input of a Ctrl+double-click.

import { spawnSync } from "node:child_process";
import { browser } from "@wdio/globals";
import { removeTestDirs, world } from "./world";

/** The binary under test, built by `tauri build --debug --no-bundle`. */
export function appBinary(): string {
  const bin = process.env["KERN_E2E_APP"];
  if (!bin) throw new Error("KERN_E2E_APP is not set: run the suite through e2e-app/run.sh");
  return bin;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * How long the app gets to show something a launch or a file change asked
 * for. It showed within about a second on a development machine; 15 seconds
 * leaves room for a runner that renders in software and starts slowly. A
 * positive check that waits this long fails with what was on screen.
 */
export const SHOWS_WITHIN_MS = 15_000;

/**
 * The longest a launched `kern` or `gdbus` process may take. A forwarding
 * launch returns once the running instance has taken the arguments, which is
 * well under a second; the bound only keeps a hang from stalling the run, so
 * it is a few times the wait for a window.
 */
const PROCESS_BOUND_MS = 30_000;

/**
 * Registers the hooks that give every test an app of its own: the session
 * wdio opens for a spec file serves the first test, and each later test
 * restarts the app. Test directories are removed after each test.
 */
export function freshAppPerTest(): void {
  world();
  let used = false;
  beforeEach(async () => {
    if (used) await browser.reloadSession();
    used = true;
    await waitForWindows((ws) => ws.some((w) => w.kind === "main" && w.ready));
  });
  afterEach(() => {
    removeTestDirs();
  });
}

export interface Launched {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs the Kern binary with `args` in `cwd`, as a launcher would: it finds
 * the running instance on the session bus, hands over its arguments and
 * exits.
 */
export function kern(args: string[], cwd?: string): Launched {
  // Refuses to launch anything outside the isolated world.
  const w = world();
  const r = spawnSync(appBinary(), args, {
    cwd: cwd ?? w.home,
    env: process.env,
    encoding: "utf8",
    timeout: PROCESS_BOUND_MS,
  });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** The `file:` URI of an absolute path: every byte outside the unreserved set and `/` is `%XX`. */
export function fileUri(p: string): string {
  let out = "file://";
  for (const b of Buffer.from(p)) {
    const c = String.fromCharCode(b);
    out += /[A-Za-z0-9\-._~/]/.test(c) ? c : `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

/**
 * Calls `method` of `org.freedesktop.FileManager1` on the run's session bus
 * (the interface file managers expose to other applications) with the URIs
 * and an empty startup id.
 */
export function fileManager1(method: "ShowFolders" | "ShowItems", uris: string[]): Launched {
  // Refuses to call anything but the run's own session bus.
  world();
  const list = `[${uris.map((u) => `'${u}'`).join(", ")}]`;
  const r = spawnSync(
    "gdbus",
    [
      "call",
      "--session",
      "--dest",
      "org.freedesktop.FileManager1",
      "--object-path",
      "/org/freedesktop/FileManager1",
      "--method",
      `org.freedesktop.FileManager1.${method}`,
      list,
      "",
    ],
    { env: process.env, encoding: "utf8", timeout: PROCESS_BOUND_MS }
  );
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

export interface Tab {
  title: string;
  active: boolean;
}

export interface Row {
  name: string;
  selected: boolean;
}

/** What one window shows. */
export interface Shown {
  handle: string;
  /** `main` (file manager), `doc` (standalone document), `editor`, or `other` while loading. */
  kind: "main" | "doc" | "editor" | "other";
  /** The main window has finished starting: it shows a tab. */
  ready: boolean;
  /** A document window: the title over the document. */
  docTitle: string;
  /** A document window: its Home button is there and usable. */
  home: boolean;
  tabs: Tab[];
  rows: Row[];
  /** The text of the document on show, if any. */
  text: string;
}

/** Read in the page; a string so no transpiler helper is serialised into it. */
const READ_WINDOW = `
  const q = (s, r) => Array.from((r || document).querySelectorAll(s));
  const doc = document.querySelector('[data-testid="document-window"]');
  const main = document.querySelector('[data-testid="main-window"]');
  const editor = document.querySelector('[data-testid="editor-window"]');
  const kind = doc ? 'doc' : main ? 'main' : editor ? 'editor' : 'other';
  const home = doc ? doc.querySelector('button[aria-label^="Home"]') : null;
  const tabs = q('[data-testid="tab"]').map((t) => ({
    title: (t.querySelector('.kern-tab-title') || t).textContent.trim(),
    active: t.getAttribute('aria-selected') === 'true',
  }));
  const rows = q('[data-testid="file-row"], [data-testid="file-card"]').map((r) => ({
    name: r.getAttribute('data-name') || r.textContent.trim(),
    selected: r.getAttribute('aria-selected') === 'true',
  }));
  const content = document.querySelector('[data-testid="editor-host"] .cm-content');
  return {
    kind,
    ready: tabs.length > 0 || kind === 'doc',
    docTitle: doc ? (doc.querySelector('.kern-doc-window-title') || {textContent: ''}).textContent.trim() : '',
    home: !!home && !home.disabled,
    tabs,
    rows,
    text: content ? content.innerText : '',
  };
`;

/** Every window of the app, each read in turn. A window that goes away while being read is left out. */
export async function windows(): Promise<Shown[]> {
  const out: Shown[] = [];
  for (const handle of await browser.getWindowHandles()) {
    try {
      await browser.switchToWindow(handle);
      const s = (await browser.execute(READ_WINDOW)) as Omit<Shown, "handle">;
      out.push({ handle, ...s });
    } catch {
      // Closed between the listing and the read.
    }
  }
  return out;
}

/** Waits until `ok` holds of the windows, and returns them. */
export async function waitForWindows(
  ok: (ws: Shown[]) => boolean,
  what = "the windows to be as expected"
): Promise<Shown[]> {
  let last: Shown[] = [];
  try {
    await browser.waitUntil(
      async () => {
        last = await windows();
        return ok(last);
      },
      { timeout: SHOWS_WITHIN_MS, interval: 250 }
    );
  } catch {
    // What was on screen is the evidence of what went wrong.
    throw new Error(`timed out waiting for ${what}; the windows showed ${JSON.stringify(last)}`);
  }
  return last;
}

/** Makes `handle` the window later commands act on. */
export async function focusWindow(handle: string): Promise<void> {
  await browser.switchToWindow(handle);
}

/** The handle of the one window of `kind`; throws unless there is exactly one. */
export function only(ws: Shown[], kind: Shown["kind"]): Shown {
  const found = ws.filter((w) => w.kind === kind);
  if (found.length !== 1) {
    throw new Error(`expected one ${kind} window, found ${found.length} of ${ws.length}`);
  }
  return found[0] as Shown;
}

/**
 * The time a window the app was asked for is given to appear before the
 * absence of one is believed. Windows appeared within about a second on a
 * development machine, so this is more than twice that.
 */
const ABSENCE_QUIET_MS = 2500;

/**
 * Waits until the app has had `quietMs` to open another window and has not:
 * the number of windows the driver lists stays `count`. The count is the
 * driver's list of handles, not the windows that could be read, so a window
 * whose content cannot be read still counts.
 */
export async function settleAt(count: number, quietMs = ABSENCE_QUIET_MS): Promise<Shown[]> {
  const until = Date.now() + quietMs;
  for (;;) {
    const open = (await browser.getWindowHandles()).length;
    if (open !== count) {
      throw new Error(`expected ${count} windows to stay open, found ${open}`);
    }
    if (Date.now() >= until) break;
    await sleep(250);
  }
  return windows();
}

const ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf";

/**
 * A double click on `selector` in the current window with Ctrl held, as a
 * pointer and a key input at once (W3C WebDriver 17.5, "Perform Actions").
 */
export async function ctrlDoubleClick(selector: string): Promise<void> {
  const el = await browser.$(selector);
  await el.waitForDisplayed({ timeout: SHOWS_WITHIN_MS });
  const origin = { [ELEMENT_KEY]: await el.elementId };
  // The Control key of the WebDriver key table (W3C WebDriver 17.4.2, "Normalised key values").
  const CONTROL = "\uE009";
  await browser.performActions([
    {
      type: "key",
      id: "keyboard",
      actions: [
        { type: "keyDown", value: CONTROL },
        { type: "pause", duration: 0 },
        { type: "pause", duration: 0 },
        { type: "pause", duration: 0 },
        { type: "pause", duration: 0 },
        { type: "keyUp", value: CONTROL },
      ],
    },
    {
      type: "pointer",
      id: "mouse",
      parameters: { pointerType: "mouse" },
      actions: [
        { type: "pointerMove", duration: 0, x: 0, y: 0, origin },
        { type: "pointerDown", button: 0 },
        { type: "pointerUp", button: 0 },
        { type: "pointerDown", button: 0 },
        { type: "pointerUp", button: 0 },
      ],
    },
  ]);
  await browser.releaseActions();
}

/** A double click on `selector` in the current window. */
export async function doubleClick(selector: string): Promise<void> {
  const el = await browser.$(selector);
  await el.waitForDisplayed({ timeout: SHOWS_WITHIN_MS });
  const origin = { [ELEMENT_KEY]: await el.elementId };
  await browser.performActions([
    {
      type: "pointer",
      id: "mouse",
      parameters: { pointerType: "mouse" },
      actions: [
        { type: "pointerMove", duration: 0, x: 0, y: 0, origin },
        { type: "pointerDown", button: 0 },
        { type: "pointerUp", button: 0 },
        { type: "pointerDown", button: 0 },
        { type: "pointerUp", button: 0 },
      ],
    },
  ]);
  await browser.releaseActions();
}

/** Clicks the tab of the current window titled `title`. */
export async function activateTab(title: string): Promise<void> {
  const seen: string[] = [];
  for (const tab of await browser.$$('[data-testid="tab"]')) {
    const text = String(await tab.getProperty("textContent")).trim();
    seen.push(text);
    if (text === title) {
      await tab.click();
      return;
    }
  }
  throw new Error(`no tab titled ${title} among ${JSON.stringify(seen)}`);
}

/** The selector of the row of the folder listing named `name`. */
export function rowSelector(name: string): string {
  return `[data-testid="file-row"][data-name=${JSON.stringify(name)}]`;
}
