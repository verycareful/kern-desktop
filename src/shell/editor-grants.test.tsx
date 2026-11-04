// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Queued, WireEntry, WirePath } from "../ipc";
import { entry } from "../files/test-entries";
import { stubLayout } from "../files/test-layout";
import { NO_LAYOUT, SETTINGS } from "../settings/test-settings";

// The commands an editor window's page sends, found by running it: the page is mounted with the
// one place a command leaves it (Tauri's invoke) recording every command name, and used for what
// an editor window offers (its tree, its tabs, saving, Save As, pinning, the Pinned and Recent
// panel, moving a tab to a window, opening a folder as an editor, closing). Each command it sent
// must be granted to `editor-*` by capabilities/editor.json, so a page that starts calling
// something new fails here until the grant is added (or the call removed), and src-tauri/tests/acl.rs
// checks that every grant in that file is one Tauri's access control really honours.

const wire = vi.hoisted(() => ({
  sent: new Set<string>(),
  handlers: {} as Record<string, (payload: unknown) => void>,
  /** Every handler subscribed to an event, in order (`handlers` keeps the last). */
  all: {} as Record<string, ((payload: unknown) => void)[]>,
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
    const handler = (payload: unknown) => h({ payload });
    wire.handlers[name] = handler;
    (wire.all[name] ??= []).push(handler);
    return Promise.resolve(() => undefined);
  },
}));
vi.mock("../files/sort-async", async () => {
  const { sortEntries } = await import("../files/sort");
  return {
    SORT_IN_WORKER_ABOVE: 5000,
    createSorter: () => ({
      sort: (e: WireEntry[], by: "name", dir: "asc") => Promise.resolve(sortEntries(e, by, dir)),
      dispose: () => undefined,
    }),
  };
});

import App from "../App";
import { currentContext, getAction, runAction } from "../keys/actions";
import { useTreeMenu } from "../files/tree-menu-store";
import { useFolderUi } from "../files/folder-ui";
import { useViewSettings } from "../files/view-settings";
import { useOps } from "../ops/useOps";
import { useLayout } from "../store/layout";
import { usePanelsStore } from "../store/panels";
import { useTabs } from "../store/tabs";
import { EMPTY_PRUNE } from "./test-pinned-recent";
import { usePinnedRecent } from "./pinned-recent-store";
import { useUserDirs } from "./user-dirs-store";
import { useCloseGuard } from "./useCloseGuard";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const PROJECT = "/d/project";
const KERNKRAFT = "plugin:kernkraft-tauri|";
/** The pins the backend holds. */
const pinned: WirePath[] = [];

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

function grantedToEditors(): Set<string> {
  const file = resolve(process.cwd(), "src-tauri/capabilities/editor.json");
  const json = JSON.parse(readFileSync(file, "utf8")) as {
    windows: string[];
    permissions: string[];
  };
  expect(json.windows).toEqual(["editor-*"]);
  return new Set(json.permissions);
}

const queued: Queued[] = [
  { event: "kern://open", payload: { kind: "editor_root", path: p(PROJECT) } },
  { event: "kern://open", payload: { kind: "doc_tab", path: p(`${PROJECT}/n.md`) } },
  { event: "kern://open", payload: { kind: "doc_tab", path: p(`${PROJECT}/big.md`) } },
];

const listing = (path: string): WireEntry[] =>
  path === PROJECT
    ? [
        entry("sub", { kind: "dir", target_is_dir: true }, PROJECT),
        entry("alias", { kind: "symlink", target_is_dir: true }, PROJECT),
        entry("n.md", {}, PROJECT),
        entry("other.txt", {}, PROJECT),
      ]
    : [entry("inner.md", {}, path)];

const text = (path: WirePath) => ({
  path,
  text: "hello",
  ending: "lf",
  bom: false,
  read_only: null,
  stamp: "s1:5:0:1:1:0",
});

