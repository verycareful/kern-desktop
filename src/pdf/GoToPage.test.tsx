// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { GoToPage } from "./GoToPage";
import { parsePage } from "./page-number";

test("a_valid_page_is_taken_counted_from_0", () => {
  const onGo = vi.fn();
  render(<GoToPage pages={10} current={0} onGo={onGo} onCancel={vi.fn()} />);
  const field = screen.getByLabelText(/^Page/);
  fireEvent.change(field, { target: { value: " 7 " } });
  fireEvent.keyDown(field, { key: "Enter" });
  expect(onGo).toHaveBeenCalledWith(6);
});

test("it_opens_on_the_page_in_view", () => {
  render(<GoToPage pages={10} current={3} onGo={vi.fn()} onCancel={vi.fn()} />);
  expect(screen.getByLabelText(/^Page/)).toHaveValue("4");
});

test.each([
  ["", "Enter a page number."],
  ["  ", "Enter a page number."],
  ["abc", "A page number is digits only."],
  ["1.5", "A page number is digits only."],
  ["-2", "A page number is digits only."],
  ["0", "This file has pages 1 to 10."],
  ["11", "This file has pages 1 to 10."],
])("%j_is_refused_under_the_field_and_never_clamped", (value, problem) => {
  const onGo = vi.fn();
  render(<GoToPage pages={10} current={0} onGo={onGo} onCancel={vi.fn()} />);
  const field = screen.getByLabelText(/^Page/);
  fireEvent.change(field, { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Go" }));
  expect(screen.getByRole("alert")).toHaveTextContent(problem);
  expect(field).toHaveAttribute("aria-invalid", "true");
  expect(onGo).not.toHaveBeenCalled();
});

test("typing_again_clears_the_reason", () => {
  render(<GoToPage pages={10} current={0} onGo={vi.fn()} onCancel={vi.fn()} />);
  const field = screen.getByLabelText(/^Page/);
  fireEvent.change(field, { target: { value: "99" } });
  fireEvent.click(screen.getByRole("button", { name: "Go" }));
  fireEvent.change(field, { target: { value: "9" } });
  expect(screen.queryByRole("alert")).toBeNull();
});

test("escape_and_cancel_give_up", () => {
  const onCancel = vi.fn();
  render(<GoToPage pages={10} current={0} onGo={vi.fn()} onCancel={onCancel} />);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onCancel).toHaveBeenCalledTimes(1);
});

test("parsePage_takes_the_first_and_last_page", () => {
  expect(parsePage("1", 3)).toEqual({ page: 1 });
  expect(parsePage("3", 3)).toEqual({ page: 3 });
  expect(parsePage("4", 3)).toEqual({ problem: "This file has pages 1 to 3." });
});
