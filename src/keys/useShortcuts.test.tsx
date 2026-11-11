// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { fireEvent, render, within } from "@testing-library/react";
import type { WirePath } from "../ipc";
import { activeTab, useTabs } from "../store/tabs";
import { actions, candidateKeys, eventToKey, findDuplicateBindings, getAction } from "./actions";
import { useBinds } from "./binds";
import { useShortcuts } from "./useShortcuts";

const p = (v: string): WirePath => ({ k: "Utf8", v });

const shown = vi.hoisted(() => ({ settings: 0 }));
vi.mock("../settings/show-settings", () => ({
  showSettings: () => {
    shown.settings += 1;
    return Promise.resolve();
  },
}));

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

beforeEach(() => {
  useTabs.setState({ tabs: [], activeId: null });
  useBinds.setState({ loaded: true, overrides: {}, error: null });
});

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

test("ctrl_comma_opens_settings_even_from_a_text_field", () => {
  const { container } = render(
    <>
      <Host />
      <input aria-label="settings test field" />
    </>
  );
  useTabs.getState().openFolder(p("/a"), false);
  fireEvent.keyDown(within(container).getByLabelText("settings test field"), {
    key: ",",
    code: "Comma",
    ctrlKey: true,
  });
  fireEvent.keyDown(window, { key: ",", code: "Comma", ctrlKey: true });
  // From a text field and from the window alike; the window itself is opened once by the backend.
  expect(shown.settings).toBe(2);
  // Settings is a window of its own, not a tab.
  expect(useTabs.getState().tabs).toHaveLength(1);
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
      "folder.copyPath",
      "folder.cut",
      "folder.delete",
      "folder.new.file",
      "folder.new.folder",
      "folder.openWith",
      "folder.paste",
      "folder.pin",
      "folder.properties",
      "folder.rename",
      "folder.terminal",
      "folder.trash",
    ].sort()
  );
});

