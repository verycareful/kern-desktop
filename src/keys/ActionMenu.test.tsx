// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { ActionMenu } from "./ActionMenu";
import { actions } from "./actions";
import { registerDoc } from "../editor/doc-controller";
import { useDocStatus } from "../editor/doc-status";
import { useTabs } from "../store/tabs";

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
