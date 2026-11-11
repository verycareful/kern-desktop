// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useUserDirs } from "./user-dirs-store";
import { StrictMode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Queued, Settings, WirePath } from "../ipc";
import { useFolderUi } from "../files/folder-ui";
import { entry } from "../files/test-entries";
import { stubLayout } from "../files/test-layout";
import { useViewSettings } from "../files/view-settings";
import { usePanelsStore } from "../store/panels";
import { useLayout } from "../store/layout";
import { useTabs } from "../store/tabs";
import { useOpenDirectives } from "./useOpenDirectives";

// The main window subscribes, takes what was queued for it, applies that
// and then the live events, in order. Nothing it cannot handle is dropped.

const ipc = vi.hoisted(() => ({
  listDir: vi.fn(),
  watchDir: vi.fn(),
  unwatchDir: vi.fn(),
  on: vi.fn(),
  settingsGet: vi.fn(),
  layoutGet: vi.fn(),
  userDirs: vi.fn(),
  volumesList: vi.fn(),
  volumesProblemsTake: vi.fn(),
  openPendingTake: vi.fn(),
  openPaths: vi.fn(),
  confirmClose: vi.fn(),
  themeGet: vi.fn(),
  undoState: vi.fn(),
  prune: vi.fn(),
  pinsGet: vi.fn(),
  storeErrorsTake: vi.fn(),
  // A document tab's editor opens its file and registers it.
  textOpen: vi.fn(),
  textCheck: vi.fn(),
  recentTouch: vi.fn(),
  docOpened: vi.fn(),
  docClosed: vi.fn(),
  docOpenElsewhere: vi.fn(),
  detached: vi.fn(),
  refuseDetach: vi.fn(),
  adopted: vi.fn(),
  refuseAdoption: vi.fn(),
  moveDocToMain: vi.fn(),
  sessionPut: vi.fn(),
  sessionClosedGet: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import App from "../App";
import { usePinnedRecent } from "./pinned-recent-store";
import { useProperties } from "../files/properties-store";
import { EMPTY_PRUNE } from "./test-pinned-recent";
import { EditorView } from "@codemirror/view";
import { useCloseGuard } from "./useCloseGuard";
import { useOps } from "../ops/useOps";

const p = (v: string): WirePath => ({ k: "Utf8", v });
let handlers: Record<string, (payload: unknown) => void>;
let calls: string[];
let queued: Queued[];
let restoreLayout: () => void;

beforeEach(() => {
  useUserDirs.getState().reset();
  restoreLayout = stubLayout();
  handlers = {};
  calls = [];
  queued = [];
  ipc.on.mockImplementation((name: string, h: (payload: unknown) => void) => {
    calls.push(`on ${name}`);
    handlers[name] = h;
    return Promise.resolve(() => undefined);
  });
  ipc.openPendingTake.mockImplementation(() => {
    calls.push("take");
    return Promise.resolve(queued);
  });
  ipc.openPaths.mockResolvedValue([]);
  ipc.prune.mockResolvedValue(EMPTY_PRUNE);
  ipc.pinsGet.mockResolvedValue({ entries: [] });
  ipc.storeErrorsTake.mockResolvedValue([]);
  ipc.textOpen.mockResolvedValue({
    path: p("/d/n.md"),
    text: "hello",
    ending: "lf",
    bom: false,
    read_only: null,
    stamp: "s1:5:0:1:1:0",
  });
  ipc.textCheck.mockResolvedValue("same");
  ipc.recentTouch.mockResolvedValue({ entries: [] });
  ipc.docOpened.mockResolvedValue(undefined);
  ipc.docClosed.mockResolvedValue(undefined);
  ipc.docOpenElsewhere.mockResolvedValue({ state: "free" });
  ipc.detached.mockResolvedValue(undefined);
  ipc.refuseDetach.mockResolvedValue(undefined);
  usePinnedRecent.getState().reset();
  useCloseGuard.getState().reset();
  useOps.setState({ notice: null });
  ipc.adopted.mockResolvedValue(undefined);
  ipc.refuseAdoption.mockResolvedValue(undefined);
  ipc.moveDocToMain.mockResolvedValue(undefined);
  ipc.sessionPut.mockResolvedValue(undefined);
  ipc.sessionClosedGet.mockResolvedValue(0);
  useProperties.getState().close();
  ipc.confirmClose.mockResolvedValue(undefined);
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  ipc.watchDir.mockResolvedValue(undefined);
  ipc.unwatchDir.mockResolvedValue(undefined);
  ipc.themeGet.mockResolvedValue({
    css: ":root{}",
    tokens: { scheme: "light" },
    fallbacks: [],
    problems: [],
  });
  ipc.undoState.mockResolvedValue({ undo: null, redo: null });
  ipc.userDirs.mockResolvedValue({ home: p("/home/t"), dirs: [] });
  ipc.volumesProblemsTake.mockResolvedValue([]);
  ipc.volumesList.mockResolvedValue({ mounted: [], unmounted: [], problems: [] });
  ipc.settingsGet.mockResolvedValue({
    show_hidden: false,
    view_mode: "list",
    theme_mode: "system",
    accent: "slate",
    follow: { colours: true, accent: true, fonts: true, radius: true },
    default_layout: "file_manager",
    new_tab_folder: null,
    new_tab_default: "folder",
    panel_order: ["places", "folder", "pinned"],
    editor_panel_order: ["places", "pinned"],
  } as Settings);
  ipc.layoutGet.mockResolvedValue({
    left_width: 280,
    left_open: true,
    tree_root: null,
  });
  ipc.listDir.mockImplementation((path: { v: string }) =>
    Promise.resolve(["a", "b", "c"].map((n) => entry(n, {}, path.v)))
  );
  useViewSettings.setState({ loaded: false, error: null });
  useFolderUi.setState({ sort: {} });
  useTabs.setState({ tabs: [], activeId: null, views: {}, selectRequests: {} });
  usePanelsStore.setState({ leftSlid: false, rightSlid: false });
});
afterEach(async () => {
  cleanup();
  await Promise.resolve();
  restoreLayout();
  vi.clearAllMocks();
});

const queue = (...items: Queued[]) => {
  queued = items;
};
const open = (payload: unknown): Queued => ({ event: "kern://open", payload });
const folder = (v: string) => open({ kind: "folder_tab", path: p(v) });
const emit = (name: string, payload: unknown) => act(async () => handlers[name]?.(payload));
const tabNames = () => screen.queryAllByRole("tab").map((t) => t.textContent);
const selectedNames = () =>
  screen
    .queryAllByTestId("file-row")
    .filter((r) => r.getAttribute("aria-selected") === "true")
    .map((r) => r.getAttribute("data-name"));

test("the_window_subscribes_before_it_takes_the_queue", async () => {
  queue(folder("/d/docs"));
  render(<App />);
  expect(await screen.findByRole("tab", { name: "docs" })).toBeInTheDocument();
  const take = calls.indexOf("take");
  expect(take).toBeGreaterThan(-1);
  for (const name of ["kern://open", "kern://select", "kern://open-error"]) {
    const at = calls.indexOf(`on ${name}`);
    expect(at, name).toBeGreaterThan(-1);
    expect(at, name).toBeLessThan(take);
  }
  expect(ipc.openPendingTake).toHaveBeenCalledTimes(1);
});

test("a_cold_start_with_a_queued_folder_shows_that_folder_and_no_home", async () => {
  queue(folder("/d/docs"));
  render(<App />);
  expect(await screen.findByRole("tab", { name: "docs" })).toBeInTheDocument();
  await act(async () => {});
  // No Home tab; the one lookup is the places strip's.
  expect(tabNames()).toEqual(["docs"]);
  expect(ipc.userDirs).toHaveBeenCalledTimes(1);
});

test("a_cold_start_with_nothing_queued_opens_home", async () => {
  render(<App />);
  expect(await screen.findByRole("tab", { name: "t" })).toBeInTheDocument();
  expect(tabNames()).toEqual(["t"]);
});

test("queued_items_are_applied_in_order", async () => {
  queue(folder("/d/one"), folder("/d/two"), open({ kind: "doc_tab", path: p("/d/n.md") }));
  render(<App />);
  await waitFor(() => expect(tabNames()).toHaveLength(3));
  expect(tabNames()).toEqual(["one", "two", "n.md"]);
  // The last one applied is the one shown.
  expect(useTabs.getState().tabs.find((t) => t.id === useTabs.getState().activeId)).toMatchObject({
    kind: "doc",
  });
});

const restore = (tabs: unknown[], active: number | null) => open({ kind: "restore", tabs, active });
const activeKind = () =>
  useTabs.getState().tabs.find((t) => t.id === useTabs.getState().activeId)?.kind;

test("a_restore_opens_its_tabs_in_order_with_the_kept_one_in_front_and_no_home", async () => {
  queue(
    restore(
      [
        { kind: "folder", path: p("/d/one") },
        { kind: "doc", path: p("/d/n.md") },
        { kind: "trash" },
        { kind: "documents" },
      ],
      1
    )
  );
  render(<App />);
  await waitFor(() => expect(tabNames()).toEqual(["one", "n.md", "Trash", "Library"]));
  expect(activeKind()).toBe("doc");
  await act(async () => {});
  expect(tabNames()).toEqual(["one", "n.md", "Trash", "Library"]);
  // The window reports what it shows, so the next launch opens it again.
  await waitFor(() =>
    expect(ipc.sessionPut).toHaveBeenLastCalledWith(
      null,
      [
        { kind: "folder", path: p("/d/one") },
        { kind: "doc", path: p("/d/n.md") },
        { kind: "trash" },
        { kind: "documents" },
      ],
      1
    )
  );
});

test("a_restore_naming_no_tab_in_front_leaves_the_last_one_opened_in_front", async () => {
  queue(
    restore(
      [
        { kind: "doc", path: p("/d/n.md") },
        { kind: "folder", path: p("/d/two") },
      ],
      null
    )
  );
  render(<App />);
  await waitFor(() => expect(tabNames()).toEqual(["n.md", "two"]));
  expect(activeKind()).toBe("folder");
});

test("a_restore_in_an_editor_window_roots_its_tree_and_opens_its_documents", async () => {
  queue(
    open({ kind: "editor_root", path: p("/d/proj") }),
    restore(
      [
        { kind: "doc", path: p("/d/proj/a.txt") },
        { kind: "doc", path: p("/d/proj/b.txt") },
      ],
      0
    )
  );
  const hook = renderHook(() => useOpenDirectives("editor"));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  expect(useLayout.getState().treeRoot).toEqual(p("/d/proj"));
  const tabs = useTabs.getState().tabs;
  expect(tabs.map((t) => (t.kind === "doc" ? t.path : null))).toEqual([
    p("/d/proj/a.txt"),
    p("/d/proj/b.txt"),
  ]);
  expect(useTabs.getState().activeId).toBe(tabs[0]!.id);
  expect(hook.result.current.notices).toEqual([]);
  hook.unmount();
  useLayout.getState().reset();
});

test("a_restore_into_an_untouched_home_replaces_it", async () => {
  render(<App />);
  await screen.findByRole("tab", { name: "t" });
  await emit("kern://open", {
    kind: "restore",
    tabs: [{ kind: "folder", path: p("/d/one") }, { kind: "trash" }],
    active: 0,
  });
  expect(tabNames()).toEqual(["one", "Trash"]);
  expect(screen.getByRole("tab", { name: "one" })).toHaveAttribute("aria-selected", "true");
});

test("a_restore_after_home_was_left_or_joined_is_added_after_the_tabs", async () => {
  render(<App />);
  await screen.findByRole("tab", { name: "t" });
  await emit("kern://open", { kind: "folder_tab", path: p("/d/more") });
  await emit("kern://open", { kind: "restore", tabs: [{ kind: "trash" }], active: 0 });
  expect(tabNames()).toEqual(["t", "more", "Trash"]);
  // Home moved to another folder is not untouched either.
  cleanup();
  useTabs.setState({ tabs: [], activeId: null, views: {}, selectRequests: {} });
  render(<App />);
  await screen.findByRole("tab", { name: "t" });
  act(() => useTabs.getState().openFolder(p("/d/sub"), false));
  await emit("kern://open", { kind: "restore", tabs: [{ kind: "trash" }], active: 0 });
  expect(tabNames()).toEqual(["sub", "Trash"]);
});

test("a_live_folder_directive_opens_a_tab", async () => {
  render(<App />);
  await screen.findByRole("tab", { name: "t" });
  await emit("kern://open", { kind: "folder_tab", path: p("/d/more") });
  expect(await screen.findByRole("tab", { name: "more" })).toBeInTheDocument();
  expect(tabNames()).toEqual(["t", "more"]);
});

test("a_folder_already_open_is_focused_not_opened_again", async () => {
  queue(folder("/d/one"), folder("/d/two"));
  render(<App />);
  await waitFor(() => expect(tabNames()).toEqual(["one", "two"]));
  await emit("kern://open", { kind: "folder_tab", path: p("/d/one") });
  expect(tabNames()).toEqual(["one", "two"]);
  expect(screen.getByRole("tab", { name: "one" })).toHaveAttribute("aria-selected", "true");
});

test("home_tab_opens_home_and_focus_tab_activates_a_tab", async () => {
  queue(folder("/d/one"), open({ kind: "home_tab" }));
  render(<App />);
  await waitFor(() => expect(tabNames()).toEqual(["one", "t"]));
  const first = useTabs.getState().tabs[0]!.id;
  await emit("kern://open", { kind: "focus_tab", tab_id: first });
  expect(screen.getByRole("tab", { name: "one" })).toHaveAttribute("aria-selected", "true");
});

test("focus_tab_for_a_tab_that_is_gone_is_reported", async () => {
  render(<App />);
  await screen.findByRole("tab", { name: "t" });
  await emit("kern://open", { kind: "focus_tab", tab_id: "nope" });
  expect(await screen.findByRole("alert")).toHaveTextContent(/nope/);
});

test("live_events_during_the_take_are_applied_after_the_queue", async () => {
  let release!: (q: Queued[]) => void;
  ipc.openPendingTake.mockImplementation(() => new Promise<Queued[]>((r) => (release = r)));
  render(<App />);
  await waitFor(() => expect(handlers["kern://open"]).toBeDefined());
  await waitFor(() => expect(release).toBeDefined());
  await emit("kern://open", { kind: "folder_tab", path: p("/d/live") });
  expect(tabNames()).toEqual([]);
  await act(async () => release([folder("/d/queued")]));
  await waitFor(() => expect(tabNames()).toEqual(["queued", "live"]));
  expect(ipc.userDirs).toHaveBeenCalledTimes(1);
});

test("a_select_is_applied_once_the_folder_has_listed", async () => {
  queue(folder("/d/x"), {
    event: "kern://select",
    payload: { tab: p("/d/x"), paths: [p("/d/x/b")] },
  });
  render(<App />);
  await waitFor(() => expect(selectedNames()).toEqual(["b"]));
  expect(useTabs.getState().selectRequests).toEqual({});
});

test("a_live_select_on_an_open_listed_folder_selects_at_once", async () => {
  queue(folder("/d/x"));
  render(<App />);
  await waitFor(() => expect(screen.getAllByTestId("file-row")).toHaveLength(3));
  await emit("kern://select", { tab: p("/d/x"), paths: [p("/d/x/a"), p("/d/x/c")] });
  await waitFor(() => expect(selectedNames()).toEqual(["a", "c"]));
});

test("a_select_for_a_folder_with_no_tab_is_reported", async () => {
  render(<App />);
  await screen.findByRole("tab", { name: "t" });
  await emit("kern://select", { tab: p("/d/none"), paths: [p("/d/none/a")] });
  expect(await screen.findByRole("alert")).toHaveTextContent("/d/none");
});

test("an_open_error_is_shown_as_an_alert", async () => {
  queue({
    event: "kern://open-error",
    payload: { kind: "NotFound", message: "no such file", path: null, details: null },
  });
  render(<App />);
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("NotFound");
  expect(alert).toHaveTextContent("no such file");
  // A live one is added to it.
  await emit("kern://open-error", { kind: "Io", message: "second", path: null, details: null });
  expect(await screen.findByText(/second/)).toBeInTheDocument();
  fireEvent.click(within(screen.getAllByRole("alert")[0]!).getAllByRole("button")[0]!);
});

test("properties_from_another_program_open_the_dialog", async () => {
  queue({ event: "kern://properties", payload: { paths: [p("/d/a")] } });
  render(<App />);
  expect(await screen.findByRole("dialog", { name: "Properties of a" })).toBeInTheDocument();
});

test("an_event_this_window_cannot_handle_is_reported_never_dropped", async () => {
  queue(open({ kind: "load_doc", path: p("/d/a") }));
  render(<App />);
  await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
  const text = screen
    .getAllByRole("alert")
    .map((a) => a.textContent)
    .join("\n");
  expect(text).toContain("load_doc");
  await emit("kern://open", { kind: "teleport", path: p("/d/a") });
  expect(
    screen
      .getAllByRole("alert")
      .map((a) => a.textContent)
      .join("\n")
  ).toContain("teleport");
});

test("a_failed_take_is_reported_and_home_still_opens", async () => {
  ipc.openPendingTake.mockRejectedValue({ kind: "Io", message: "no queue", path: null });
  render(<App />);
  expect(await screen.findByRole("tab", { name: "t" })).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("no queue");
});

test("only_the_live_run_takes_the_queue_under_strict_mode", async () => {
  queue(folder("/d/docs"));
  render(
    <StrictMode>
      <App />
    </StrictMode>
  );
  expect(await screen.findByRole("tab", { name: "docs" })).toBeInTheDocument();
  await act(async () => {});
  expect(tabNames()).toEqual(["docs"]);
  expect(ipc.openPendingTake).toHaveBeenCalledTimes(1);
});

test("events_buffered_before_a_failed_take_are_still_applied", async () => {
  let fail!: (e: unknown) => void;
  ipc.openPendingTake.mockImplementation(() => new Promise<Queued[]>((_, r) => (fail = r)));
  render(<App />);
  await waitFor(() => expect(fail).toBeDefined());
  await emit("kern://open", { kind: "folder_tab", path: p("/d/live") });
  await act(async () => fail({ kind: "Io", message: "no queue", path: null, details: null }));
  await waitFor(() => expect(tabNames()).toEqual(["live"]));
  expect(screen.getByRole("alert")).toHaveTextContent("no queue");
});

test("a_hidden_item_that_cannot_be_selected_is_said_to_be_hidden", async () => {
  queue(folder("/d/x"), {
    event: "kern://select",
    payload: { tab: p("/d/x"), paths: [p("/d/x/.bashrc"), p("/d/x/zzz")] },
  });
  render(<App />);
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(/\.bashrc.*hidden/);
  expect(alert).toHaveTextContent(/zzz.*not in this folder/i);
});

test("opening_an_item_does_not_wipe_the_select_report", async () => {
  queue(folder("/d/x"), {
    event: "kern://select",
    payload: { tab: p("/d/x"), paths: [p("/d/x/zzz")] },
  });
  render(<App />);
  await screen.findByRole("alert");
  fireEvent.doubleClick((await screen.findAllByTestId("file-row"))[0]!);
  await waitFor(() => expect(ipc.openPaths).toHaveBeenCalled());
  await act(async () => {});
  expect(screen.getByRole("alert")).toHaveTextContent(/zzz/);
});

test("close_requested_closes_the_window_when_no_tab_is_dirty", async () => {
  render(<App />);
  await screen.findByRole("tab", { name: "t" });
  await emit("kern://close-requested", null);
  expect(ipc.confirmClose).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("alert")).toBeNull();
});

test("a_failed_close_is_shown", async () => {
  ipc.confirmClose.mockRejectedValue({ kind: "Io", message: "cannot close", path: null });
  render(<App />);
  await screen.findByRole("tab", { name: "t" });
  await emit("kern://close-requested", null);
  expect(await screen.findByTestId("status-notice")).toHaveTextContent("cannot close");
});

/** Types `text` at the start of every document editor on show or hidden. */
async function editEveryDocument(text: string, count: number) {
  await waitFor(() =>
    expect(document.querySelectorAll('[data-testid="editor-host"] .cm-content')).toHaveLength(count)
  );
  for (const host of screen.getAllByTestId("editor-host")) {
    act(() => EditorView.findFromDOM(host)!.dispatch({ changes: { from: 0, insert: text } }));
  }
}

test("close_main_lists_all_dirty", async () => {
  render(<App />);
  await screen.findByRole("tab", { name: "t" });
  act(() => useTabs.getState().openDoc(p("/d/n.md")));
  act(() => useTabs.getState().openDoc(p("/d/m.md")));
  await editEveryDocument("x", 2);
  await emit("kern://close-requested", null);
  const prompt = await screen.findByTestId("close-prompt");
  expect(prompt).toHaveTextContent("Save 2 documents before closing the window?");
  expect(within(screen.getByTestId("close-prompt-list")).getAllByRole("listitem")).toHaveLength(2);
  expect(prompt).toHaveTextContent(/n\.md has unsaved changes/);
  expect(prompt).toHaveTextContent(/m\.md has unsaved changes/);

  // cancel_keeps_window: nothing closes, the text stays.
  fireEvent.click(within(prompt).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByTestId("close-prompt")).toBeNull();
  expect(ipc.confirmClose).not.toHaveBeenCalled();
  expect(useTabs.getState().tabs).toHaveLength(3);

  await emit("kern://close-requested", null);
  fireEvent.click(
    within(await screen.findByTestId("close-prompt")).getByRole("button", {
      name: "Close without saving",
    })
  );
  await waitFor(() => expect(ipc.confirmClose).toHaveBeenCalledTimes(1));
});

test("a_document_that_arrives_while_the_close_question_is_open_is_asked_about_too", async () => {
  render(<App />);
  await screen.findByRole("tab", { name: "t" });
  act(() => useTabs.getState().openDoc(p("/d/n.md")));
  await editEveryDocument("x", 1);
  await emit("kern://close-requested", null);
  await screen.findByTestId("close-prompt");
  // Home in a document window while the question is open.
  const handed = {
    text: "theirs",
    saved: "hello",
    stamp: "s1:5:0:1:1:0",
    ending: "lf",
    bom: false,
    read_only: null,
  };
  await emit("kern://adopt-doc", { path: p("/d/m.md"), text_state: handed, from: "doc-1" });
  await waitFor(() => expect(ipc.adopted).toHaveBeenCalledWith("doc-1"));
  fireEvent.click(screen.getByRole("button", { name: "Close without saving" }));
  // n.md was given up; m.md was not in that question, so it is asked about before anything closes.
  const again = await screen.findByTestId("close-prompt");
  await waitFor(() => expect(again).toHaveTextContent("Save the changes to m.md before closing?"));
  expect(ipc.confirmClose).not.toHaveBeenCalled();
  fireEvent.click(within(again).getByRole("button", { name: "Cancel" }));
  await act(async () => {});
  expect(ipc.confirmClose).not.toHaveBeenCalled();
});

test("an_arrival_during_the_question_given_up_too_lets_the_window_close", async () => {
  render(<App />);
  await screen.findByRole("tab", { name: "t" });
  act(() => useTabs.getState().openDoc(p("/d/n.md")));
  await editEveryDocument("x", 1);
  await emit("kern://close-requested", null);
  await screen.findByTestId("close-prompt");
  const handed = {
    text: "theirs",
    saved: "hello",
    stamp: "s1:5:0:1:1:0",
    ending: "lf",
    bom: false,
    read_only: null,
  };
  await emit("kern://adopt-doc", { path: p("/d/m.md"), text_state: handed, from: "doc-1" });
  await waitFor(() => expect(ipc.adopted).toHaveBeenCalledWith("doc-1"));
  fireEvent.click(screen.getByRole("button", { name: "Close without saving" }));
  // Asked about m.md alone: n.md, given up, is not asked about twice.
  const again = await screen.findByTestId("close-prompt");
  await waitFor(() => expect(again).toHaveTextContent("Save the changes to m.md before closing?"));
  expect(again).not.toHaveTextContent("n.md");
  fireEvent.click(within(again).getByRole("button", { name: "Close without saving" }));
  await waitFor(() => expect(ipc.confirmClose).toHaveBeenCalledTimes(1));
});

test("a_document_sent_while_the_window_is_closing_is_refused", async () => {
  ipc.confirmClose.mockImplementation(() => new Promise(() => undefined));
  render(<App />);
  await screen.findByRole("tab", { name: "t" });
  await emit("kern://close-requested", null);
  await waitFor(() => expect(ipc.confirmClose).toHaveBeenCalled());
  await emit("kern://adopt-doc", { path: p("/d/n.md"), text_state: null, from: "doc-1" });
  expect(ipc.refuseAdoption).toHaveBeenCalledWith("doc-1", expect.stringMatching(/closing/));
  expect(ipc.adopted).not.toHaveBeenCalled();
  expect(screen.queryByRole("tab", { name: /n\.md/ })).toBeNull();
});

test("a_document_main_cannot_register_is_refused_at_once", async () => {
  render(<App />);
  await screen.findByRole("tab", { name: "t" });
  ipc.docOpened.mockRejectedValueOnce({ kind: "Io", message: "registry gone", path: null });
  await emit("kern://adopt-doc", { path: p("/d/n.md"), text_state: null, from: "doc-1" });
  expect(ipc.adopted).not.toHaveBeenCalled();
  expect(ipc.refuseAdoption).toHaveBeenCalledWith(
    "doc-1",
    expect.stringMatching(/could not register the document: .*registry gone/)
  );
  expect(screen.queryByRole("tab", { name: /n\.md/ })).toBeNull();
});

test("cancel_keeps_window", async () => {
  render(<App />);
  await screen.findByRole("tab", { name: "t" });
  act(() => useTabs.getState().openDoc(p("/d/n.md")));
  await editEveryDocument("x", 1);
  await emit("kern://close-requested", null);
  fireEvent.click(
    within(await screen.findByTestId("close-prompt")).getByRole("button", { name: "Cancel" })
  );
  await act(async () => {});
  expect(ipc.confirmClose).not.toHaveBeenCalled();
  expect(screen.getByTestId("main-window")).toBeInTheDocument();
  expect(EditorView.findFromDOM(screen.getByTestId("editor-host"))!.state.doc.toString()).toBe(
    "xhello"
  );
});

test("adopt_doc_opens_a_tab_from_the_handed_text_registers_it_then_acknowledges", async () => {
  const order: string[] = [];
  ipc.docOpened.mockImplementation((path: WirePath, location: { kind: string }) => {
    order.push(`opened ${path.v} ${location.kind}`);
    return Promise.resolve();
  });
  ipc.adopted.mockImplementation((label: string) => {
    order.push(`adopted ${label}`);
    return Promise.resolve();
  });
  render(<App />);
  await screen.findByRole("tab", { name: "t" });
  ipc.textOpen.mockClear();
  const handed = {
    text: "mine\nhello",
    saved: "hello",
    stamp: "s1:5:0:1:1:0",
    ending: "crlf",
    bom: true,
    read_only: null,
  };
  await emit("kern://adopt-doc", { path: p("/d/n.md"), text_state: handed, from: "doc-1" });
  expect(order.slice(0, 2)).toEqual(["opened /d/n.md tab", "adopted doc-1"]);
  await screen.findByRole("tab", { name: /n\.md/ });
  const host = screen.getByTestId("editor-host");
  await waitFor(() => expect(host.querySelector(".cm-content")).not.toBeNull());
  // The text handed over, unsaved edit included; the file is not read again.
  expect(EditorView.findFromDOM(host)!.state.doc.toString()).toBe("mine\nhello");
  expect(ipc.textOpen).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByTestId("status-dirty")).toBeInTheDocument());
  expect(screen.getByTestId("status-bar")).toHaveTextContent(/CRLF/);
  // Registered once, before the acknowledgement; the tab's editor does not repeat it.
  await act(async () => {});
  expect(order.filter((o) => o.startsWith("opened"))).toEqual(["opened /d/n.md tab"]);

  // The backend took the move back, and this copy has unsaved text: the tab is asked about before
  // it goes, and stays while the question is open.
  await emit("kern://adopt-cancelled", { label: "doc-1" });
  const prompt = await screen.findByTestId("close-prompt");
  expect(screen.getByRole("tab", { name: /n\.md/ })).toBeInTheDocument();
  // The notice says what Save would do here: write this copy over the file the other window holds.
  expect(
    screen.getByText(/Save writes this copy over the file the other window holds/)
  ).toBeVisible();
  fireEvent.click(within(prompt).getByRole("button", { name: "Cancel" }));
  await act(async () => {});
  // Cancel keeps it: the user's text is not dropped on their behalf.
  expect(screen.getByRole("tab", { name: /n\.md/ })).toBeInTheDocument();
});

