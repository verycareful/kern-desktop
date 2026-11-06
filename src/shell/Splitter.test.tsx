// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { Splitter } from "./Splitter";

function divider(grows: "left" | "right", setWidth: (w: number) => void) {
  render(
    <Splitter
      width={300}
      min={180}
      max={640}
      setWidth={setWidth}
      grows={grows}
      label="Resize"
      className="kern-splitter"
      testId="splitter"
    />
  );
  return screen.getByRole("separator", { name: "Resize" });
}

test("a_pane_on_the_right_widens_as_the_divider_moves_left", () => {
  const setWidth = vi.fn();
  const d = divider("left", setWidth);
  fireEvent.keyDown(d, { key: "ArrowLeft" });
  fireEvent.keyDown(d, { key: "ArrowRight", shiftKey: true });
  expect(setWidth.mock.calls).toEqual([[316], [236]]);
});

test("a_pane_on_the_left_widens_as_the_divider_moves_right", () => {
  const setWidth = vi.fn();
  const d = divider("right", setWidth);
  fireEvent.keyDown(d, { key: "ArrowRight" });
  fireEvent.keyDown(d, { key: "ArrowLeft", shiftKey: true });
  expect(setWidth.mock.calls).toEqual([[316], [236]]);
});

test("home_and_end_give_the_narrowest_and_widest", () => {
  const setWidth = vi.fn();
  const d = divider("left", setWidth);
  fireEvent.keyDown(d, { key: "Home" });
  fireEvent.keyDown(d, { key: "End" });
  expect(setWidth.mock.calls).toEqual([[180], [640]]);
});

test("a_drag_left_widens_a_pane_on_the_right_by_the_distance", () => {
  const setWidth = vi.fn();
  const d = divider("left", setWidth);
  fireEvent.pointerDown(d, { button: 0, clientX: 1000 });
  fireEvent.pointerMove(window, { clientX: 950 });
  fireEvent.pointerUp(window, { clientX: 950 });
  fireEvent.pointerMove(window, { clientX: 900 });
  expect(setWidth.mock.calls).toEqual([[350]]);
});

test("a_key_with_ctrl_is_left_to_the_shortcuts", () => {
  const setWidth = vi.fn();
  fireEvent.keyDown(divider("left", setWidth), { key: "ArrowLeft", ctrlKey: true });
  expect(setWidth).not.toHaveBeenCalled();
});
