// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { openOnDoubleClick } from "./double-click";

function entry(open: () => void) {
  render(
    <button type="button" {...openOnDoubleClick(open)}>
      Documents
    </button>
  );
  return screen.getByRole("button", { name: "Documents" });
}

test("a_single_click_with_the_mouse_does_not_open", () => {
  const open = vi.fn();
  // A mouse click carries its click count in detail.
  fireEvent.click(entry(open), { detail: 1 });
  expect(open).not.toHaveBeenCalled();
});

test("a_double_click_opens_once", () => {
  const open = vi.fn();
  const button = entry(open);
  fireEvent.click(button, { detail: 1 });
  fireEvent.click(button, { detail: 2 });
  fireEvent.doubleClick(button, { detail: 2 });
  expect(open).toHaveBeenCalledTimes(1);
});

test("enter_or_space_on_the_button_opens", () => {
  const open = vi.fn();
  // The browser turns Enter and Space on a button into a click with detail 0.
  fireEvent.click(entry(open), { detail: 0 });
  expect(open).toHaveBeenCalledTimes(1);
});
