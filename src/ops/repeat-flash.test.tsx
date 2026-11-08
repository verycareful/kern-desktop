// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { FlashSpan, RepeatFlash } from "./repeat-flash";
import { useRepeatFlash } from "./use-repeat-flash";

// A message that is set again to the words it already shows gets a flash around its edge, so the
// user sees the new attempt was heard. A message that changes, or that is shown after being
// cleared, is new and needs none.

afterEach(cleanup);

type Props = { watch: unknown };

function flashes(first: unknown) {
  return renderHook(({ watch }: Props) => useRepeatFlash(watch), {
    initialProps: { watch: first },
  });
}

test("the_first_message_does_not_flash", () => {
  expect(flashes(["copy failed"]).result.current).toBe(0);
});

test("the_same_words_set_again_flash_once_each_time", () => {
  const h = flashes(["copy failed"]);
  h.rerender({ watch: ["copy failed"] });
  expect(h.result.current).toBe(1);
  h.rerender({ watch: ["copy failed"] });
  expect(h.result.current).toBe(2);
});

test("the_same_value_rendered_again_is_not_a_repeat", () => {
  const value = ["copy failed"];
  const h = flashes(value);
  h.rerender({ watch: value });
  h.rerender({ watch: value });
  expect(h.result.current).toBe(0);
});

test("other_words_replacing_a_message_do_not_flash_but_the_new_words_repeating_do", () => {
  const h = flashes(["copy failed"]);
  h.rerender({ watch: ["delete failed"] });
  expect(h.result.current).toBe(0);
  h.rerender({ watch: ["delete failed"] });
  expect(h.result.current).toBe(1);
});

test("a_message_shown_again_after_it_was_cleared_is_new", () => {
  const h = flashes({ kind: "Io", message: "no" });
  h.rerender({ watch: null });
  h.rerender({ watch: { kind: "Io", message: "no" } });
  expect(h.result.current).toBe(0);
  h.rerender({ watch: [] });
  h.rerender({ watch: { kind: "Io", message: "no" } });
  expect(h.result.current).toBe(0);
});

test("an_error_object_is_compared_by_what_it_says", () => {
  const h = flashes({ kind: "Io", message: "no", path: null });
  h.rerender({ watch: { kind: "Io", message: "no", path: null } });
  expect(h.result.current).toBe(1);
  h.rerender({ watch: { kind: "Io", message: "different", path: null } });
  expect(h.result.current).toBe(1);
});

test("the_flash_is_a_decoration_a_screen_reader_skips_and_a_repeat_draws_it_anew", () => {
  const { rerender, container } = render(<RepeatFlash watch={["x"]} />);
  expect(container.querySelector(".kern-repeat-flash")).toBeNull();
  rerender(<RepeatFlash watch={["x"]} />);
  const first = container.querySelector(".kern-repeat-flash");
  expect(first).toHaveAttribute("aria-hidden", "true");
  rerender(<RepeatFlash watch={["x"]} />);
  const second = container.querySelector(".kern-repeat-flash");
  // A new element, so the animation plays again.
  expect(second).not.toBe(first);
  expect(container.querySelectorAll(".kern-repeat-flash")).toHaveLength(1);
});

test("a_count_of_zero_draws_nothing_and_a_higher_count_draws_a_new_element", () => {
  const { rerender, container } = render(<FlashSpan count={0} />);
  expect(container.firstChild).toBeNull();
  rerender(<FlashSpan count={1} />);
  const one = container.firstChild;
  expect(one).not.toBeNull();
  rerender(<FlashSpan count={1} />);
  expect(container.firstChild).toBe(one);
  act(() => rerender(<FlashSpan count={2} />));
  expect(container.firstChild).not.toBe(one);
});
