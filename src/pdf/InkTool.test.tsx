// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi, type Mock } from "vitest";
import type { Rgb } from "../ipc/pdf";
import { INK_GROUP_MS } from "./annotations";
import { InkTool } from "./InkTool";

const SIZE = 1000;
const RED: Rgb = [0.9, 0.15, 0.15];
const BLUE: Rgb = [0.35, 0.65, 1];

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    right: SIZE,
    bottom: SIZE,
    width: SIZE,
    height: SIZE,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const surface = () => screen.getByTestId("pdf-ink-surface");

function stroke(points: [number, number][]) {
  const [first, ...rest] = points;
  fireEvent.pointerDown(surface(), {
    button: 0,
    pointerId: 1,
    clientX: first![0],
    clientY: first![1],
  });
  for (const [x, y] of rest) {
    fireEvent.pointerMove(surface(), { pointerId: 1, clientX: x, clientY: y });
  }
  fireEvent.pointerUp(surface(), { pointerId: 1 });
}

const elapse = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

type OnGroup = Parameters<typeof InkTool>[0]["onGroup"];

function tool(over: { colour?: Rgb; onGroup?: Mock<OnGroup> } = {}) {
  const onGroup = over.onGroup ?? vi.fn<OnGroup>().mockResolvedValue(undefined);
  const element = (colour: Rgb) => (
    <InkTool colour={colour} widthPt={2} pxPerPt={2} onGroup={onGroup} />
  );
  const view = render(element(over.colour ?? RED));
  return { onGroup, view, element };
}

test("lines_drawn_close_together_are_one_change", () => {
  const { onGroup } = tool();
  stroke([
    [100, 100],
    [200, 200],
  ]);
  elapse(INK_GROUP_MS - 100);
  stroke([
    [300, 300],
    [400, 300],
  ]);
  elapse(INK_GROUP_MS - 1);
  expect(onGroup).not.toHaveBeenCalled();
  elapse(1);
  expect(onGroup).toHaveBeenCalledTimes(1);
  expect(onGroup).toHaveBeenCalledWith(
    [
      [
        [0.1, 0.1],
        [0.2, 0.2],
      ],
      [
        [0.3, 0.3],
        [0.4, 0.3],
      ],
    ],
    RED,
    2
  );
});

test("a_press_that_does_not_move_is_a_dot", () => {
  const { onGroup } = tool();
  stroke([[500, 500]]);
  elapse(INK_GROUP_MS);
  expect(onGroup).toHaveBeenCalledWith([[[0.5, 0.5]]], RED, 2);
});

test("a_line_stays_on_show_until_the_engine_has_answered", async () => {
  let answer: () => void = () => undefined;
  const onGroup = vi.fn<OnGroup>(() => new Promise<void>((resolve) => (answer = resolve)));
  tool({ onGroup });
  stroke([
    [100, 100],
    [200, 200],
  ]);
  expect(surface().querySelectorAll("polyline")).toHaveLength(1);
  elapse(INK_GROUP_MS);
  expect(surface().querySelectorAll("polyline")).toHaveLength(1);
  await act(async () => answer());
  expect(surface().querySelectorAll("polyline")).toHaveLength(0);
});

test("a_line_in_another_colour_is_another_change", () => {
  const { onGroup, view, element } = tool();
  stroke([
    [100, 100],
    [200, 200],
  ]);
  view.rerender(element(BLUE));
  stroke([
    [300, 300],
    [400, 400],
  ]);
  expect(onGroup).toHaveBeenCalledTimes(1);
  expect(onGroup.mock.calls[0]![1]).toEqual(RED);
  elapse(INK_GROUP_MS);
  expect(onGroup).toHaveBeenCalledTimes(2);
  expect(onGroup.mock.calls[1]![1]).toEqual(BLUE);
});

test("leaving_the_tool_makes_what_was_drawn_a_change_and_does_not_drop_it", () => {
  const { onGroup, view } = tool();
  stroke([
    [100, 100],
    [200, 200],
  ]);
  view.unmount();
  expect(onGroup).toHaveBeenCalledTimes(1);
  elapse(INK_GROUP_MS);
  expect(onGroup).toHaveBeenCalledTimes(1);
});

test("a_line_still_being_drawn_when_the_tool_is_left_is_kept", () => {
  const { onGroup, view } = tool();
  fireEvent.pointerDown(surface(), { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(surface(), { pointerId: 1, clientX: 300, clientY: 300 });
  view.unmount();
  expect(onGroup).toHaveBeenCalledTimes(1);
});

test("only_the_main_button_draws", () => {
  const { onGroup } = tool();
  fireEvent.pointerDown(surface(), { button: 2, pointerId: 1, clientX: 100, clientY: 100 });
  fireEvent.pointerUp(surface(), { pointerId: 1 });
  elapse(INK_GROUP_MS);
  expect(onGroup).not.toHaveBeenCalled();
});

test("escape_drops_the_line_being_drawn_and_the_lines_not_yet_sent", () => {
  const { onGroup } = tool();
  stroke([
    [100, 100],
    [200, 200],
  ]);
  fireEvent.pointerDown(surface(), { button: 0, pointerId: 1, clientX: 300, clientY: 300 });
  fireEvent.pointerMove(surface(), { pointerId: 1, clientX: 400, clientY: 300 });
  expect(surface().querySelectorAll("polyline")).toHaveLength(2);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(surface().querySelectorAll("polyline")).toHaveLength(0);
  // The pointer that is still down draws nothing more, and nothing is sent.
  fireEvent.pointerMove(surface(), { pointerId: 1, clientX: 500, clientY: 300 });
  fireEvent.pointerUp(surface(), { pointerId: 1 });
  elapse(INK_GROUP_MS * 2);
  expect(onGroup).not.toHaveBeenCalled();
  expect(surface().querySelectorAll("polyline")).toHaveLength(0);
});

test("escape_leaves_a_line_already_sent_and_the_tool_draws_again", async () => {
  let answer: () => void = () => undefined;
  const onGroup = vi.fn<OnGroup>(() => new Promise<void>((resolve) => (answer = resolve)));
  tool({ onGroup });
  stroke([
    [100, 100],
    [200, 200],
  ]);
  elapse(INK_GROUP_MS);
  expect(onGroup).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(surface().querySelectorAll("polyline")).toHaveLength(1);
  await act(async () => answer());
  stroke([
    [300, 300],
    [400, 300],
  ]);
  elapse(INK_GROUP_MS);
  expect(onGroup).toHaveBeenCalledTimes(2);
});