test("a_move_taken_back_drops_a_clean_copy_at_once_and_asks_about_one_with_edits", async () => {
  render(<App />);
  await screen.findByRole("tab", { name: "t" });
  // Clean: handed over with nothing unsaved.
  await emit("kern://adopt-doc", { path: p("/d/n.md"), text_state: null, from: "doc-2" });
  await screen.findByRole("tab", { name: /n\.md/ });
  await emit("kern://adopt-cancelled", { label: "doc-2" });
  expect(screen.queryByRole("tab", { name: /n\.md/ })).toBeNull();
  expect(screen.queryByTestId("close-prompt")).toBeNull();
  // With edits made here after it arrived: asked first, and "Close without saving" drops it.
  await emit("kern://adopt-doc", { path: p("/d/n.md"), text_state: null, from: "doc-3" });
  await screen.findByRole("tab", { name: /n\.md/ });
  await editEveryDocument("x", 1);
  await emit("kern://adopt-cancelled", { label: "doc-3" });
  fireEvent.click(
    within(await screen.findByTestId("close-prompt")).getByRole("button", {
      name: "Close without saving",
    })
  );
  await waitFor(() => expect(screen.queryByRole("tab", { name: /n\.md/ })).toBeNull());
});

test("adopt_doc_with_an_unreadable_state_is_refused_with_the_reason", async () => {
  render(<App />);
  await screen.findByRole("tab", { name: "t" });
  await emit("kern://adopt-doc", {
    path: p("/d/n.md"),
    text_state: { text: 5 },
    from: "doc-1",
  });
  expect(ipc.adopted).not.toHaveBeenCalled();
  expect(ipc.refuseAdoption).toHaveBeenCalledWith("doc-1", expect.stringMatching(/could not read/));
  expect(screen.queryByRole("tab", { name: /n\.md/ })).toBeNull();
});

