// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { Panel } from "../ipc";
import { PanelOrder } from "./PanelOrder";

afterEach(cleanup);

const NAMES = { places: "Places", folder: "Files", pinned: "Pinned and Recent" } as const;

function show(order: Panel[], onChange = vi.fn(), between?: string) {
  render(
    <PanelOrder label="Order" order={order} names={NAMES} between={between} onChange={onChange} />
  );
  return onChange;
}

const button = (name: string) => screen.getByRole("button", { name });

test("the_panels_are_listed_in_their_order", () => {
  show(["pinned", "places", "folder"]);
  const chips = [...document.querySelectorAll("[data-panel]")].map((c) =>
    c.getAttribute("data-panel")
  );
  expect(chips).toEqual(["pinned", "places", "folder"]);
});

test("a_move_button_sends_the_whole_new_order", () => {
  const onChange = show(["places", "folder", "pinned"]);
  fireEvent.click(button("Move Files right"));
  expect(onChange).toHaveBeenLastCalledWith(["places", "pinned", "folder"]);
  fireEvent.click(button("Move Pinned and Recent left"));
  expect(onChange).toHaveBeenLastCalledWith(["places", "pinned", "folder"]);
});

test("the_first_panel_cannot_move_left_and_the_last_cannot_move_right", () => {
  show(["places", "folder", "pinned"]);
  expect(button("Move Places left")).toBeDisabled();
  expect(button("Move Places right")).toBeEnabled();
  expect(button("Move Pinned and Recent right")).toBeDisabled();
  expect(button("Move Pinned and Recent left")).toBeEnabled();
});

test("two_panels_swap_across_the_fixed_piece_between_them", () => {
  const onChange = show(["places", "pinned"], vi.fn(), "Editor");
  const group = screen.getByRole("group", { name: "Order" });
  expect(within(group).getByText("Editor")).toBeInTheDocument();
  expect(button("Move Places left")).toBeDisabled();
  fireEvent.click(button("Move Places right"));
  expect(onChange).toHaveBeenCalledWith(["pinned", "places"]);
});

test("the_fixed_piece_lies_between_the_two_panels", () => {
  show(["pinned", "places"], vi.fn(), "Editor");
  const text = screen.getByRole("group", { name: "Order" }).textContent ?? "";
  expect(text.indexOf("Pinned and Recent")).toBeLessThan(text.indexOf("Editor"));
  expect(text.indexOf("Editor")).toBeLessThan(text.indexOf("Places"));
});
