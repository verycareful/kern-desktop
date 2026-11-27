// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FindBar } from "./FindBar";
import { usePdfFind } from "./pdf-find";

const TAB = "tab-1";
const hit = (y: number) => ({
  rects: [[0.1, y, 0.2, y + 0.02]] as [number, number, number, number][],
});
const store = () => usePdfFind.getState();
const mine = () => usePdfFind.getState().byTab[TAB];
const count = () => screen.getByTestId("pdf-find-count").textContent;

beforeEach(() => usePdfFind.setState({ byTab: {} }));
afterEach(cleanup);

test("a_closed_bar_shows_nothing", () => {
  render(<FindBar tabId={TAB} />);
  expect(screen.queryByTestId("pdf-find")).toBeNull();
});

test("the_bar_takes_the_focus_when_asked_for_and_again_when_asked_for_while_open", () => {
  render(<FindBar tabId={TAB} />);
  act(() => store().open(TAB, "word"));
  const field = screen.getByRole("searchbox", { name: "Find" });
  expect(document.activeElement).toBe(field);
  (document.activeElement as HTMLElement).blur();
  act(() => store().open(TAB));
  expect(document.activeElement).toBe(field);
});

test("typing_sets_the_question_and_the_options_are_toggles", () => {
  render(<FindBar tabId={TAB} />);
  act(() => store().open(TAB));
  fireEvent.change(screen.getByRole("searchbox", { name: "Find" }), { target: { value: "cat" } });
  expect(mine()?.query).toBe("cat");
  const matchCase = screen.getByRole("button", { name: "Match case" });
  const wholeWord = screen.getByRole("button", { name: "Whole word" });
  expect(matchCase).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(matchCase);
  fireEvent.click(wholeWord);
  expect(matchCase).toHaveAttribute("aria-pressed", "true");
  expect(mine()).toMatchObject({ caseSensitive: true, wholeWord: true });
});

test("the_count_says_searching_none_the_position_or_why_it_stopped", () => {
  render(<FindBar tabId={TAB} />);
  act(() => store().open(TAB, "cat"));
  act(() => store().begin(TAB));
  expect(count()).toBe("Searching…");
  act(() => store().finish(TAB, null));
  expect(count()).toBe("No matches");
  act(() => store().begin(TAB));
  act(() => store().report(TAB, 3, [hit(0.1), hit(0.2)]));
  expect(count()).toBe("1 of 2+");
  act(() => store().finish(TAB, null));
  expect(count()).toBe("1 of 2");
  act(() => store().finish(TAB, "The pages could not be read"));
  expect(count()).toBe("The pages could not be read");
  act(() => store().setQuery(TAB, ""));
});

test("enter_and_shift_enter_and_the_buttons_step_and_escape_closes", () => {
  render(<FindBar tabId={TAB} />);
  act(() => store().open(TAB, "cat"));
  act(() => {
    store().begin(TAB);
    store().report(TAB, 0, [hit(0.1)]);
    store().report(TAB, 5, [hit(0.2), hit(0.3)]);
    store().finish(TAB, null);
  });
  const field = screen.getByRole("searchbox", { name: "Find" });
  expect(count()).toBe("1 of 3");
  fireEvent.keyDown(field, { key: "Enter" });
  expect(count()).toBe("2 of 3");
  fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
  expect(count()).toBe("1 of 3");
  fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
  expect(count()).toBe("3 of 3");
  fireEvent.click(screen.getByRole("button", { name: "Next match" }));
  expect(count()).toBe("1 of 3");
  fireEvent.click(screen.getByRole("button", { name: "Previous match" }));
  expect(count()).toBe("3 of 3");
  fireEvent.keyDown(field, { key: "Escape" });
  expect(mine()?.open).toBe(false);
  expect(screen.queryByTestId("pdf-find")).toBeNull();
});

test("the_step_buttons_wait_for_a_match", () => {
  render(<FindBar tabId={TAB} />);
  act(() => store().open(TAB, "cat"));
  expect(screen.getByRole("button", { name: "Next match" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Previous match" })).toBeDisabled();
});

test("f3_and_ctrl_f_in_the_field_step_and_select_it_since_the_table_leaves_that_field_its_keys", () => {
  render(<FindBar tabId={TAB} />);
  act(() => store().open(TAB, "cat"));
  act(() => {
    store().begin(TAB);
    store().report(TAB, 0, [hit(0.1), hit(0.2)]);
    store().finish(TAB, null);
  });
  const field = screen.getByRole("searchbox", { name: "Find" }) as HTMLInputElement;
  fireEvent.keyDown(field, { key: "F3" });
  expect(count()).toBe("2 of 2");
  fireEvent.keyDown(field, { key: "F3", shiftKey: true });
  expect(count()).toBe("1 of 2");
  const select = vi.spyOn(field, "select");
  fireEvent.keyDown(field, { key: "f", ctrlKey: true });
  expect(select).toHaveBeenCalledTimes(1);
});
