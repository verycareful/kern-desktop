// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { usePageDrag } from "./usePageDrag";

// Three thumbnails in a column, each 100 tall, in a container 80 wide and 300 tall.
function rect(left: number, top: number, w: number, h: number): DOMRect {
  return {
    left,
    top,
    right: left + w,
    bottom: top + h,
    width: w,
    height: h,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

function Probe(props: { enabled?: boolean; onDrop(from: number, gap: number): void }) {
  const box = useRef<HTMLDivElement>(null);
  const drag = usePageDrag({
    container: box,
    axis: "y",
    enabled: props.enabled ?? true,
    onDrop: props.onDrop,
  });
  return (
    <div ref={box} data-testid="box" onPointerDown={drag.onPointerDown}>
      {[0, 1, 2].map((p) => (
        <div key={p} data-page-item={p} data-testid={`item-${p}`}>
          <button type="button">{p}</button>
        </div>
      ))}
    </div>
  );
}

function layout() {
  screen.getByTestId("box").getBoundingClientRect = () => rect(0, 0, 80, 300);
  for (let p = 0; p < 3; p++) {
    screen.getByTestId(`item-${p}`).getBoundingClientRect = () => rect(0, p * 100, 80, 90);
  }
}

afterEach(() => {
  cleanup();
  document.body.className = "";
});

function drag(from: number, to: { x: number; y: number }, keys: Partial<PointerEventInit> = {}) {
  const el = screen.getByTestId(`item-${from}`).querySelector("button")!;
  fireEvent.pointerDown(el, { button: 0, clientX: 40, clientY: from * 100 + 40, ...keys });
  fireEvent.pointerMove(window, { clientX: to.x, clientY: to.y });
  fireEvent.pointerUp(window, { clientX: to.x, clientY: to.y });
}

test("dragging_a_page_into_a_gap_drops_it_there", () => {
  const onDrop = vi.fn();
  render(<Probe onDrop={onDrop} />);
  layout();
  drag(0, { x: 40, y: 270 });
  expect(onDrop).toHaveBeenCalledExactlyOnceWith(0, 3);
});

test("a_press_that_does_not_travel_drops_nothing", () => {
  const onDrop = vi.fn();
  render(<Probe onDrop={onDrop} />);
  layout();
  drag(1, { x: 42, y: 142 });
  expect(onDrop).not.toHaveBeenCalled();
});

test("a_drag_that_ends_outside_the_container_drops_nothing", () => {
  const onDrop = vi.fn();
  render(<Probe onDrop={onDrop} />);
  layout();
  drag(0, { x: 500, y: 150 });
  expect(onDrop).not.toHaveBeenCalled();
});

test("a_press_with_ctrl_or_shift_is_a_choice_of_pages_and_starts_no_drag", () => {
  const onDrop = vi.fn();
  render(<Probe onDrop={onDrop} />);
  layout();
  drag(0, { x: 40, y: 270 }, { ctrlKey: true });
  drag(0, { x: 40, y: 270 }, { shiftKey: true });
  expect(onDrop).not.toHaveBeenCalled();
});

test("nothing_is_dragged_while_the_pages_cannot_be_moved", () => {
  const onDrop = vi.fn();
  render(<Probe enabled={false} onDrop={onDrop} />);
  layout();
  drag(0, { x: 40, y: 270 });
  expect(onDrop).not.toHaveBeenCalled();
});

test("escape_ends_the_drag_and_the_gap_mark_goes", () => {
  const onDrop = vi.fn();
  render(<Probe onDrop={onDrop} />);
  layout();
  const el = screen.getByTestId("item-0").querySelector("button")!;
  fireEvent.pointerDown(el, { button: 0, clientX: 40, clientY: 40 });
  fireEvent.pointerMove(window, { clientX: 40, clientY: 120 });
  expect(screen.getByTestId("item-1").className).toContain("kern-pdf-gap-before");
  expect(document.body.classList.contains("kern-dragging")).toBe(true);
  fireEvent.keyDown(window, { key: "Escape" });
  fireEvent.pointerUp(window, { clientX: 40, clientY: 120 });
  expect(onDrop).not.toHaveBeenCalled();
  expect(screen.getByTestId("item-1").className).not.toContain("kern-pdf-gap");
  expect(document.body.classList.contains("kern-dragging")).toBe(false);
});

test("the_gap_after_the_last_page_is_marked_on_that_page", () => {
  render(<Probe onDrop={vi.fn()} />);
  layout();
  const el = screen.getByTestId("item-0").querySelector("button")!;
  fireEvent.pointerDown(el, { button: 0, clientX: 40, clientY: 40 });
  fireEvent.pointerMove(window, { clientX: 40, clientY: 280 });
  expect(screen.getByTestId("item-2").className).toContain("kern-pdf-gap-after");
  fireEvent.pointerUp(window, { clientX: 40, clientY: 280 });
});