/** What the backend answers, enough for every page of an editor window to go on. */
function answer(cmd: string, args: Record<string, unknown>): unknown {
  const name = cmd.startsWith(KERNKRAFT) ? cmd.slice(KERNKRAFT.length) : cmd;
  const path = args.path as WirePath | undefined;
  switch (name) {
    case "open_pending_take":
      return queued.splice(0);
    case "list_dir":
      return listing(path!.v);
    case "file_identity":
      return (args.paths as WirePath[]).map((x) => ({ state: "known", dev: "1", ino: x.v.length }));
    case "text_open":
      if (path!.v.endsWith("big.md")) {
        throw { kind: "TooLargeToOpen", message: "too large", path: null, details: null };
      }
      return text(path!);
    case "text_save":
      return "s2:5:0:1:1:1";
    case "text_check":
      return "same";
    case "entry_of":
      throw { kind: "NotFound", message: "no such file", path: null, details: null };
    case "doc_open_elsewhere":
      return { state: "free" };
    case "detach_doc":
      return "doc-1";
    case "open_editor":
      return "editor-2";
    case "settings_get":
    case "settings_set":
      return SETTINGS;
    case "layout_get":
      return { ...NO_LAYOUT, layout: "editor", tree_root: p(PROJECT) };
    case "user_dirs":
      return { home: p("/home/a"), dirs: [{ name: "documents", path: p("/home/a/Documents") }] };
    case "volumes_list":
      return { mounted: [], unmounted: [], problems: [] };
    case "theme_get":
      return { css: ":root{}", fallbacks: [], problems: [] };
    case "prune":
      return {
        ...EMPTY_PRUNE,
        pins: { entries: pinned },
        recents: { entries: [{ path: p("/d/recent.md"), opened_ms: 1 }] },
      };
    case "pin":
      pinned.push(path!);
      return { entries: pinned };
    case "unpin":
      pinned.splice(0, pinned.length, ...pinned.filter((x) => x.v !== path!.v));
      return { entries: pinned };
    case "pins_get":
    case "pins_reorder":
      return { entries: pinned };
    case "recent_touch":
      return { entries: [] };
    case "mime_of":
      return path!.v === "/d/folder"
        ? { mime: "inode/directory", is_text: false }
        : { mime: "text/plain", is_text: true };
    case "open_paths":
      return (args.paths as WirePath[]).map((x) => ({
        path: x,
        action: "doc_tab",
        location: null,
        error: null,
      }));
    case "same_filesystem":
      return (args.sources as WirePath[]).map(() => ({ state: "checked", same: true }));
    case "start_op":
      return 7;
    case "undo_state":
      return { undo: null, redo: null };
    case "store_errors_take":
    case "volumes_problems_take":
      return [];
    default:
      // watch_dir, unwatch_dir, doc_opened, doc_closed, open_default, confirm_close.
      return null;
  }
}

beforeEach(() => {
  restoreLayout = stubLayout();
  (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "editor-1" } },
  };
  pinned.splice(0, pinned.length, p("/d/pinned.md"), p("/d/pinned-too.md"), p("/d/folder"));
  wire.sent.clear();
  wire.handlers = {};
  wire.all = {};
  wire.answer = answer;
  queued.length = 0;
  queued.push(
    { event: "kern://open", payload: { kind: "editor_root", path: p(PROJECT) } },
    { event: "kern://open", payload: { kind: "doc_tab", path: p(`${PROJECT}/n.md`) } },
    { event: "kern://open", payload: { kind: "doc_tab", path: p(`${PROJECT}/big.md`) } }
  );
  useUserDirs.getState().reset();
  usePinnedRecent.getState().reset();
  useCloseGuard.getState().reset();
  useLayout.getState().reset();
  useTreeMenu.getState().setCurrent(null);
  useOps.setState({ notice: null });
  useTabs.setState({ tabs: [], activeId: null, views: {}, selectRequests: {} });
  usePanelsStore.setState({ leftSlid: false, rightSlid: false });
  useViewSettings.setState({ loaded: false, error: null });
  useFolderUi.setState({ sort: {} });
});
afterEach(async () => {
  cleanup();
  await Promise.resolve();
  restoreLayout();
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  vi.clearAllMocks();
});

const run = (id: string) => act(async () => runAction(getAction(id), currentContext()));

