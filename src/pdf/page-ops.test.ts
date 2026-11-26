// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { describe, expect, it } from "vitest";
import { moveTarget, refuseRemoval, reorderOrder } from "./page-ops";

describe("reorderOrder", () => {
  it("reorder_moves_one_page_and_lists_every_page_once", () => {
    // order[i] is the page that ends up at position i.
    expect(reorderOrder(5, 0, 3)).toEqual([1, 2, 3, 0, 4]);
    expect(reorderOrder(5, 3, 0)).toEqual([3, 0, 1, 2, 4]);
    expect(reorderOrder(5, 1, 2)).toEqual([0, 2, 1, 3, 4]);
    expect(reorderOrder(5, 4, 0)).toEqual([4, 0, 1, 2, 3]);
    for (const [from, to] of [
      [0, 4],
      [4, 1],
      [2, 3],
    ] as const) {
      const order = reorderOrder(5, from, to)!;
      expect([...order].sort()).toEqual([0, 1, 2, 3, 4]);
      expect(order[to]).toBe(from);
    }
  });

  it("moving_a_page_to_itself_is_a_no_op", () => {
    expect(reorderOrder(5, 2, 2)).toBeNull();
  });

  it("refuses_a_page_the_document_does_not_have", () => {
    expect(reorderOrder(5, 5, 0)).toBeNull();
    expect(reorderOrder(5, 0, 5)).toBeNull();
    expect(reorderOrder(5, -1, 2)).toBeNull();
    expect(reorderOrder(5, 1.5, 2)).toBeNull();
    expect(reorderOrder(0, 0, 0)).toBeNull();
  });
});

describe("moveTarget", () => {
  it("turns_a_gap_into_the_place_the_page_ends_at", () => {
    // Gap g lies before page g; gap `pages` is after the last page.
    expect(moveTarget(1, 4)).toBe(3);
    expect(moveTarget(4, 1)).toBe(1);
    expect(moveTarget(2, 2)).toBe(2);
    expect(moveTarget(2, 3)).toBe(2);
    expect(moveTarget(0, 5)).toBe(4);
  });
});

describe("refuseRemoval", () => {
  it("removing_every_page_is_refused_in_the_ui", () => {
    expect(refuseRemoval(3, [0, 1, 2])).toBe("A PDF keeps at least one page. Choose fewer pages.");
    expect(refuseRemoval(1, [0])).toBe("A PDF keeps at least one page. Choose fewer pages.");
  });

  it("refuses_no_pages_and_a_page_that_is_not_there", () => {
    expect(refuseRemoval(3, [])).toBe("Choose the pages to remove first.");
    expect(refuseRemoval(3, [3])).toBe("Page 4 is not in this PDF.");
  });

  it("allows_some_pages", () => {
    expect(refuseRemoval(3, [1])).toBeNull();
    expect(refuseRemoval(3, [0, 2])).toBeNull();
  });
});
