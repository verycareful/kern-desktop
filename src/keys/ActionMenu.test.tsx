// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { ActionMenu } from "./ActionMenu";
import { actions } from "./actions";
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
  const items = screen.getAllByRole("menuitem");
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
