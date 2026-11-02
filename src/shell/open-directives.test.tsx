// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useUserDirs } from "./user-dirs-store";
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Queued, Settings, WirePath } from "../ipc";
import { useFolderUi } from "../files/folder-ui";
import { entry } from "../files/test-entries";
import { stubLayout } from "../files/test-layout";
import { useViewSettings } from "../files/view-settings";
import { usePanelsStore } from "../store/panels";
import { useTabs } from "../store/tabs";

// The main window subscribes, takes what was queued for it, applies that
// and then the live events, in order. Nothing it cannot handle is dropped.

const ipc = vi.hoisted(() => ({
  listDir: vi.fn(),
  watchDir: vi.fn(),
  unwatchDir: vi.fn(),
  on: vi.fn(),
  settingsGet: vi.fn(),
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
  adopted: vi.fn(),
  refuseAdoption: vi.fn(),
  moveDocToMain: vi.fn(),
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
  usePinnedRecent.getState().reset();
  useCloseGuard.getState().reset();
  useOps.setState({ notice: null });
  ipc.adopted.mockResolvedValue(undefined);
  ipc.refuseAdoption.mockResolvedValue(undefined);
  ipc.moveDocToMain.mockResolvedValue(undefined);
  useProperties.getState().close();
  ipc.confirmClose.mockResolvedValue(undefined);
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  ipc.watchDir.mockResolvedValue(undefined);
  ipc.unwatchDir.mockResolvedValue(undefined);
  ipc.themeGet.mockResolvedValue({ css: ":root{}", fallbacks: [], problems: [] });
  ipc.undoState.mockResolvedValue({ undo: null, redo: null });
  ipc.userDirs.mockResolvedValue({ home: p("/home/t"), dirs: [] });
  ipc.volumesProblemsTake.mockResolvedValue([]);
  ipc.volumesList.mockResolvedValue({ mounted: [], unmounted: [], problems: [] });
  ipc.settingsGet.mockResolvedValue({
    show_hidden: false,
    view_mode: "list",
    density: "cozy",
    theme_mode: "system",
    accent: "slate",
    follow: { colours: true, accent: true, fonts: true, radius: true },
  } as Settings);
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

  // The backend took the move back: the tab goes, with nothing asked.
  await emit("kern://adopt-cancelled", { label: "doc-1" });
  expect(screen.queryByRole("tab", { name: /n\.md/ })).toBeNull();
  expect(screen.queryByTestId("close-prompt")).toBeNull();
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

test("a_failed_acknowledgement_drops_the_tab_registers_the_window_again_and_says_why", async () => {
  ipc.adopted.mockRejectedValue({ kind: "NoAdoption", message: "too late", path: null });
  render(<App />);
  await screen.findByRole("tab", { name: "t" });
  ipc.docOpened.mockClear();
  await emit("kern://adopt-doc", { path: p("/d/n.md"), text_state: null, from: "doc-1" });
  expect(screen.queryByRole("tab", { name: /n\.md/ })).toBeNull();
  expect(await screen.findByRole("alert")).toHaveTextContent("too late");
  // The window keeps the document, so the path is registered there again, and last.
  await waitFor(() =>
    expect(ipc.docOpened).toHaveBeenLastCalledWith(p("/d/n.md"), {
      kind: "window",
      label: "doc-1",
    })
  );
  await act(async () => {});
  expect(ipc.docOpened.mock.calls.filter((c) => c[1].kind === "tab")).toHaveLength(1);
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
