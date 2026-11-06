// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { WirePath } from "../ipc";
import { activeTab, recentFolderTab, tabTitle, useTabs, type FolderTab } from "./tabs";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const s = () => useTabs.getState();
const ids = () => s().tabs.map((t) => t.id);
const folder = () => activeTab(s()) as FolderTab;

beforeEach(() => useTabs.setState({ tabs: [], activeId: null }));

test("back_forward_up", () => {
  s().openFolder(p("/home/a"), false);
  s().openFolder(p("/home/a/b"), false);
  s().openFolder(p("/home/a/b/c"), false);
  expect(folder().path).toEqual(p("/home/a/b/c"));
  expect(s().tabs).toHaveLength(1);

  s().back();
  expect(folder().path).toEqual(p("/home/a/b"));
  s().back();
  s().back(); // already at the start: no change
  expect(folder().path).toEqual(p("/home/a"));
  expect(folder().cursor).toBe(0);

  s().forward();
  expect(folder().path).toEqual(p("/home/a/b"));

  // Up is a navigation: it drops the forward entries and can be undone by back.
  s().up();
  expect(folder().path).toEqual(p("/home/a"));
  expect(folder().history).toEqual([p("/home/a"), p("/home/a/b"), p("/home/a")]);
  s().forward(); // nothing ahead
  expect(folder().path).toEqual(p("/home/a"));
  s().back();
  expect(folder().path).toEqual(p("/home/a/b"));
});

test("up_stops_at_root", () => {
  s().openFolder(p("/"), false);
  s().up();
  expect(folder().history).toHaveLength(1);
});

test("up_from_a_bytes_path", () => {
  // "/<0xFF>/b": the parent "/<0xFF>" is not UTF-8, so it stays Bytes.
  const bytes = (...b: number[]): WirePath => ({ k: "Bytes", v: btoa(String.fromCharCode(...b)) });
  s().openFolder(bytes(0x2f, 0xff, 0x2f, 0x62), false);
  s().up();
  expect(folder().path).toEqual(bytes(0x2f, 0xff));
  s().up();
  expect(folder().path).toEqual(p("/"));
  expect(tabTitle(s().tabs[0]!)).toBe("/");
});

test("bytes_title_is_the_last_component", () => {
  const b: WirePath = { k: "Bytes", v: btoa("/x/a\xf6b") };
  s().openFolder(b, false);
  expect(tabTitle(s().tabs[0]!)).toBe("a\ufffdb");
});

test("reopening_the_current_folder_adds_no_history", () => {
  s().openFolder(p("/a"), false);
  s().openFolder(p("/a"), false);
  expect(folder().history).toHaveLength(1);
});

test("new_tab_and_doc_dedupe", () => {
  s().openFolder(p("/a"), false);
  s().openFolder(p("/b"), true);
  expect(s().tabs).toHaveLength(2);
  s().openDoc(p("/a/n.md"));
  const docId = s().activeId;
  s().activate(ids()[0]!);
  s().openDoc(p("/a/n.md"));
  expect(s().tabs).toHaveLength(3);
  expect(s().activeId).toBe(docId);
  // From a document tab, opening a folder starts a folder tab.
  s().openFolder(p("/c"), false);
  expect(s().tabs).toHaveLength(4);
  expect(tabTitle(activeTab(s())!)).toBe("c");
});

test("close_activates_neighbour", () => {
  s().openFolder(p("/a"), false);
  s().openFolder(p("/b"), true);
  s().openFolder(p("/c"), true);
  const [a, b, c] = ids() as [string, string, string];

  s().activate(b);
  s().close(b); // right neighbour
  expect(s().activeId).toBe(c);
  s().close(c); // no right neighbour: the left
  expect(s().activeId).toBe(a);
  s().activate(a);
  s().openFolder(p("/d"), true);
  const d = s().activeId!;
  s().close(a); // closing a background tab keeps the active one
  expect(s().activeId).toBe(d);
  s().close(d);
  s().close(ids()[0]!);
  expect(s().tabs).toHaveLength(0);
  expect(s().activeId).toBeNull();
});

test("next_prev_wrap", () => {
  s().openFolder(p("/a"), false);
  s().openFolder(p("/b"), true);
  const [a, b] = ids() as [string, string];
  s().next();
  expect(s().activeId).toBe(a);
  s().prev();
  expect(s().activeId).toBe(b);
});

test("tab_titles", () => {
  s().openFolder(p("/"), false);
  expect(tabTitle(s().tabs[0]!)).toBe("/");
  s().openDoc(p("/home/a/notes.md"));
  expect(tabTitle(s().tabs[1]!)).toBe("notes.md");
});

test("navigate_tab_moves_that_tab_whatever_is_active", () => {
  s().openFolder(p("/a"), false);
  const first = s().activeId!;
  s().openDoc(p("/a/n.md"));
  expect(s().activeId).not.toBe(first);
  s().navigateTab(first, p("/a/sub"));
  const t = s().tabs.find((x) => x.id === first) as FolderTab;
  expect(t.path).toEqual(p("/a/sub"));
  expect(t.history).toEqual([p("/a"), p("/a/sub")]);
  // The active tab is untouched, and no tab was added.
  expect(activeTab(s())?.kind).toBe("doc");
  expect(s().tabs).toHaveLength(2);
  // A tab that is gone, or a document tab, is left alone.
  s().navigateTab("nope", p("/x"));
  s().navigateTab(s().activeId!, p("/x"));
  expect(s().tabs).toHaveLength(2);
});