test("adopt_doc_of_a_path_already_open_in_a_tab_is_refused", async () => {
  render(<App />);
  await screen.findByRole("tab", { name: "t" });
  act(() => useTabs.getState().openDoc(p("/d/n.md")));
  await emit("kern://adopt-doc", { path: p("/d/n.md"), text_state: null, from: "doc-1" });
  expect(ipc.adopted).not.toHaveBeenCalled();
  expect(ipc.refuseAdoption).toHaveBeenCalledWith(
    "doc-1",
    expect.stringMatching(/already open in a tab/)
  );
  expect(useTabs.getState().tabs.filter((t) => t.kind === "doc")).toHaveLength(1);
});

test("a_failed_acknowledgement_drops_the_tab_and_says_why", async () => {
  ipc.adopted.mockRejectedValue({ kind: "NoAdoption", message: "too late", path: null });
  render(<App />);
  await screen.findByRole("tab", { name: "t" });
  ipc.docOpened.mockClear();
  await emit("kern://adopt-doc", { path: p("/d/n.md"), text_state: null, from: "doc-1" });
  expect(screen.queryByRole("tab", { name: /n\.md/ })).toBeNull();
  expect(await screen.findByRole("alert")).toHaveTextContent("too late");
  // The backend registered the window for the document again when it took the move back: this
  // window registers nothing for it, so it cannot take the path from the window that keeps it.
  await act(async () => {});
  expect(ipc.docOpened.mock.calls.filter((c) => c[1].kind === "window")).toHaveLength(0);
  expect(ipc.docOpened.mock.calls.filter((c) => c[1].kind === "tab")).toHaveLength(1);
});

