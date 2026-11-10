// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Queued, WirePath } from "../ipc";
import { stubLayout } from "../files/test-layout";
import { NO_LAYOUT, SETTINGS } from "../settings/test-settings";

// The commands a document window's page sends, found by running it: the page is mounted as
// `doc-1` with the one place a command leaves it (Tauri's invoke) recording every command name,
// and used for what a document window offers (the document opening, being handed a tab's state
// and answering for it, editing, saving, Save As, pinning, a change on disk, Home, being asked
// for by an editor window, closing, and a file too large for the editor). Each command it sent
// must be granted to `doc-*` by capabilities/doc.json, so a page that starts calling something
// new fails here until the grant is added (or the call removed), and src-tauri/tests/acl.rs
// checks that every grant in that file is one Tauri's access control really honours and that a
// document window is refused what only the main window needs.

const wire = vi.hoisted(() => ({
  sent: new Set<string>(),
  handlers: {} as Record<string, (payload: unknown) => void>,
  answer: (_cmd: string, _args: Record<string, unknown>): unknown => null,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => {
    wire.sent.add(cmd);
    try {
      return Promise.resolve(wire.answer(cmd, args ?? {}));
    } catch (e) {
      return Promise.reject(e);
    }
  },
  convertFileSrc: (p: string) => p,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, h: (e: { payload: unknown }) => void) => {
    wire.handlers[name] = (payload: unknown) => h({ payload });
    return Promise.resolve(() => undefined);
  },
}));

import App from "../App";
import { currentContext, getAction, runAction } from "../keys/actions";
import { useOps } from "../ops/useOps";
import { useLayout } from "../store/layout";
import { useTabs } from "../store/tabs";
import { useCloseGuard } from "./useCloseGuard";
import { usePinnedRecent } from "./pinned-recent-store";
import { EMPTY_PRUNE } from "./test-pinned-recent";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const NOTES = p("/d/notes.md");
const BIG = p("/d/big.md");
const KERNKRAFT = "plugin:kernkraft-tauri|";

let restoreLayout: () => void;

/** The permission that grants a command sent to the backend, or null for what the core grants. */
function permissionOf(cmd: string): string | null {
  const dashed = (name: string) => name.replace(/_/g, "-");
  if (cmd.startsWith(KERNKRAFT))
    return `kernkraft-tauri:allow-${dashed(cmd.slice(KERNKRAFT.length))}`;
  // Events and windows are the core's, granted by core:default.
  if (cmd.startsWith("plugin:")) return null;
  return `allow-${dashed(cmd)}`;
}

function grantedToDocumentWindows(): Set<string> {
  const file = resolve(process.cwd(), "src-tauri/capabilities/doc.json");
  const json = JSON.parse(readFileSync(file, "utf8")) as {
    windows: string[];
    permissions: string[];
  };
  expect(json.windows).toEqual(["doc-*"]);
  return new Set(json.permissions);
}

/** The commands whose grant this run could not show are named here, each with why. */
function expectGranted() {
  const granted = grantedToDocumentWindows();
  const missing = [...wire.sent]
    .map((cmd) => ({ cmd, permission: permissionOf(cmd) }))
    .filter((x) => x.permission !== null && !granted.has(x.permission));
  expect(missing).toEqual([]);
}

/** The pins the backend holds. */
const pinned: WirePath[] = [];
const queue: Queued[] = [];
/** Whether a Save As target is found open in another window. */
let openElsewhere = false;
let homeAnswers: "refuse" | "accept" = "refuse";

/** What the backend answers, enough for every page of a document window to go on. */
function answer(cmd: string, args: Record<string, unknown>): unknown {
  const name = cmd.startsWith(KERNKRAFT) ? cmd.slice(KERNKRAFT.length) : cmd;
  const path = args.path as WirePath | undefined;
  switch (name) {
    case "open_pending_take":
      return queue.splice(0);
    case "text_open":
      if (path!.v === BIG.v) {
        throw { kind: "TooLargeToOpen", message: "too large", path: null, details: null };
      }
      return {
        path,
        text: "hello",
        ending: "lf",
        bom: false,
        read_only: null,
        stamp: "s1:5:0:1:1:0",
      };
    case "text_save":
      return "s2:5:0:1:1:1";
    case "text_check":
      return "same";
    case "entry_of":
      throw { kind: "NotFound", message: "no such file", path: null, details: null };
    case "doc_open_elsewhere":
      return openElsewhere
        ? { state: "elsewhere", location: { kind: "tab", window: "main", tab_id: "t9" } }
        : { state: "free" };
    case "open_paths":
      return (args.paths as WirePath[]).map((x) => ({
        path: x,
        action: "focus",
        location: null,
        error: null,
      }));
    case "hand_doc":
      throw { kind: "Internal", message: "the editor window is gone", path: null, details: null };
    case "move_doc_to_main":
      if (homeAnswers === "refuse") {
        throw { kind: "Internal", message: "no main window", path: null, details: null };
      }
      return null;
    case "mime_of":
      return { mime: "text/plain", is_text: true };
    case "user_dirs":
      return { home: p("/home/a"), dirs: [] };
    case "settings_get":
    case "settings_set":
      return SETTINGS;
    case "layout_get":
      return NO_LAYOUT;
    case "theme_get":
      return { css: ":root{}", tokens: { scheme: "light" }, fallbacks: [], problems: [] };
    case "prune":
      return { ...EMPTY_PRUNE, pins: { entries: pinned }, recents: { entries: [] } };
    case "pin":
      pinned.push(path!);
      return { entries: pinned };
    case "unpin":
      pinned.splice(0, pinned.length, ...pinned.filter((x) => x.v !== path!.v));
      return { entries: pinned };
    case "pins_get":
      return { entries: pinned };
    case "recent_touch":
      return { entries: [] };
    case "store_errors_take":
    case "volumes_problems_take":
      return [];
    default:
      // watch_dir, unwatch_dir, doc_opened, doc_closed, detached, refuse_detach, hand_refused,
      // open_default, confirm_close, log_error.
      return null;
  }
}

