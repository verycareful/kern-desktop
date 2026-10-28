// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FileGrid } from "./FileGrid";
import { FileList } from "./FileList";
import { empty, type Sel } from "./selection";
import { entry } from "./test-entries";
import { stubLayout } from "./test-layout";

vi.mock("../ipc", async (orig) => ({
  ...(await orig<typeof import("../ipc")>()),
  thumbRequest: vi.fn().mockResolvedValue(undefined),
  thumbCancel: vi.fn().mockResolvedValue(undefined),
  on: vi.fn().mockResolvedValue(() => {}),
}));

// Design 4.5 (keyboard): the list and the grid show where the keyboard is by
// outlining the current item, while they have the keyboard, and not by a frame
// around the whole view.

let restore: () => void;
beforeEach(() => {
  restore = stubLayout();
});
afterEach(() => {
  cleanup();
  restore();
});

const entries = [entry("a"), entry("b"), entry("c")];
const common = {
  entries,
  onItemClick: vi.fn(),
  onItemDoubleClick: vi.fn(),
  onContextMenu: vi.fn(),
  onBand: vi.fn(),
  onBackgroundClick: vi.fn(),
  rootRef: { current: null },
  revealTick: 0,
  initialScroll: 0,
};

const views = {
  list: (sel: Sel) => (
    <>
      <FileList {...common} sel={sel} rowHeight={36} sortBy="name" sortDir="asc" onSort={vi.fn()} />
      <button type="button">elsewhere</button>
    </>
  ),
  grid: (sel: Sel) => (
    <>
      <FileGrid {...common} sel={sel} thumbKey="t" onColumns={vi.fn()} />
      <button type="button">elsewhere</button>
    </>
  ),
};
const items = { list: "file-row", grid: "file-card" } as const;
const roots = { list: "folder-list", grid: "folder-grid" } as const;

for (const kind of ["list", "grid"] as const) {
  const cursorNames = () =>
    screen
      .getAllByTestId(items[kind])
      .filter((e) => e.classList.contains("kern-cursor"))
      .map((e) => e.getAttribute("data-name"));
  const root = () => screen.getByTestId(roots[kind]);
  const withCursor: Sel = { selected: new Set([2]), anchor: 2, cursor: 2 };

  test(`${kind}_shows_no_cursor_outline_while_it_does_not_have_the_keyboard`, () => {
    render(views[kind](withCursor));
    expect(cursorNames()).toEqual([]);
  });

  test(`${kind}_outlines_the_current_item_while_focused_and_not_after`, () => {
    render(views[kind](withCursor));
    fireEvent.focus(root());
    expect(cursorNames()).toEqual(["c"]);
    fireEvent.blur(root());
    expect(cursorNames()).toEqual([]);
  });

  test(`${kind}_outlines_the_first_item_when_there_is_no_current_item_and_selects_nothing`, () => {
    render(views[kind](empty));
    fireEvent.focus(root());
    expect(cursorNames()).toEqual(["a"]);
    expect(root().getAttribute("aria-activedescendant")).toBe(
      screen.getAllByTestId(items[kind])[0]!.id
    );
    for (const e of screen.getAllByTestId(items[kind])) {
      expect(e).toHaveAttribute("aria-selected", "false");
    }
    expect(common.onItemClick).not.toHaveBeenCalled();
    expect(common.onBand).not.toHaveBeenCalled();
  });

  test(`${kind}_drops_the_outline_when_focus_moves_to_something_else`, () => {
    render(views[kind](withCursor));
    act(() => root().focus());
    expect(cursorNames()).toEqual(["c"]);
    act(() => screen.getByRole("button", { name: "elsewhere" }).focus());
    expect(cursorNames()).toEqual([]);
  });
}

test("the_list_header_buttons_do_not_count_as_the_list_having_the_keyboard", () => {
  render(views.list({ selected: new Set(), anchor: null, cursor: 1 }));
  act(() => screen.getByTestId("folder-list").focus());
  expect(
    screen.getAllByTestId("file-row").filter((e) => e.classList.contains("kern-cursor"))
  ).toHaveLength(1);
  act(() => screen.getByRole("button", { name: "Size" }).focus());
  expect(
    screen.getAllByTestId("file-row").filter((e) => e.classList.contains("kern-cursor"))
  ).toHaveLength(0);
});
