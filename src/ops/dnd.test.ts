// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test } from "vitest";
import type { WireError, WirePath, WireSame } from "../ipc";
import {
  canDropOn,
  decideDrop,
  dropTargetAt,
  dropTargetValue,
  leftWindow,
  parseDropTarget,
  planDrop,
  toCssPoint,
} from "./dnd";

const p = (v: string): WirePath => ({ k: "Utf8", v });

const none = { ctrl: false, shift: false };

test("ctrl_copies_and_shift_moves", () => {
  expect(decideDrop({ ctrl: true, shift: false })).toBe("copy");
  expect(decideDrop({ ctrl: false, shift: true })).toBe("move");
});

test("a_modifier_overrides_what_the_other_application_offers", () => {
  expect(decideDrop({ ctrl: true, shift: false }, ["move"])).toBe("copy");
  expect(decideDrop({ ctrl: false, shift: true }, ["copy"])).toBe("move");
  expect(decideDrop({ ctrl: true, shift: false }, ["copy", "move"])).toBe("copy");
});

test("with_no_modifier_the_filesystems_decide", () => {
  expect(decideDrop(none)).toBe("by_filesystem");
  expect(decideDrop(null)).toBe("by_filesystem");
});

test("both_modifiers_decide_nothing_so_the_filesystems_do", () => {
  expect(decideDrop({ ctrl: true, shift: true })).toBe("by_filesystem");
});

test("an_application_that_offers_only_copy_or_only_move_is_obeyed_when_no_modifier_is_known", () => {
  expect(decideDrop(null, ["copy"])).toBe("copy");
  expect(decideDrop(null, ["move"])).toBe("move");
  // Link and ask are not Kern's to act on: only copy and move count.
  expect(decideDrop(null, ["copy", "link"])).toBe("copy");
  expect(decideDrop(null, ["move", "link", "ask"])).toBe("move");
});

test("an_application_that_offers_both_or_neither_leaves_it_to_the_filesystems", () => {
  expect(decideDrop(null, ["copy", "move"])).toBe("by_filesystem");
  expect(decideDrop(null, ["copy", "move", "link"])).toBe("by_filesystem");
  expect(decideDrop(null, [])).toBe("by_filesystem");
  expect(decideDrop(null, ["link"])).toBe("by_filesystem");
  expect(decideDrop(null, ["ask"])).toBe("by_filesystem");
});

const yes: WireSame = { state: "checked", same: true };
const no: WireSame = { state: "checked", same: false };
const wireError = (kind: string): WireError => ({ kind, message: kind, path: null, details: null });
const failed = (kind: string): WireSame => ({ state: "failed", error: wireError(kind) });

test("each_source_is_moved_copied_or_left_with_its_error_by_its_own_answer", () => {
  const [a, b, c, d] = [p("/s/a"), p("/s/b"), p("/s/c"), p("/s/d")] as [
    WirePath,
    WirePath,
    WirePath,
    WirePath,
  ];
  const plan = planDrop([a, b, c, d], [yes, no, failed("NotFound"), yes]);
  expect(plan.move).toEqual([a, d]);
  expect(plan.copy).toEqual([b]);
  expect(plan.failed).toEqual([{ path: c, error: wireError("NotFound") }]);
});

test("when_every_source_is_on_one_side_the_other_is_empty", () => {
  const sources = [p("/s/a"), p("/s/b")];
  expect(planDrop(sources, [yes, yes])).toEqual({ move: sources, copy: [], failed: [] });
  expect(planDrop(sources, [no, no])).toEqual({ move: [], copy: sources, failed: [] });
});

test("an_answer_count_that_does_not_match_the_sources_acts_on_nothing_and_says_so_for_each", () => {
  const sources = [p("/s/a"), p("/s/b")];
  const plan = planDrop(sources, [yes]);
  expect(plan.move).toEqual([]);
  expect(plan.copy).toEqual([]);
  expect(plan.failed.map((f) => f.path)).toEqual(sources);
  expect(plan.failed[0]!.error.kind).toBe("Internal");
  expect(plan.failed[0]!.error.message).toMatch(/1 answer.*2 sources/);
});

