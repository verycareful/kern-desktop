// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { WireEntry } from "../ipc";
import { useItemDrag } from "./use-item-drag";
import { entry } from "./test-entries";

// A press on an item names the item by the key its own element carries, so what is dragged is
// the thing under the pointer and not whatever a ref last held.

function Probe(props: { itemsFor(key: string): readonly WireEntry[] }) {
  const drag = useItemDrag({ itemsFor: props.itemsFor, onDrop: vi.fn(), onLeave: vi.fn() });
  return (
    <div onPointerDown={drag.onPointerDown}>
      <div data-item data-key="Utf8:/d/a" data-testid="keyed">
        a
      </div>
      <div data-item data-testid="unkeyed">
        b
      </div>
      <div ref={drag.ghost} hidden />
    </div>
  );
}

// jsdom has no hit testing: nothing is under the pointer.
beforeEach(() => {
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => null });
});
afterEach(() => {
  cleanup();
  delete (document as { elementFromPoint?: unknown }).elementFromPoint;
});

function dragFar(target: Element) {
  fireEvent.pointerDown(target, { button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(window, { clientX: 60, clientY: 60 });
  fireEvent.pointerUp(window, { clientX: 60, clientY: 60 });
}

test("the_item_dragged_is_the_one_the_pressed_element_names", () => {
  const itemsFor = vi.fn(() => [entry("a")]);
  render(<Probe itemsFor={itemsFor} />);
  dragFar(screen.getByTestId("keyed"));
  expect(itemsFor).toHaveBeenCalledExactlyOnceWith("Utf8:/d/a");
});

test("an_element_with_no_key_starts_no_drag", () => {
  const itemsFor = vi.fn(() => [entry("b")]);
  render(<Probe itemsFor={itemsFor} />);
  dragFar(screen.getByTestId("unkeyed"));
  expect(itemsFor).not.toHaveBeenCalled();
});