test("the_tab_made_for_a_move_is_registered_as_the_result_of_that_move", async () => {
  render(<App />);
  await screen.findByRole("tab", { name: "t" });
  ipc.docOpened.mockClear();
  await emit("kern://adopt-doc", { path: p("/d/n.md"), text_state: null, from: "doc-7" });
  const tab = useTabs.getState().tabs.find((t) => t.kind === "doc")!;
  expect(ipc.docOpened).toHaveBeenCalledWith(
    p("/d/n.md"),
    { kind: "tab", window: "main", tab_id: tab.id },
    "doc-7"
  );
});

test("a_registration_refused_because_the_move_was_taken_back_drops_the_tab_and_releases_nothing", async () => {
  render(<App />);
  await screen.findByRole("tab", { name: "t" });
  ipc.docOpened.mockClear();
  ipc.docClosed.mockClear();
  ipc.docOpened.mockRejectedValueOnce({
    kind: "AdoptionOver",
    message: "the move is over",
    path: null,
  });
  await emit("kern://adopt-doc", { path: p("/d/n.md"), text_state: null, from: "doc-1" });
  // The window keeps the document and nobody waits for a refusal or an acknowledgement.
  expect(screen.queryByRole("tab", { name: /n\.md/ })).toBeNull();
  expect(ipc.adopted).not.toHaveBeenCalled();
  expect(ipc.refuseAdoption).not.toHaveBeenCalled();
  expect(await screen.findByText(/stays where it was/)).toBeInTheDocument();
  // The tab never registered, so releasing the path would take it from the window.
  await act(async () => {});
  expect(ipc.docClosed).not.toHaveBeenCalled();
});