test("recent_folder_tab_is_the_folder_tab_last_active", () => {
  expect(recentFolderTab(s())).toBeNull();
  s().openFolder(p("/a"), false);
  s().openFolder(p("/b"), true);
  const [a, b] = ids() as [string, string];
  s().openDoc(p("/b/n.md"));
  expect(recentFolderTab(s())?.id).toBe(b);
  s().activate(a);
  s().openDoc(p("/b/n.md"));
  expect(recentFolderTab(s())?.id).toBe(a);
  // When that tab closes, another folder tab stands in.
  s().close(a);
  expect(recentFolderTab(s())?.id).toBe(b);
  s().close(b);
  expect(recentFolderTab(s())).toBeNull();
});

test("the_last_folder_tab_is_kept_in_the_store", () => {
  s().openFolder(p("/a"), false);
  const a = s().activeId!;
  s().openDoc(p("/a/n.md"));
  expect(s().lastFolderId).toBe(a);
  // A reset of the store forgets it, with no module state left behind.
  useTabs.setState({ tabs: [], activeId: null, lastFolderId: null });
  expect(recentFolderTab(s())).toBeNull();
});

// The per-tab view state of a folder tab (scroll, selection, cursor).
const view = (key: string) => ({
  pathKey: key,
  scrollTop: 40,
  selected: [key + "/a"],
  anchor: null,
  cursor: null,
});

test("a_saved_view_is_held_for_a_tab_and_dropped_when_it_closes", () => {
  s().openFolder(p("/home/a"), false);
  const id = s().activeId!;
  s().saveView(id, view("/home/a"));
  expect(s().views[id]).toEqual(view("/home/a"));
  s().close(id);
  expect(s().views[id]).toBeUndefined();
  // A view that unmounts because its tab closed saves after the close: ignored.
  s().saveView(id, view("/home/a"));
  expect(s().views[id]).toBeUndefined();
});

test("navigating_a_tab_drops_its_saved_view", () => {
  s().openFolder(p("/home/a"), false);
  const id = s().activeId!;
  for (const go of [
    () => s().openFolder(p("/home/a/b"), false),
    () => s().navigateTab(id, p("/home/a/c")),
    () => s().back(),
    () => s().forward(),
    () => s().up(),
  ]) {
    s().saveView(id, view("x"));
    go();
    expect(s().views[id]).toBeUndefined();
  }
});

test("a_view_is_not_dropped_by_other_tabs_moving_or_by_switching", () => {
  s().openFolder(p("/home/a"), false);
  const a = s().activeId!;
  s().openFolder(p("/home/b"), true);
  s().saveView(a, view("/home/a"));
  s().openFolder(p("/home/b/c"), false);
  s().activate(a);
  s().next();
  expect(s().views[a]).toEqual(view("/home/a"));
});

// Opening a folder from outside focuses the tab it is already open in.
test("focus_or_open_folder_opens_once_and_then_focuses", () => {
  s().openFolder(p("/home/a"), false);
  const a = s().activeId!;
  s().focusOrOpenFolder(p("/home/b"));
  const b = s().activeId!;
  expect(b).not.toBe(a);
  expect(s().tabs).toHaveLength(2);
  s().focusOrOpenFolder(p("/home/a"));
  expect(s().activeId).toBe(a);
  s().focusOrOpenFolder(p("/home/a"));
  expect(s().tabs).toHaveLength(2);
  // A folder tab that moved on is found by where it is now.
  s().focusOrOpenFolder(p("/home/b"));
  expect(s().activeId).toBe(b);
});

test("focus_or_open_folder_ignores_document_tabs", () => {
  s().openDoc(p("/home/a"));
  s().focusOrOpenFolder(p("/home/a"));
  expect(s().tabs.map((t) => t.kind)).toEqual(["doc", "folder"]);
});

test("a_select_request_is_held_for_its_tab_until_taken_and_dropped_on_close", () => {
  s().openFolder(p("/home/a"), false);
  const id = s().activeId!;
  s().requestSelect(id, [p("/home/a/x")]);
  expect(s().selectRequests[id]).toEqual([p("/home/a/x")]);
  s().clearSelectRequest(id);
  expect(s().selectRequests[id]).toBeUndefined();
  s().requestSelect(id, [p("/home/a/x")]);
  s().close(id);
  expect(s().selectRequests[id]).toBeUndefined();
  s().requestSelect(id, [p("/home/a/x")]);
  expect(s().selectRequests[id]).toBeUndefined();
});

test("the_trash_opens_once_and_is_focused_again", () => {
  useTabs.getState().openFolder(p("/a"), false);
  useTabs.getState().openTrash();
  const trash = useTabs.getState().activeId!;
  useTabs.getState().openFolder(p("/b"), true);
  useTabs.getState().openTrash();
  expect(useTabs.getState().tabs.filter((t) => t.kind === "trash")).toHaveLength(1);
  expect(useTabs.getState().activeId).toBe(trash);
  expect(tabTitle(useTabs.getState().tabs.find((t) => t.id === trash)!)).toBe("Trash");
  // Folder navigation never touches it: the keys that step through a folder's history do nothing there.
  useTabs.getState().back();
  useTabs.getState().up();
  expect(useTabs.getState().activeId).toBe(trash);
  expect(useTabs.getState().tabs).toHaveLength(3);
});
