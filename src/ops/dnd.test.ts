// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test } from "vitest";
import type { WirePath } from "../ipc";
import {
  canDropOn,
  decideDrop,
  dropTargetAt,
  dropTargetValue,
  leftWindow,
  parseDropTarget,
  physicalPerCssPixel,
  toCssPoint,
} from "./dnd";

const p = (v: string): WirePath => ({ k: "Utf8", v });

test("ctrl_copies_and_shift_moves", () => {
  expect(decideDrop({ ctrl: true, shift: false })).toBe("copy");
  expect(decideDrop({ ctrl: false, shift: true })).toBe("move");
});

test("without_a_modifier_or_with_both_the_user_is_asked_and_nothing_is_decided_for_them", () => {
  expect(decideDrop({ ctrl: false, shift: false })).toBe("ask");
  expect(decideDrop({ ctrl: true, shift: true })).toBe("ask");
});

test("a_drop_from_another_application_carries_no_modifiers_so_the_user_is_asked", () => {
  expect(decideDrop(null)).toBe("ask");
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

test("a_drop_position_in_physical_pixels_becomes_css_pixels_by_the_measured_ratio", () => {
  expect(toCssPoint({ x: 100, y: 50 }, 1.25)).toEqual({ x: 80, y: 40 });
  expect(toCssPoint({ x: 500, y: 250 }, 2.5)).toEqual({ x: 200, y: 100 });
  expect(toCssPoint({ x: 90, y: 45 }, 0.9)).toEqual({ x: 100, y: 50 });
});

test("the_ratio_is_the_webviews_physical_width_over_the_pages_css_width", () => {
  // A 1.25 zoom on a 1.0 scale, or a 2.0 scale at 100 %: the ratio is whatever the two widths say.
  expect(physicalPerCssPixel(1280, 1024)).toBe(1.25);
  expect(physicalPerCssPixel(2000, 1000)).toBe(2);
  expect(physicalPerCssPixel(1000, 1000)).toBe(1);
});

test.each([
  [0, 1000],
  [1000, 0],
  [-5, 1000],
  [Number.NaN, 1000],
  [1000, Number.POSITIVE_INFINITY],
])("widths_%s_and_%s_give_no_ratio", (physical, css) => {
  expect(() => physicalPerCssPixel(physical, css)).toThrow(RangeError);
});