function asDocWindow() {
  (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "doc-1" } },
  };
}

test("a_document_window_shows_the_document_it_is_given", async () => {
  asDocWindow();
  queue(open({ kind: "load_doc", path: p("/d/n.md") }));
  render(<App />);
  expect(await screen.findByTestId("document-window")).toBeInTheDocument();
  await waitFor(() => expect(ipc.textOpen).toHaveBeenCalledWith(p("/d/n.md")));
  await waitFor(() =>
    expect(ipc.docOpened).toHaveBeenCalledWith(p("/d/n.md"), { kind: "window", label: "doc-1" })
  );
  // The directives a document window answers to; nothing of the main window's (adopt, select).
  const directives = ["open", "open-error", "close-requested", "adopt-doc", "select", "properties"];
  expect(calls.filter((c) => directives.some((d) => c === `on kern://${d}`))).toEqual([
    "on kern://open",
    "on kern://open-error",
    "on kern://close-requested",
  ]);
  expect(ipc.openPendingTake).toHaveBeenCalledTimes(1);
  // No tab row, no side panels, no Home folder.
  expect(screen.queryByRole("tablist")).toBeNull();
  expect(screen.queryByTestId("places-strip")).toBeNull();
  expect(ipc.userDirs).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: /^Home/ })).toBeInTheDocument();
});