beforeEach(() => {
  restoreLayout = stubLayout();
  (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "doc-1" } },
  };
  wire.sent.clear();
  wire.handlers = {};
  wire.answer = answer;
  homeAnswers = "refuse";
  queue.length = 0;
  pinned.length = 0;
  openElsewhere = false;
  usePinnedRecent.getState().reset();
  useCloseGuard.getState().reset();
  useLayout.getState().reset();
  useOps.setState({ notice: null });
  useTabs.setState({ tabs: [], activeId: null, views: {}, selectRequests: {} });
});
afterEach(async () => {
  cleanup();
  await Promise.resolve();
  restoreLayout();
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  vi.clearAllMocks();
});

const run = (id: string) => act(async () => runAction(getAction(id), currentContext()));
const said = (event: string, payload: unknown) => act(async () => wire.handlers[event]?.(payload));

test("every_command_a_document_windows_page_sends_is_granted_to_document_windows", async () => {
  // A tab was moved here: the window answers once it holds the document.
  queue.push({ event: "kern://open", payload: { kind: "load_doc", path: NOTES, ack: true } });
  render(<App />);
  expect(await screen.findByTestId("document-window")).toBeInTheDocument();
  await waitFor(() => expect(document.querySelectorAll(".cm-content")).toHaveLength(1));
  await waitFor(() => expect(wire.sent.has("detached")).toBe(true));

  // Edited and saved, a change on disk checked, Save As to a free name, and pinned.
  const host = screen.getByTestId("editor-host");
  act(() => EditorView.findFromDOM(host)!.dispatch({ changes: { from: 0, insert: "x" } }));
  await run("doc.save");
  await said("kernkraft://dir-changed", {
    key: `doc:${useTabs.getState().tabs[0]!.id}`,
    error: null,
  });
  await run("doc.saveAs");
  const field = await waitFor(() =>
    document.querySelector<HTMLInputElement>("input.kern-modal-input")!
  );
  fireEvent.change(field, { target: { value: "/d/saved.md" } });
  fireEvent.keyDown(field, { key: "Enter" });
  await waitFor(() => expect(wire.sent.has(`${KERNKRAFT}text_save`)).toBe(true));
  await run("doc.pin");
  await run("doc.pin");

  // Save As onto a file another window has open is refused, and offers to show it there.
  openElsewhere = true;
  await run("doc.saveAs");
  const again = await waitFor(() =>
    document.querySelector<HTMLInputElement>("input.kern-modal-input")!
  );
  fireEvent.change(again, { target: { value: "/d/taken.md" } });
  fireEvent.keyDown(again, { key: "Enter" });
  fireEvent.click(await screen.findByRole("button", { name: "Show it there" }));
  await waitFor(() => expect(wire.sent.has("open_paths")).toBe(true));
  fireEvent.keyDown(again, { key: "Escape" });
  openElsewhere = false;

  // Home, refused by the backend, so the document stays and can be asked for next.
  fireEvent.click(screen.getByRole("button", { name: /^Home/ }));
  await waitFor(() => expect(wire.sent.has("move_doc_to_main")).toBe(true));
  await screen.findByTestId("home-error");

  // An editor window asks for this document; the hand-over fails, so the document stays and the
  // editor window is told why.
  await said("kern://open", { kind: "hand_to", path: NOTES, to: "editor-2" });
  await waitFor(() => expect(wire.sent.has("hand_doc")).toBe(true));
  await waitFor(() => expect(wire.sent.has("hand_refused")).toBe(true));

  // A close with nothing unsaved is confirmed at once.
  await said("kern://close-requested", null);
  await waitFor(() => expect(wire.sent.has("confirm_close")).toBe(true));

  for (const must of [
    "open_pending_take",
    "settings_get",
    "doc_opened",
    "doc_closed",
    "doc_open_elsewhere",
    "open_paths",
    "detached",
    "move_doc_to_main",
    "hand_doc",
    "hand_refused",
    "confirm_close",
    "pin",
    "unpin",
    "recent_touch",
  ]) {
    expect(wire.sent, must).toContain(must);
  }
  for (const must of ["text_open", "text_save", "text_check", "watch_dir", "unwatch_dir"].map(
    (c) => `${KERNKRAFT}${c}`
  )) {
    expect(wire.sent, must).toContain(must);
  }
  expectGranted();
});

test("a_file_too_large_for_the_editor_refuses_the_move_and_offers_its_default_application", async () => {
  queue.push({ event: "kern://open", payload: { kind: "load_doc", path: BIG, ack: true } });
  render(<App />);
  expect(await screen.findByTestId("document-window")).toBeInTheDocument();
  await waitFor(() => expect(wire.sent.has("refuse_detach")).toBe(true));
  fireEvent.click(await screen.findByRole("button", { name: "Open in default app" }));
  await waitFor(() => expect(wire.sent.has(`${KERNKRAFT}open_default`)).toBe(true));
  expectGranted();
});
