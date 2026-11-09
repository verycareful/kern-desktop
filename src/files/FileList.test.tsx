// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FileList } from "./FileList";
import { empty } from "./selection";
import { entry } from "./test-entries";
import { stubLayout } from "./test-layout";
import { useViewSettings } from "./view-settings";

let restore: () => void;
beforeEach(() => {
  restore = stubLayout();
});
afterEach(() => {
  cleanup();
  restore();
});

function list(sortFailed: boolean, entries = [entry("a"), entry("b")]) {
  render(
    <FileList
      entries={entries}
      sel={empty}
      onItemClick={vi.fn()}
      onItemDoubleClick={vi.fn()}
      onContextMenu={vi.fn()}
      onBand={vi.fn()}
      onBackgroundClick={vi.fn()}
      onSeedCursor={vi.fn()}
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

test("every_row_carries_the_key_of_its_item", () => {
  list(false);
  const keys = screen.getAllByTestId("file-row").map((r) => r.getAttribute("data-key"));
  expect(keys).toEqual(["Utf8:/d/a", "Utf8:/d/b"]);
});

test("the_modified_column_shows_the_time_in_the_chosen_clock", () => {
  // A moment on a past day, so the day part is a date and the test does not depend on today.
  const modified_ms = new Date(2020, 2, 4, 14, 5).getTime();
  const row = (format: "12" | "24") => {
    cleanup();
    useViewSettings.setState({ timeFormat: format });
    list(false, [{ ...entry("a"), modified_ms }]);
    return screen.getAllByRole("gridcell").find((c) => c.className.includes("kern-col-modified"))!
      .textContent!;
  };
  expect(row("24")).toBe("Mar 4, 2020 14:05");
  expect(row("12").toLowerCase()).toBe("mar 4, 2020 2:05 pm");
  useViewSettings.setState({ timeFormat: "system" });
});
