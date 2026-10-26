// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { WirePath } from "../ipc";
import { activeTab, tabTitle, useTabs, type FolderTab } from "./tabs";

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
