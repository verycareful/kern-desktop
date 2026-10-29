// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { fireEvent, render } from "@testing-library/react";
import type { WirePath } from "../ipc";
import { activeTab, useTabs } from "../store/tabs";
import { actions, candidateKeys, eventToKey, findDuplicateBindings } from "./actions";
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
    area: "Tabs" as const,
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
  // The plus key is written Plus; = and - are themselves; space is Space.
  expect(eventToKey({ ...base, key: "=", ctrlKey: true })).toBe("Ctrl+=");
  expect(eventToKey({ ...base, key: "-", ctrlKey: true })).toBe("Ctrl+-");
  expect(eventToKey({ ...base, key: "+", ctrlKey: true, shiftKey: true })).toBe("Ctrl+Shift+Plus");
  expect(eventToKey({ ...base, key: " " })).toBe("Space");
});

test("keys_fall_back_to_the_physical_key_on_non_latin_layouts", () => {
  const base = { ctrlKey: true, altKey: false, shiftKey: false, metaKey: false };
  // Cyrillic layout: the W position types "ц".
  expect(candidateKeys({ ...base, key: "ц", code: "KeyW" })).toEqual(["Ctrl+Ц", "Ctrl+W"]);
  expect(candidateKeys({ ...base, key: "1", code: "Digit1" })).toEqual(["Ctrl+1"]);
  // A Latin layout that moved the letter (Dvorak) keeps the typed key only.
  expect(candidateKeys({ ...base, key: ",", code: "KeyW" })).toEqual(["Ctrl+,"]);
});

test("ctrl_w_works_on_a_cyrillic_layout", () => {
  render(<Host />);
  useTabs.getState().openFolder(p("/a"), false);
  fireEvent.keyDown(window, { key: "ц", code: "KeyW", ctrlKey: true });
  expect(useTabs.getState().tabs).toHaveLength(0);
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
  // Not claimed: no folder-only action applies in a document tab.
  const claimed = !fireEvent.keyDown(window, { key: "ArrowUp", altKey: true });
  expect(claimed).toBe(false);
  expect(useTabs.getState().tabs).toBe(before);
  // The same event in a folder tab is claimed.
  useTabs.getState().activate(before[0]!.id);
  expect(fireEvent.keyDown(window, { key: "ArrowUp", altKey: true })).toBe(false);
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

test("plain_navigation_keys_on_buttons_belong_to_the_button", () => {
  const { getByText } = render(<Host />);
  useTabs.getState().openFolder(p("/a/b"), false);
  // Enter on a focused button activates it; a folder action must not claim it.
  const button = getByText("plain");
  const enter = fireEvent.keyDown(button, { key: "Enter" });
  expect(enter).toBe(true);
  // The same key elsewhere is claimed by the folder's Open action.
  expect(fireEvent.keyDown(window, { key: "Enter" })).toBe(false);
  // A modified key is still a shortcut, whatever has focus.
  expect(fireEvent.keyDown(button, { key: "ArrowUp", altKey: true })).toBe(false);
});

test("shift_is_passed_to_the_action_as_extend", () => {
  render(<Host />);
  useTabs.getState().openFolder(p("/a/b"), false);
  const seen: boolean[] = [];
  const action = actions.find((a) => a.id === "folder.move.down")!;
  const run = action.run;
  action.run = (c) => seen.push(c.extend);
  const enabled = action.enabled;
  action.enabled = undefined;
  try {
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "ArrowDown", shiftKey: true });
  } finally {
    action.run = run;
    action.enabled = enabled;
  }
  expect(seen).toEqual([false, true]);
});

test("a_view_scoped_key_runs_inside_the_view_or_aimed_at_nothing_and_is_left_alone_elsewhere", () => {
  const run = vi.fn();
  const scoped = {
    id: "test.scoped",
    label: "Scoped",
    area: "Edit" as const,
    keys: ["Ctrl+Q"],
    when: "any" as const,
    scope: "view" as const,
    run,
  };
  actions.push(scoped);
  try {
    const { getByText } = render(
      <>
        <Host />
        <div data-file-keys="">
          <button>in the view</button>
        </div>
      </>
    );
    const press = (target: Element | Window) => {
      const event = new KeyboardEvent("keydown", {
        key: "q",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    // Another pane's key: not claimed, not run.
    expect(press(getByText("plain"))).toBe(false);
    expect(run).not.toHaveBeenCalled();
    // The view, the page body (the keyboard is nowhere in particular) and the window itself.
    expect(press(getByText("in the view"))).toBe(true);
    expect(press(document.body)).toBe(true);
    expect(press(window)).toBe(true);
    expect(run).toHaveBeenCalledTimes(3);
  } finally {
    actions.splice(actions.indexOf(scoped), 1);
  }
});

test("the_keys_of_the_file_operations_are_scoped_to_the_view_and_undo_is_not", () => {
  const scoped = actions.filter((a) => a.scope === "view").map((a) => a.id);
  expect(scoped.sort()).toEqual(
    [
      "folder.copy",
      "folder.cut",
      "folder.delete",
      "folder.new.file",
      "folder.new.folder",
      "folder.paste",
      "folder.rename",
      "folder.trash",
    ].sort()
  );
});