test("a_document_window_takes_the_text_a_tab_handed_it", async () => {
  asDocWindow();
  const handed = {
    text: "unsaved",
    saved: "hello",
    stamp: "s1:5:0:1:1:0",
    ending: "lf",
    bom: false,
    read_only: null,
  };
  queue(open({ kind: "load_doc", path: p("/d/n.md"), text_state: handed }));
  render(<App />);
  const host = await screen.findByTestId("editor-host");
  await waitFor(() => expect(host.querySelector(".cm-content")).not.toBeNull());
  expect(EditorView.findFromDOM(host)!.state.doc.toString()).toBe("unsaved");
  expect(ipc.textOpen).not.toHaveBeenCalled();
});

test("a_document_window_given_an_unreadable_state_shows_no_file_in_its_place", async () => {
  asDocWindow();
  queue(open({ kind: "load_doc", path: p("/d/n.md"), text_state: { text: 5 } }));
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent(/did not arrive.*not shown/);
  await act(async () => {});
  expect(ipc.textOpen).not.toHaveBeenCalled();
  expect(screen.queryByTestId("text-editor")).toBeNull();
});

test("home_hands_over_unsaved_text", async () => {
  asDocWindow();
  queue(open({ kind: "load_doc", path: p("/d/n.md") }));
  let fail!: (e: unknown) => void;
  ipc.moveDocToMain.mockImplementation(() => new Promise((_, r) => (fail = r)));
  render(<App />);
  const host = await screen.findByTestId("editor-host");
  await waitFor(() => expect(host.querySelector(".cm-content")).not.toBeNull());
  const view = EditorView.findFromDOM(host)!;
  act(() => view.dispatch({ changes: { from: 0, insert: "mine " } }));
  fireEvent.click(screen.getByRole("button", { name: /^Home/ }));
  await waitFor(() => expect(ipc.moveDocToMain).toHaveBeenCalled());
  expect(ipc.moveDocToMain).toHaveBeenCalledWith("doc-1", {
    text: "mine hello",
    saved: "hello",
    stamp: "s1:5:0:1:1:0",
    ending: "lf",
    bom: false,
    read_only: null,
  });
  // While it moves the text cannot change: an edit now would not go with it.
  expect(await screen.findByTestId("doc-moving")).toBeInTheDocument();
  expect(view.state.readOnly).toBe(true);

  // The main window did not take it: it stays here, editable again.
  await act(async () => fail({ kind: "AdoptTimeout", message: "no answer", path: null }));
  expect(await screen.findByTestId("home-error")).toHaveTextContent(/stays here.*no answer/);
  expect(view.state.readOnly).toBe(false);
  expect(view.state.doc.toString()).toBe("mine hello");
});

test("closing_a_document_window_with_unsaved_text_asks", async () => {
  asDocWindow();
  queue(open({ kind: "load_doc", path: p("/d/n.md") }));
  render(<App />);
  await editEveryDocument("x", 1);
  await emit("kern://close-requested", null);
  const prompt = await screen.findByTestId("close-prompt");
  expect(prompt).toHaveTextContent("Save the changes to n.md before closing?");
  expect(ipc.confirmClose).not.toHaveBeenCalled();
  fireEvent.click(within(prompt).getByRole("button", { name: "Close without saving" }));
  await waitFor(() => expect(ipc.confirmClose).toHaveBeenCalledTimes(1));
});

