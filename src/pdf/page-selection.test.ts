// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { beforeEach, describe, expect, it } from "vitest";
import { afterClick, clamped, EMPTY, usePageSelection } from "./page-selection";

describe("afterClick", () => {
  it("a_plain_click_selects_that_page_alone", () => {
    const s = afterClick({ pages: [1, 2], anchor: 1 }, 4, { ctrl: false, shift: false });
    expect(s).toEqual({ pages: [4], anchor: 4 });
  });

  it("ctrl_adds_a_page_and_takes_it_away_again", () => {
    const one = afterClick({ pages: [1], anchor: 1 }, 4, { ctrl: true, shift: false });
    expect(one).toEqual({ pages: [1, 4], anchor: 4 });
    const none = afterClick(one, 4, { ctrl: true, shift: false });
    expect(none).toEqual({ pages: [1], anchor: 4 });
  });

  it("shift_selects_the_run_from_the_anchor_either_way", () => {
    expect(afterClick({ pages: [2], anchor: 2 }, 5, { ctrl: false, shift: true })).toEqual({
      pages: [2, 3, 4, 5],
      anchor: 2,
    });
    expect(afterClick({ pages: [5], anchor: 5 }, 2, { ctrl: false, shift: true })).toEqual({
      pages: [2, 3, 4, 5],
      anchor: 5,
    });
  });

  it("shift_with_no_anchor_selects_that_page", () => {
    expect(afterClick(EMPTY, 3, { ctrl: false, shift: true })).toEqual({ pages: [3], anchor: 3 });
  });

  it("ctrl_and_shift_add_the_run_to_what_is_selected", () => {
    expect(afterClick({ pages: [0, 5], anchor: 5 }, 7, { ctrl: true, shift: true })).toEqual({
      pages: [0, 5, 6, 7],
      anchor: 5,
    });
  });
});

describe("clamped", () => {
  it("drops_pages_the_document_no_longer_has", () => {
    expect(clamped({ pages: [0, 3, 5], anchor: 5 }, 4)).toEqual({ pages: [0, 3], anchor: null });
  });

  it("keeps_a_selection_that_still_fits", () => {
    const s = { pages: [0, 3], anchor: 3 };
    expect(clamped(s, 4)).toBe(s);
  });
});

describe("usePageSelection", () => {
  beforeEach(() => usePageSelection.setState({ byTab: {} }));

  it("keeps_a_selection_for_each_tab", () => {
    usePageSelection.getState().click("a", 2, 9, { ctrl: false, shift: false });
    usePageSelection.getState().click("b", 5, 9, { ctrl: false, shift: false });
    expect(usePageSelection.getState().byTab["a"]?.pages).toEqual([2]);
    expect(usePageSelection.getState().byTab["b"]?.pages).toEqual([5]);
  });

  it("set_replaces_and_clear_forgets", () => {
    const st = usePageSelection.getState();
    st.set("a", [3, 1, 1, 2]);
    expect(usePageSelection.getState().byTab["a"]).toEqual({ pages: [1, 2, 3], anchor: 3 });
    st.clear("a");
    expect(usePageSelection.getState().byTab["a"]).toBeUndefined();
  });

  it("fit_drops_pages_after_the_document_shrinks", () => {
    const st = usePageSelection.getState();
    st.set("a", [1, 6]);
    st.fit("a", 4);
    expect(usePageSelection.getState().byTab["a"]?.pages).toEqual([1]);
    st.fit("a", 1);
    expect(usePageSelection.getState().byTab["a"]).toBeUndefined();
  });
});