test("every_command_an_editor_windows_page_sends_is_granted_to_editor_windows", async () => {
  render(<App />);
  expect(await screen.findByTestId("editor-window")).toBeInTheDocument();

  // The tree: a folder expands (listed, watched) and collapses (unwatched); a link to a folder
  // is checked for a loop; a file opens.
  const tree = await screen.findByRole("tree", { name: "Folders of project" });
  const row = (name: string) =>
    within(tree)
      .getAllByTestId("tree-row")
      .find((r) => r.getAttribute("data-name") === name)!;
  await waitFor(() => expect(wire.sent.has(`${KERNKRAFT}text_open`)).toBe(true));
  fireEvent.click(row("sub"));
  await waitFor(() => expect(within(tree).getByText("inner.md")).toBeInTheDocument());
  fireEvent.click(row("sub"));
  fireEvent.click(row("alias"));
  fireEvent.click(row("other.txt"));

  // The documents: n.md opens, is registered, edited and saved, and a change on disk is checked;
  // big.md is too large for the editor and offers its default application.
  await waitFor(() => expect(document.querySelectorAll(".cm-content")).toHaveLength(1));
  const host = screen.getAllByTestId("editor-host")[0]!;
  act(() => EditorView.findFromDOM(host)!.dispatch({ changes: { from: 0, insert: "x" } }));
  await run("doc.save");
  await act(async () =>
    wire.handlers["kernkraft://dir-changed"]?.({
      key: `doc:${useTabs.getState().tabs[0]!.id}`,
      error: null,
    })
  );
  const big = useTabs.getState().tabs.find((t) => t.kind === "doc" && t.path.v.endsWith("big.md"))!;
  act(() => useTabs.getState().activate(big.id));
  fireEvent.click(await screen.findByRole("button", { name: "Open in default app" }));
  act(() => useTabs.getState().activate(useTabs.getState().tabs[0]!.id));

  // Save As to a free name, then pinning and unpinning the document.
  await run("doc.saveAs");
  const field = await waitFor(() =>
    document.querySelector<HTMLInputElement>("input.kern-modal-input")!
  );
  fireEvent.change(field, { target: { value: `${PROJECT}/saved.md` } });
  fireEvent.keyDown(field, { key: "Enter" });
  await waitFor(() => expect(wire.sent.has(`${KERNKRAFT}text_save`)).toBe(true));
  await run("doc.pin");
  await run("doc.pin");

  // The Pinned and Recent panel: each entry's kind is looked up, an entry opens, a pin moves.
  await run("panel.right.toggle");
  const panel = await screen.findByTestId("side-panel");
  fireEvent.click(await within(panel).findByText("recent.md"));
  await act(async () => usePinnedRecent.getState().shift(p("/d/pinned-too.md"), -1));
  fireEvent.click(await within(panel).findByText("folder"));

  // Files dropped from another program: the pointer is told where it is, a drop on a folder of the
  // tree is moved there (judged by the filesystems), and a drop on the documents opens a text file.
  const elementAt = (el: Element) =>
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => el });
  const view = { width: window.innerWidth, height: window.innerHeight };
  const said = (event: string, payload: unknown) =>
    act(async () => wire.all[event]?.forEach((h) => h(payload)));
  elementAt(row("sub"));
  await said("kern://drag-over", { drag: 1, position: { x: 5, y: 5 }, view });
  await said("kern://drop", {
    paths: [p("/x/f")],
    position: { x: 5, y: 5 },
    view,
    offered: ["copy", "move"],
    modifier: null,
    drag: 1,
  });
  await waitFor(() => expect(wire.sent.has(`${KERNKRAFT}start_op`)).toBe(true));
  const docs = document.querySelector("[data-drop-docs]")!;
  expect(docs).not.toBeNull();
  elementAt(docs);
  await said("kern://drag-over", { drag: 2, position: { x: 5, y: 5 }, view });
  await said("kern://drop", {
    paths: [p("/x/g.txt")],
    position: { x: 5, y: 5 },
    view,
    offered: ["copy"],
    modifier: null,
    drag: 2,
  });
  delete (document as { elementFromPoint?: unknown }).elementFromPoint;

  // Opening a folder of the tree as an editor, and moving the tab to a window of its own.
  useTreeMenu.getState().setCurrent(listing(PROJECT)[0]!);
  await run("tree.openAsEditor");
  await run("tab.detach");

  // The interface size is a setting; a close with nothing unsaved is confirmed at once.
  await run("view.size.larger");
  await act(async () => wire.handlers["kern://close-requested"]?.(null));
  await waitFor(() => expect(wire.sent.has("confirm_close")).toBe(true));

  // What the run covered: the kinds of command the page is made of.
  for (const must of [
    "list_dir",
    "watch_dir",
    "unwatch_dir",
    "text_open",
    "text_save",
    "text_check",
    "open_default",
    "mime_of",
    "user_dirs",
    "theme_get",
    "volumes_list",
    "same_filesystem",
    "start_op",
    "undo_state",
  ].map((c) => `${KERNKRAFT}${c}`)) {
    expect(wire.sent, must).toContain(must);
  }
  for (const must of [
    "file_identity",
    "open_paths",
    "pins_reorder",
    "doc_opened",
    "doc_closed",
    "doc_open_elsewhere",
    "detach_doc",
    "open_editor",
    "open_pending_take",
    "settings_get",
    "settings_set",
    "layout_get",
    "pin",
    "unpin",
    "prune",
    "recent_touch",
    "confirm_close",
    "dnd_target",
  ]) {
    expect(wire.sent, must).toContain(must);
  }

  const granted = grantedToEditors();
  const missing = [...wire.sent]
    .map((cmd) => ({ cmd, permission: permissionOf(cmd) }))
    .filter((x) => x.permission !== null && !granted.has(x.permission));
  expect(missing).toEqual([]);
});
