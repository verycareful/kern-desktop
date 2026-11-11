// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { ActionMenu } from "./ActionMenu";
import { actions, type Action } from "./actions";
import { registerDoc } from "../editor/doc-controller";
import { useDocStatus } from "../editor/doc-status";
import { useTabs } from "../store/tabs";
import { useBinds } from "./binds";

function Host() {
  const [open, setOpen] = useState(false);
  // Re-renders on every store change, handing the menu a new onClose each time.
  useTabs();
  return (
    <>
      <button onClick={() => setOpen(true)}>opener</button>
      {open && (
        <ActionMenu
          sections={[{ title: "Tabs", actions: actions.filter((a) => a.id.startsWith("tab.")) }]}
          x={0}
          y={0}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

beforeEach(() => {
  useBinds.setState({ loaded: true, overrides: {}, error: null });
  useTabs.setState({ tabs: [], activeId: null });
  useTabs.getState().openFolder({ k: "Utf8", v: "/a" }, false);
  useTabs.getState().openFolder({ k: "Utf8", v: "/b" }, true);
});

function openMenu() {
  render(<Host />);
  screen.getByText("opener").focus();
  fireEvent.click(screen.getByText("opener"));
}

test("arrow_keys_move_between_enabled_items", () => {
  openMenu();
  // Focus moves over the enabled items only.
  const items = screen.getAllByRole("menuitem").filter((i) => !i.hasAttribute("disabled"));
  expect(items[0]).toHaveFocus();
  fireEvent.keyDown(items[0]!, { key: "ArrowDown" });
  expect(items[1]).toHaveFocus();
  fireEvent.keyDown(items[1]!, { key: "End" });
  expect(items[items.length - 1]).toHaveFocus();
  fireEvent.keyDown(items[items.length - 1]!, { key: "ArrowDown" });
  expect(items[0]).toHaveFocus();
  fireEvent.keyDown(items[0]!, { key: "ArrowUp" });
  expect(items[items.length - 1]).toHaveFocus();
  fireEvent.keyDown(items[0]!, { key: "Home" });
  expect(items[0]).toHaveFocus();
});

test("escape_closes_and_returns_focus", () => {
  openMenu();
  fireEvent.keyDown(screen.getAllByRole("menuitem")[0]!, { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(screen.getByText("opener")).toHaveFocus();
});

test("a_store_change_does_not_move_focus", () => {
  openMenu();
  const items = screen.getAllByRole("menuitem");
  items[1]!.focus();
  act(() => useTabs.getState().openFolder({ k: "Utf8", v: "/c" }, true));
  expect(screen.getAllByRole("menuitem")[1]).toHaveFocus();
});

test("an_open_menu_follows_a_document_becoming_busy", () => {
  // A save or a move starts while the menu is open: Move to new window greys without reopening.
  useTabs.getState().openDoc({ k: "Utf8", v: "/a/n.md" });
  const id = useTabs.getState().activeId!;
  let busy = false;
  const off = registerDoc(id, {
    save: () => undefined,
    askSaveAs: () => undefined,
    canSave: () => true,
    canSaveAs: () => true,
    whySaveRefused: () => null,
    closeRisk: () => null,
    saveForClose: () => Promise.resolve(true),
    snapshot: () => null,
    setMoving: () => undefined,
    busy: () => busy,
  });
  const detach = actions.filter((a) => a.id === "tab.detach");
  const w = window as { __TAURI_INTERNALS__?: unknown };
  w.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: "main" } } };
  try {
    render(<ActionMenu sections={[{ actions: detach }]} x={0} y={0} onClose={() => undefined} />);
    const item = () => screen.getByRole("menuitem", { name: /Move to new window/ });
    expect(item()).toBeEnabled();
    busy = true;
    act(() => useDocStatus.getState().patch(id, { busy: true }));
    expect(item()).toBeDisabled();
    busy = false;
    act(() => useDocStatus.getState().patch(id, { busy: false }));
    expect(item()).toBeEnabled();
  } finally {
    delete w.__TAURI_INTERNALS__;
    off();
    useDocStatus.getState().clear(id);
  }
});

test("an_action_that_is_a_choice_is_a_radio_item_marked_when_chosen", () => {
  const choice = (id: string, label: string, on: boolean): Action => ({
    id,
    label,
    area: "View",
    keys: [],
    when: "any",
    checked: () => on,
    run: () => undefined,
  });
  render(
    <ActionMenu
      sections={[
        { title: "Sort by", actions: [choice("t.a", "One", true), choice("t.b", "Two", false)] },
        { actions: actions.filter((a) => a.id === "tab.close") },
      ]}
      x={0}
      y={0}
      onClose={() => undefined}
    />
  );
  const one = screen.getByRole("menuitemradio", { name: "One" });
  expect(one).toHaveAttribute("aria-checked", "true");
  expect(one.querySelector("svg.lucide-check")).not.toBeNull();
  const two = screen.getByRole("menuitemradio", { name: "Two" });
  expect(two).toHaveAttribute("aria-checked", "false");
  expect(two.querySelector("svg")).toBeNull();
  // An action that is not a choice stays a plain item.
  expect(screen.getByRole("menuitem", { name: /Close tab/ })).not.toHaveAttribute("aria-checked");
});

test("an_entry_shows_the_bind_the_user_set_and_a_mouse_button_when_it_has_no_key", () => {
  openMenu();
  const close = () => screen.getByText("Close tab").closest("button")!;
  expect(close().querySelector("kbd")?.textContent).toBe("Ctrl+W");
  // Changed while the menu is open: it redraws.
  act(() => useBinds.setState({ overrides: { "tab.close": ["F9", "MiddleClick"] } }));
  expect(close().querySelector("kbd")?.textContent).toBe("F9");
  act(() => useBinds.setState({ overrides: { "tab.close": ["MiddleClick"] } }));
  expect(close().querySelector("kbd")?.textContent).toBe("MiddleClick");
  act(() => useBinds.setState({ overrides: { "tab.close": [] } }));
  expect(close().querySelector("kbd")).toBeNull();
});