test("a_document_window_can_be_closed", async () => {
  asDocWindow();
  render(<App />);
  await waitFor(() => expect(handlers["kern://close-requested"]).toBeDefined());
  await emit("kern://close-requested", null);
  expect(ipc.confirmClose).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("alert")).toBeNull();
});

test("a_close_request_that_arrives_before_the_subscription_resolves_is_applied", async () => {
  asDocWindow();
  // The event is delivered while `on` is still resolving, as a fast backend can.
  ipc.on.mockImplementation((name: string, h: (payload: unknown) => void) => {
    handlers[name] = h;
    if (name === "kern://close-requested") h(null);
    return Promise.resolve(() => undefined);
  });
  render(<App />);
  await waitFor(() => expect(ipc.confirmClose).toHaveBeenCalledTimes(1));
});

test("a_document_window_that_cannot_close_says_why", async () => {
  asDocWindow();
  ipc.confirmClose.mockRejectedValue({ kind: "Io", message: "cannot close", path: null });
  render(<App />);
  await waitFor(() => expect(handlers["kern://close-requested"]).toBeDefined());
  await emit("kern://close-requested", null);
  expect(await screen.findByTestId("status-notice")).toHaveTextContent("cannot close");
});

test("a_loading_line_shows_until_the_queue_is_applied", async () => {
  let release!: (q: Queued[]) => void;
  ipc.openPendingTake.mockImplementation(() => new Promise<Queued[]>((r) => (release = r)));
  render(<App />);
  expect(await screen.findByRole("status")).toHaveTextContent(/starting/i);
  await waitFor(() => expect(release).toBeDefined());
  await act(async () => release([folder("/d/docs")]));
  expect(await screen.findByRole("tab", { name: "docs" })).toBeInTheDocument();
  expect(screen.queryByText(/starting/i)).toBeNull();
});

// ---- a document window made for a tab's move answers once it holds the document ----

test("a_document_window_made_for_a_move_answers_once_it_holds_and_has_registered_the_document", async () => {
  asDocWindow();
  const order: string[] = [];
  ipc.docOpened.mockImplementation(() => {
    order.push("registered");
    return Promise.resolve();
  });
  ipc.detached.mockImplementation((label: string) => {
    order.push(`detached ${label}`);
    return Promise.resolve();
  });
  const handed = {
    text: "unsaved",
    saved: "hello",
    stamp: "s1:5:0:1:1:0",
    ending: "lf",
    bom: false,
    read_only: null,
  };
  queue(open({ kind: "load_doc", path: p("/d/n.md"), text_state: handed, ack: true }));
  render(<App />);
  await waitFor(() => expect(ipc.detached).toHaveBeenCalledWith("doc-1"));
  // Registered first: the tab gives the document up only when the window can be found for it.
  expect(order).toEqual(["registered", "detached doc-1"]);
  expect(ipc.refuseDetach).not.toHaveBeenCalled();
});

test("a_document_window_opened_plainly_answers_nobody", async () => {
  asDocWindow();
  queue(open({ kind: "load_doc", path: p("/d/n.md") }));
  render(<App />);
  await waitFor(() => expect(ipc.docOpened).toHaveBeenCalled());
  await act(async () => {});
  expect(ipc.detached).not.toHaveBeenCalled();
  expect(ipc.refuseDetach).not.toHaveBeenCalled();
});

test("a_document_window_that_cannot_use_the_text_it_was_given_refuses_the_move", async () => {
  asDocWindow();
  queue(open({ kind: "load_doc", path: p("/d/n.md"), text_state: { text: 5 }, ack: true }));
  render(<App />);
  await waitFor(() =>
    expect(ipc.refuseDetach).toHaveBeenCalledWith("doc-1", expect.stringMatching(/did not arrive/))
  );
  expect(ipc.detached).not.toHaveBeenCalled();
});

test("a_document_window_that_cannot_register_the_document_refuses_the_move", async () => {
  asDocWindow();
  ipc.docOpened.mockRejectedValue({ kind: "Io", message: "registry gone", path: null });
  queue(open({ kind: "load_doc", path: p("/d/n.md"), ack: true }));
  render(<App />);
  await waitFor(() =>
    expect(ipc.refuseDetach).toHaveBeenCalledWith("doc-1", expect.stringMatching(/registered/))
  );
  expect(ipc.detached).not.toHaveBeenCalled();
});

test("a_document_window_whose_file_cannot_be_opened_refuses_the_move", async () => {
  asDocWindow();
  ipc.textOpen.mockRejectedValue({ kind: "NotFound", message: "gone", path: null });
  queue(open({ kind: "load_doc", path: p("/d/n.md"), ack: true }));
  render(<App />);
  await waitFor(() =>
    expect(ipc.refuseDetach).toHaveBeenCalledWith(
      "doc-1",
      expect.stringMatching(/could not be opened/)
    )
  );
  expect(ipc.detached).not.toHaveBeenCalled();
});

// ---- an editor window ----

function asEditorWindow() {
  (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "editor-1" } },
  };
}

test("an_editor_window_is_told_its_folder_and_opens_documents_in_tabs_of_its_own", async () => {
  asEditorWindow();
  queue(
    open({ kind: "editor_root", path: p("/d/project") }),
    open({ kind: "doc_tab", path: p("/d/project/n.md") })
  );
  render(<App />);
  expect(await screen.findByTestId("editor-window")).toBeInTheDocument();
  await waitFor(() => expect(ipc.textOpen).toHaveBeenCalledWith(p("/d/project/n.md")));
  // Registered under this window: the registry names the window that holds the tab.
  await waitFor(() =>
    expect(ipc.docOpened).toHaveBeenCalledWith(p("/d/project/n.md"), {
      kind: "tab",
      window: "editor-1",
      tab_id: useTabs.getState().tabs[0]!.id,
    })
  );
  expect((await import("../store/layout")).useLayout.getState().treeRoot).toEqual(p("/d/project"));
  // The directives an editor window answers to: a document window's, and the documents handed
  // to it; nothing else of the main window's.
  const directives = [
    "open",
    "open-error",
    "close-requested",
    "adopt-doc",
    "adopt-cancelled",
    "select",
    "properties",
  ];
  expect(calls.filter((c) => directives.some((d) => c === `on kern://${d}`))).toEqual([
    "on kern://open",
    "on kern://open-error",
    "on kern://adopt-doc",
    "on kern://adopt-cancelled",
    "on kern://close-requested",
  ]);
  // The left column: the logo over the tree of the folder it was told. The Trash and the
  // Library are tabs of the main window, so its strip has neither.
  const strip = await screen.findByTestId("places-strip");
  expect(within(strip).queryByRole("button", { name: "Trash" })).toBeNull();
  expect(within(strip).queryByRole("button", { name: "Library" })).toBeNull();
  expect(await screen.findByRole("tree", { name: "Folders of project" })).toBeInTheDocument();
  expect(ipc.listDir).toHaveBeenCalledWith(p("/d/project"), false);
  // No Home folder tab: it has documents only.
  expect(useTabs.getState().tabs.every((t) => t.kind === "doc")).toBe(true);
});

