// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { fireEvent, render } from "@testing-library/react";
import type { WirePath } from "../ipc";
import { activeTab, useTabs } from "../store/tabs";
import { actions, eventToKey, findDuplicateBindings } from "./actions";
import { useShortcuts } from "./useShortcuts";

const p = (v: string): WirePath => ({ k: "Utf8", v });

function Host() {
  useShortcuts();
  return (
    <div>
      <input aria-label="field" />
      <div data-testid="ce" contentEditable suppressContentEditableWarning />
      <button>plain</button>
    </div>
  );
}

beforeEach(() => useTabs.setState({ tabs: [], activeId: null }));

test("every_action_has_menu_label", () => {
  const ids = new Set<string>();
  for (const a of actions) {
    expect(a.label.trim(), a.id).not.toBe("");
    expect(ids.has(a.id), `duplicate id ${a.id}`).toBe(false);
    ids.add(a.id);
    for (const k of a.keys) expect(k, a.id).toMatch(/^(Ctrl\+)?(Alt\+)?(Shift\+)?(Meta\+)?[^+]+$/);
  }
});

test("no_duplicate_bindings_per_context", () => {
  expect(findDuplicateBindings()).toEqual([]);
  const mk = (id: string, when: "folder" | "doc" | "any", keys: string[]) => ({
    id,
    label: id,
    keys,
    when,
    run: () => undefined,
  });
  expect(findDuplicateBindings([mk("a", "folder", ["F2"]), mk("b", "doc", ["F2"])])).toEqual([]);
  expect(findDuplicateBindings([mk("a", "folder", ["F2"]), mk("b", "any", ["F2"])])).toEqual([
    "F2: a, b",
  ]);
  expect(findDuplicateBindings([mk("a", "doc", ["F2"]), mk("b", "any", ["F2"])])).toHaveLength(1);
});

test("event_key_format", () => {
  const base = { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
  expect(eventToKey({ ...base, key: "w", ctrlKey: true })).toBe("Ctrl+W");
  expect(eventToKey({ ...base, key: "Tab", ctrlKey: true, shiftKey: true })).toBe("Ctrl+Shift+Tab");
  expect(eventToKey({ ...base, key: "ArrowLeft", altKey: true })).toBe("Alt+ArrowLeft");
});

test("ctrl_w_closes_the_active_tab_and_ctrl_tab_cycles", () => {
  render(<Host />);
  useTabs.getState().openFolder(p("/a"), false);
  useTabs.getState().openFolder(p("/b"), true);
  const [a, b] = useTabs.getState().tabs.map((t) => t.id);
  fireEvent.keyDown(window, { key: "Tab", ctrlKey: true });
  expect(useTabs.getState().activeId).toBe(a);
  fireEvent.keyDown(window, { key: "Tab", ctrlKey: true, shiftKey: true });
  expect(useTabs.getState().activeId).toBe(b);
  fireEvent.keyDown(window, { key: "w", ctrlKey: true });
  expect(useTabs.getState().tabs.map((t) => t.id)).toEqual([a]);
});

test("navigation_keys_only_in_folder_tabs", () => {
  render(<Host />);
  useTabs.getState().openFolder(p("/a/b"), false);
  fireEvent.keyDown(window, { key: "ArrowUp", altKey: true });
  expect((activeTab(useTabs.getState()) as { path: WirePath }).path).toEqual(p("/a"));
  fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true });
  expect((activeTab(useTabs.getState()) as { path: WirePath }).path).toEqual(p("/a/b"));
  useTabs.getState().openDoc(p("/a/n.md"));
  const before = useTabs.getState().tabs;
  fireEvent.keyDown(window, { key: "ArrowUp", altKey: true });
  expect(useTabs.getState().tabs).toBe(before);
});

test("shortcuts_skip_editable_fields_unless_the_action_allows_it", () => {
  const { getByLabelText, getByTestId } = render(<Host />);
  useTabs.getState().openFolder(p("/a/b"), false);
  // nav.up does not allow editable targets.
  fireEvent.keyDown(getByLabelText("field"), { key: "ArrowUp", altKey: true });
  fireEvent.keyDown(getByTestId("ce"), { key: "ArrowUp", altKey: true });
  expect((activeTab(useTabs.getState()) as { path: WirePath }).path).toEqual(p("/a/b"));
  // tab.close does.
  fireEvent.keyDown(getByLabelText("field"), { key: "w", ctrlKey: true });
  expect(useTabs.getState().tabs).toHaveLength(0);
});