test("ctrl_c_with_words_selected_in_a_message_copies_the_words_and_not_the_files", () => {
  useTabs.getState().openFolder(p("/a"), false);
  const { getByText } = render(
    <>
      <Host />
      <div data-file-keys="">
        <button>in the view</button>
        <p role="alert">The path could not be copied</p>
        <p role="status">Moved a.txt to the Trash</p>
        <p>an ordinary line</p>
      </div>
    </>
  );
  const press = () => {
    const event = new KeyboardEvent("keydown", {
      key: "c",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    getByText("in the view").dispatchEvent(event);
    return event.defaultPrevented;
  };
  const select = (el: Element) => window.getSelection()!.selectAllChildren(el);
  try {
    // Nothing selected: the key is the file copy's, claimed even when there is nothing to copy.
    expect(press()).toBe(true);
    // Words selected in an alert or a status message: the webview copies them.
    select(getByText("The path could not be copied"));
    expect(press()).toBe(false);
    select(getByText("Moved a.txt to the Trash"));
    expect(press()).toBe(false);
    // Words selected anywhere else keep the key with the file copy.
    select(getByText("an ordinary line"));
    expect(press()).toBe(true);
    // A selection that starts in a message and ends outside it is not only the message's words.
    const range = document.createRange();
    range.setStart(getByText("The path could not be copied").firstChild!, 4);
    range.setEnd(getByText("an ordinary line").firstChild!, 3);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    expect(press()).toBe(true);
  } finally {
    window.getSelection()!.removeAllRanges();
  }
});

// The binds the user sets (binds.ts) replace an action's default keys, and a mouse button is a
// bind like a key.

/** A tab strip as TabBar draws it: a `.kern-tab` holding the button that carries the tab id. */
function Strip() {
  useShortcuts();
  return (
    <div>
      {useTabs.getState().tabs.map((t) => (
        <div key={t.id} className="kern-tab" data-testid={`strip-${t.id}`}>
          <button type="button" data-tab-id={t.id}>
            {t.id}
          </button>
        </div>
      ))}
      <input aria-label="field" />
      <p data-testid="empty">nothing</p>
    </div>
  );
}

const mouse = (target: Element | Window, button: number, init: MouseEventInit = {}) => {
  const down = !fireEvent.mouseDown(target, { button, ...init });
  fireEvent.mouseUp(target, { button, ...init });
  return down;
};

test("a_key_the_user_set_replaces_the_default_and_the_default_stops_working", () => {
  useBinds.setState({ overrides: { "tab.close": ["F9"] } });
  render(<Host />);
  useTabs.getState().openFolder(p("/a"), false);
  useTabs.getState().openFolder(p("/b"), true);
  fireEvent.keyDown(window, { key: "w", ctrlKey: true });
  expect(useTabs.getState().tabs).toHaveLength(2);
  fireEvent.keyDown(window, { key: "F9" });
  expect(useTabs.getState().tabs).toHaveLength(1);
});

test("an_action_with_an_empty_list_has_no_key_and_the_key_is_not_claimed", () => {
  useBinds.setState({ overrides: { "tab.close": [] } });
  render(<Host />);
  useTabs.getState().openFolder(p("/a"), false);
  expect(fireEvent.keyDown(window, { key: "w", ctrlKey: true })).toBe(true);
  expect(useTabs.getState().tabs).toHaveLength(1);
});

test("a_key_taken_from_one_action_for_another_runs_the_other", () => {
  // Ctrl+W moved to Next tab: the user may give any action any key.
  useBinds.setState({ overrides: { "tab.close": [], "tab.next": ["Ctrl+W"] } });
  render(<Host />);
  useTabs.getState().openFolder(p("/a"), false);
  useTabs.getState().openFolder(p("/b"), true);
  const [a] = useTabs.getState().tabs.map((t) => t.id);
  fireEvent.keyDown(window, { key: "w", ctrlKey: true });
  expect(useTabs.getState().tabs).toHaveLength(2);
  expect(useTabs.getState().activeId).toBe(a);
});

test("a_mouse_button_the_user_bound_runs_its_action_anywhere_in_the_window", () => {
  useBinds.setState({ overrides: { "tab.next": ["MiddleClick"] } });
  useTabs.getState().openFolder(p("/a"), false);
  useTabs.getState().openFolder(p("/b"), true);
  const [a] = useTabs.getState().tabs.map((t) => t.id);
  const { getByTestId } = render(<Strip />);
  mouse(getByTestId("empty"), 1);
  expect(useTabs.getState().activeId).toBe(a);
});

test("a_modifier_is_part_of_a_mouse_bind", () => {
  useBinds.setState({ overrides: { "tab.next": ["Ctrl+MouseBack"] } });
  useTabs.getState().openFolder(p("/a"), false);
  useTabs.getState().openFolder(p("/b"), true);
  const [a, b] = useTabs.getState().tabs.map((t) => t.id);
  const { getByTestId } = render(<Strip />);
  mouse(getByTestId("empty"), 3);
  expect(useTabs.getState().activeId).toBe(b);
  mouse(getByTestId("empty"), 3, { ctrlKey: true });
  expect(useTabs.getState().activeId).toBe(a);
  // A bind with more modifiers than the click is not the click's.
  mouse(getByTestId("empty"), 3, { ctrlKey: true, shiftKey: true });
  expect(useTabs.getState().activeId).toBe(a);
});

test("a_bound_mouse_press_is_claimed_so_the_webview_does_not_also_act_on_it", () => {
  useBinds.setState({ overrides: { "tab.next": ["MiddleClick"] } });
  useTabs.getState().openFolder(p("/a"), false);
  const { getByTestId } = render(<Strip />);
  expect(mouse(getByTestId("empty"), 1)).toBe(true);
  // A button nothing is bound to is left alone.
  expect(mouse(getByTestId("empty"), 4)).toBe(false);
});

test("a_mouse_bind_does_not_fire_in_a_text_field_where_the_middle_button_pastes", () => {
  useBinds.setState({ overrides: { "tab.next": ["MiddleClick"] } });
  useTabs.getState().openFolder(p("/a"), false);
  useTabs.getState().openFolder(p("/b"), true);
  const [, b] = useTabs.getState().tabs.map((t) => t.id);
  const { getByLabelText } = render(<Strip />);
  expect(mouse(getByLabelText("field"), 1)).toBe(false);
  expect(useTabs.getState().activeId).toBe(b);
});

test("a_bare_left_or_right_click_stored_as_a_bind_is_never_matched", () => {
  useBinds.setState({ overrides: { "tab.next": ["Click"], "tab.prev": ["RightClick"] } });
  useTabs.getState().openFolder(p("/a"), false);
  useTabs.getState().openFolder(p("/b"), true);
  const [, b] = useTabs.getState().tabs.map((t) => t.id);
  const { getByTestId } = render(<Strip />);
  mouse(getByTestId("empty"), 0);
  mouse(getByTestId("empty"), 2);
  expect(useTabs.getState().activeId).toBe(b);
});

test("a_middle_click_on_a_tab_closes_that_tab_by_default_and_on_empty_space_does_nothing", () => {
  useTabs.getState().openFolder(p("/a"), false);
  useTabs.getState().openFolder(p("/b"), true);
  const [a, b] = useTabs.getState().tabs.map((t) => t.id);
  const { getByTestId } = render(<Strip />);
  mouse(getByTestId("empty"), 1);
  expect(useTabs.getState().tabs).toHaveLength(2);
  // The tab under the pointer, not the one in front.
  mouse(getByTestId(`strip-${a}`), 1);
  expect(useTabs.getState().tabs.map((t) => t.id)).toEqual([b]);
});

test("close_tab_moved_to_another_mouse_button_still_acts_only_on_the_tab_under_it", () => {
  useBinds.setState({ overrides: { "tab.close": ["Ctrl+MiddleClick"] } });
  useTabs.getState().openFolder(p("/a"), false);
  useTabs.getState().openFolder(p("/b"), true);
  const [a, b] = useTabs.getState().tabs.map((t) => t.id);
  const { getByTestId } = render(<Strip />);
  // The default button no longer closes it; the new one does, and only over a tab.
  mouse(getByTestId(`strip-${a}`), 1);
  expect(useTabs.getState().tabs).toHaveLength(2);
  mouse(getByTestId("empty"), 1, { ctrlKey: true });
  expect(useTabs.getState().tabs).toHaveLength(2);
  mouse(getByTestId(`strip-${a}`), 1, { ctrlKey: true });
  expect(useTabs.getState().tabs.map((t) => t.id)).toEqual([b]);
});

test("a_button_shared_by_actions_of_different_tab_kinds_runs_the_one_that_applies", () => {
  // Folder refresh comes before Save in the table, and a document tab is in front.
  useBinds.setState({
    overrides: { "folder.refresh": ["MouseForward"], "doc.save": ["MouseForward"] },
  });
  const refresh = vi.spyOn(getAction("folder.refresh"), "run").mockImplementation(() => undefined);
  const save = vi.spyOn(getAction("doc.save"), "run").mockImplementation(() => undefined);
  vi.spyOn(getAction("doc.save"), "enabled").mockReturnValue(true);
  vi.spyOn(getAction("folder.refresh"), "enabled").mockReturnValue(true);
  useTabs.getState().openDoc(p("/a/n.md"));
  const { getByTestId } = render(<Strip />);
  mouse(getByTestId("empty"), 4);
  expect(save).toHaveBeenCalledOnce();
  expect(refresh).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

test("the_context_menu_of_a_right_click_bound_with_a_modifier_is_suppressed", () => {
  useBinds.setState({ overrides: { "tab.next": ["Shift+RightClick"] } });
  useTabs.getState().openFolder(p("/a"), false);
  const { getByTestId } = render(<Strip />);
  const seen = vi.fn();
  getByTestId("empty").addEventListener("contextmenu", seen);
  fireEvent.contextMenu(getByTestId("empty"), { button: 2, shiftKey: true });
  expect(seen).not.toHaveBeenCalled();
  // Without the modifier the menu is the page's own.
  fireEvent.contextMenu(getByTestId("empty"), { button: 2 });
  expect(seen).toHaveBeenCalledOnce();
});