test("a_drop_target_is_the_path_it_was_made_from_including_a_non_utf8_one", () => {
  for (const path of [p('/a b/c"d'), { k: "Bytes", v: btoa("/d/\xff") } satisfies WirePath]) {
    expect(parseDropTarget(dropTargetValue(path))).toEqual(path);
  }
});

test("a_malformed_drop_target_is_no_target", () => {
  for (const v of [
    null,
    "",
    "{",
    "[]",
    '{"k":"Utf8"}',
    '{"k":"Other","v":"/x"}',
    '{"k":"Utf8","v":3}',
  ]) {
    expect(parseDropTarget(v), String(v)).toBeNull();
  }
});

test("the_drop_target_is_found_from_the_element_under_the_pointer_and_its_ancestors", () => {
  document.body.innerHTML = `<div id="row" data-drop-target='${dropTargetValue(p("/d/sub"))}'><span id="name">sub</span></div><p id="plain">x</p>`;
  const at = (id: string) => () => document.getElementById(id);
  expect(dropTargetAt(1, 1, at("name"))?.path).toEqual(p("/d/sub"));
  expect(dropTargetAt(1, 1, at("plain"))).toBeNull();
  expect(dropTargetAt(1, 1, () => null)).toBeNull();
});

test("an_item_cannot_be_dropped_on_itself", () => {
  expect(canDropOn([p("/d/a"), p("/d/b")], p("/d/b"))).toBe(false);
  expect(canDropOn([p("/d/a"), p("/d/b")], p("/d/c"))).toBe(true);
});

test("the_pointer_is_outside_the_window_beyond_any_edge", () => {
  expect(leftWindow(-1, 5, 800, 600)).toBe(true);
  expect(leftWindow(5, -1, 800, 600)).toBe(true);
  expect(leftWindow(800, 5, 800, 600)).toBe(true);
  expect(leftWindow(5, 600, 800, 600)).toBe(true);
  expect(leftWindow(0, 0, 800, 600)).toBe(false);
  expect(leftWindow(799, 599, 800, 600)).toBe(false);
});

test("a_drop_position_becomes_css_pixels_by_the_ratio_of_the_views_size_to_the_pages", () => {
  // A 1.25 zoom: the view is 1280 units wide and shows a page 1024 CSS pixels wide.
  const view = { width: 1280, height: 800 };
  expect(toCssPoint({ x: 100, y: 50 }, view, { width: 1024, height: 640 })).toEqual({
    x: 80,
    y: 40,
  });
  // 80 %: the same view shows a page 1600 wide.
  expect(toCssPoint({ x: 100, y: 50 }, view, { width: 1600, height: 1000 })).toEqual({
    x: 125,
    y: 62.5,
  });
  // 100 %: units and pixels are the same.
  expect(toCssPoint({ x: 7, y: 9 }, view, view)).toEqual({ x: 7, y: 9 });
});

test("a_drop_lands_on_the_same_row_at_every_interface_size", () => {
  // The row under the pointer is at CSS (300, 200) whatever the zoom: the view's size in its own
  // units is the page's size times the zoom, and so is the pointer's position.
  for (const zoom of [0.8, 0.9, 1, 1.1, 1.25]) {
    const page = { width: 1000, height: 700 };
    const view = { width: page.width * zoom, height: page.height * zoom };
    const at = toCssPoint({ x: 300 * zoom, y: 200 * zoom }, view, page);
    expect(at.x).toBeCloseTo(300, 9);
    expect(at.y).toBeCloseTo(200, 9);
  }
});

test.each([
  [0, 800, 1000, 700],
  [1000, 0, 1000, 700],
  [-5, 800, 1000, 700],
  [Number.NaN, 800, 1000, 700],
  [1000, 800, 0, 700],
  [1000, 800, 1000, Number.POSITIVE_INFINITY],
])("sizes_%s_by_%s_and_%s_by_%s_give_no_point", (vw, vh, cw, ch) => {
  expect(() =>
    toCssPoint({ x: 1, y: 1 }, { width: vw, height: vh }, { width: cw, height: ch })
  ).toThrow(RangeError);
});