test("an_editor_window_focuses_a_tab_it_is_asked_to", async () => {
  asEditorWindow();
  queue(
    open({ kind: "doc_tab", path: p("/d/a.md") }),
    open({ kind: "doc_tab", path: p("/d/b.md") })
  );
  render(<App />);
  await waitFor(() => expect(useTabs.getState().tabs).toHaveLength(2));
  const [first] = useTabs.getState().tabs;
  await emit("kern://open", { kind: "focus_tab", tab_id: first!.id });
  expect(useTabs.getState().activeId).toBe(first!.id);
  await emit("kern://open", { kind: "focus_tab", tab_id: "gone" });
  expect(await screen.findByRole("alert")).toHaveTextContent(/tab that is gone/);
});

test("closing_an_editor_window_with_unsaved_text_asks_and_closes_only_when_answered", async () => {
  asEditorWindow();
  queue(open({ kind: "doc_tab", path: p("/d/n.md") }));
  render(<App />);
  await editEveryDocument("x", 1);
  await emit("kern://close-requested", null);
  const prompt = await screen.findByTestId("close-prompt");
  expect(prompt).toHaveTextContent("Save the changes to n.md before closing?");
  // The window stays until the question is answered.
  await act(async () => {});
  expect(ipc.confirmClose).not.toHaveBeenCalled();
  fireEvent.click(within(prompt).getByRole("button", { name: "Cancel" }));
  await act(async () => {});
  expect(ipc.confirmClose).not.toHaveBeenCalled();
  expect(screen.getByTestId("editor-window")).toBeInTheDocument();
  await emit("kern://close-requested", null);
  fireEvent.click(
    within(await screen.findByTestId("close-prompt")).getByRole("button", {
      name: "Close without saving",
    })
  );
  await waitFor(() => expect(ipc.confirmClose).toHaveBeenCalledTimes(1));
});

test("an_editor_window_with_nothing_unsaved_closes_at_once", async () => {
  asEditorWindow();
  render(<App />);
  await waitFor(() => expect(handlers["kern://close-requested"]).toBeDefined());
  await emit("kern://close-requested", null);
  expect(ipc.confirmClose).toHaveBeenCalledTimes(1);
});

test("closing_a_tab_of_an_editor_window_leaves_the_window_open", async () => {
  asEditorWindow();
  queue(
    open({ kind: "doc_tab", path: p("/d/a.md") }),
    open({ kind: "doc_tab", path: p("/d/b.md") })
  );
  render(<App />);
  await waitFor(() => expect(useTabs.getState().tabs).toHaveLength(2));
  fireEvent.click(screen.getByRole("button", { name: "Close b.md" }));
  await waitFor(() => expect(useTabs.getState().tabs).toHaveLength(1));
  await act(async () => {});
  expect(ipc.confirmClose).not.toHaveBeenCalled();
});

const editorSetting = () =>
  ipc.settingsGet.mockResolvedValue({
    show_hidden: false,
    view_mode: "list",
    theme_mode: "system",
    accent: "slate",
    follow: { colours: true, accent: true, fonts: true, radius: true },
    default_layout: "editor",
    new_tab_folder: null,
    new_tab_default: "folder",
    panel_order: ["places", "folder", "pinned"],
    editor_panel_order: ["places", "pinned"],
  } as Settings);

test("the_main_window_in_the_editor_layout_opens_no_home_tab_and_shows_the_welcome_pane", async () => {
  editorSetting();
  ipc.layoutGet.mockResolvedValue({ left_width: 280, left_open: true, tree_root: p("/home/t") });
  render(<App />);
  expect(await screen.findByTestId("welcome-pane")).toBeInTheDocument();
  await act(async () => {});
  expect(useTabs.getState().tabs).toHaveLength(0);
  // A folder asked for from outside roots the tree: the editor layout has no folder tabs.
  await emit("kern://open", { kind: "folder_tab", path: p("/d/more") });
  const { useLayout } = await import("../store/layout");
  await waitFor(() => expect(useLayout.getState().treeRoot).toEqual(p("/d/more")));
  expect(useTabs.getState().tabs).toHaveLength(0);
  expect(screen.getByTestId("welcome-pane")).toBeInTheDocument();
  // Home asked for from outside roots it at Home.
  await emit("kern://open", { kind: "home_tab" });
  await waitFor(() => expect(useLayout.getState().treeRoot).toEqual(p("/home/t")));
  expect(useTabs.getState().tabs).toHaveLength(0);
});

test("the_file_manager_layout_setting_opens_home", async () => {
  render(<App />);
  expect(await screen.findByRole("tab", { name: "t" })).toBeInTheDocument();
});

// ---- a second open of a file a tab of this window already shows without having registered it ----

test("a_second_open_of_a_path_an_unregistered_tab_shows_focuses_that_tab_and_holds_nothing", async () => {
  // The tab's file did not open, so the tab never registered it.
  ipc.textOpen.mockRejectedValue({ kind: "NotFound", message: "gone", path: null });
  queue(
    open({ kind: "doc_tab", path: p("/d/a.md") }),
    open({ kind: "doc_tab", path: p("/d/b.md") })
  );
  render(<App />);
  await waitFor(() => expect(useTabs.getState().tabs).toHaveLength(2));
  const [first] = useTabs.getState().tabs;
  await emit("kern://open", { kind: "doc_tab", path: p("/d/a.md") });
  // The first tab is shown again; no tab was made, and the backend's hold for this second open,
  // which would outlive nothing, is let go by name.
  expect(useTabs.getState().tabs).toHaveLength(2);
  expect(useTabs.getState().activeId).toBe(first!.id);
  expect(ipc.docClosed).toHaveBeenCalledWith(p("/d/a.md"), { kind: "opening", window: "main" });
  // A path that made a tab holds what the backend routed it with until that tab registers.
  expect(ipc.docClosed).not.toHaveBeenCalledWith(p("/d/b.md"), { kind: "opening", window: "main" });
});
