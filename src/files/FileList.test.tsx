// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FileList } from "./FileList";
import { empty } from "./selection";
import { entry } from "./test-entries";
import { stubLayout } from "./test-layout";

let restore: () => void;
beforeEach(() => {
  restore = stubLayout();
});
afterEach(() => {
  cleanup();
  restore();
});

function list(sortFailed: boolean) {
  render(
    <FileList
      entries={[entry("a"), entry("b")]}
      sel={empty}
      onItemClick={vi.fn()}
      onItemDoubleClick={vi.fn()}
      onContextMenu={vi.fn()}
      onBand={vi.fn()}
      onBackgroundClick={vi.fn()}
      rowHeight={36}
      sortBy="name"
      sortDir="asc"
      sortFailed={sortFailed}
      onSort={vi.fn()}
      rootRef={{ current: null }}
      revealTick={0}
      initialScroll={0}
    />
  );
}

test("the_header_marks_the_sort_column_while_the_list_is_sorted", () => {
  list(false);
  const name = screen.getByRole("columnheader", { name: /name/i });
  expect(name).toHaveAttribute("aria-sort", "ascending");
  expect(name.querySelector("svg")).not.toBeNull();
});

test("the_header_claims_no_sort_order_while_the_sort_has_failed", () => {
  list(true);
  for (const header of screen.getAllByRole("columnheader")) {
    expect(header).toHaveAttribute("aria-sort", "none");
    expect(within(header).getByRole("button").querySelector("svg")).toBeNull();
  }
});
