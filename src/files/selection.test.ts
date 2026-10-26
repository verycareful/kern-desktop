// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import {
  click,
  ctrlClick,
  empty,
  move,
  rubberBand,
  selectAll,
  selectNone,
  shiftClick,
  type Sel,
} from "./selection";

const ids = (s: Sel) => [...s.selected].sort((a, b) => a - b);

test("click_selects_only_that_item", () => {
  const s = click(ctrlClick(click(empty, 1), 3), 5);
  expect(ids(s)).toEqual([5]);
  expect(s.anchor).toBe(5);
  expect(s.cursor).toBe(5);
});

test("ctrl_toggles", () => {
  let s = click(empty, 1);
  s = ctrlClick(s, 3);
  expect(ids(s)).toEqual([1, 3]);
  s = ctrlClick(s, 1);
  expect(ids(s)).toEqual([3]);
  s = ctrlClick(s, 3);
  expect(ids(s)).toEqual([]);
  expect(s.cursor).toBe(3);
});

test("shift_extends_from_anchor", () => {
  let s = click(empty, 4);
  s = shiftClick(s, 7);
  expect(ids(s)).toEqual([4, 5, 6, 7]);
  // The anchor stays: shifting back over it selects the other side only.
  s = shiftClick(s, 2);
  expect(ids(s)).toEqual([2, 3, 4]);
  expect(s.anchor).toBe(4);
  expect(s.cursor).toBe(2);
});

test("shift_click_without_an_anchor_selects_that_item", () => {
  const s = shiftClick(empty, 6);
  expect(ids(s)).toEqual([6]);
  expect(s.anchor).toBe(6);
});

test("rubber_band_replaces_unless_additive", () => {
  const base = ctrlClick(click(empty, 0), 9);
  expect(ids(rubberBand(base, [2, 3, 4], false))).toEqual([2, 3, 4]);
});

test("rubber_band_additive_with_ctrl", () => {
  const base = ctrlClick(click(empty, 0), 9);
  const s = rubberBand(base, [2, 3, 4], true);
  expect(ids(s)).toEqual([0, 2, 3, 4, 9]);
  // The band is recomputed from the same base as it grows or shrinks.
  expect(ids(rubberBand(base, [2], true))).toEqual([0, 2, 9]);
  expect(ids(rubberBand(base, [], true))).toEqual([0, 9]);
  expect(ids(rubberBand(base, [], false))).toEqual([]);
});

test("select_all_and_none", () => {
  const all = selectAll(click(empty, 2), 4);
  expect(ids(all)).toEqual([0, 1, 2, 3]);
  expect(ids(selectNone(all))).toEqual([]);
  expect(ids(selectAll(empty, 0))).toEqual([]);
});

test("move_selects_the_neighbour", () => {
  expect(ids(move(empty, 1, false, 5))).toEqual([0]);
  expect(ids(move(empty, -1, false, 5))).toEqual([4]);
  expect(ids(move(click(empty, 2), 1, false, 5))).toEqual([3]);
  // Clamped at both ends.
  expect(ids(move(click(empty, 4), 1, false, 5))).toEqual([4]);
  expect(ids(move(click(empty, 0), -3, false, 5))).toEqual([0]);
  expect(ids(move(click(empty, 2), Infinity, false, 5))).toEqual([4]);
  expect(ids(move(click(empty, 2), -Infinity, false, 5))).toEqual([0]);
});

test("move_with_extend_grows_from_the_anchor", () => {
  let s = click(empty, 2);
  s = move(s, 1, true, 10);
  s = move(s, 1, true, 10);
  expect(ids(s)).toEqual([2, 3, 4]);
  s = move(s, -1, true, 10);
  expect(ids(s)).toEqual([2, 3]);
  s = move(s, -3, true, 10);
  expect(ids(s)).toEqual([0, 1, 2]);
  expect(s.anchor).toBe(2);
});

test("move_in_an_empty_list_selects_nothing", () => {
  expect(ids(move(empty, 1, false, 0))).toEqual([]);
});
