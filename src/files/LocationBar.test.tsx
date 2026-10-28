// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi, type MockInstance } from "vitest";
import type { WirePath } from "../ipc";

const ipc = vi.hoisted(() => ({ userDirs: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { LocationBar } from "./LocationBar";

// Design 5.1: the typed location. It closes when focus leaves it (R63), dropping
// what was typed, except while a submit is in flight and except when focus left
// Kern's window (R63a: Alt+Tab, another application), which leaves the bar as it
// was until the next blur inside Kern or Escape.

const p = (v: string): WirePath => ({ k: "Utf8", v });
const onNavigate = vi.fn();
const onClose = vi.fn();

function bar() {
  render(
    <>
      <LocationBar path={p("/d/here")} onNavigate={onNavigate} onClose={onClose} />
      <button type="button">elsewhere</button>
    </>
  );
  return screen.getByRole("textbox", { name: "Location" });
}

let hasFocus: MockInstance<() => boolean>;
beforeEach(() => {
  // Kern's window has focus. (jsdom reports no focus while a blur handler runs, which a real
  // browser does only when the whole window lost it.)
  hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  ipc.userDirs.mockResolvedValue({ home: p("/home/u") });
});
afterEach(() => {
  cleanup();
  // Only the spy on document.hasFocus: restoring every mock would also empty the ipc mocks that
  // an unmounting view still calls a microtask later.
  hasFocus.mockRestore();
  vi.clearAllMocks();
});

test("focus_moving_to_another_element_closes_the_bar_without_refocusing_the_list", () => {
  const input = bar();
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: "/typed" } });
  screen.getByRole("button", { name: "elsewhere" }).focus();
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledWith("blur");
  expect(onNavigate).not.toHaveBeenCalled();
});

// The window losing focus blurs the input while the document no longer has focus.
function leaveWindow(input: HTMLElement) {
  hasFocus.mockReturnValue(false);
  fireEvent.blur(input, { relatedTarget: null });
}

test("focus_leaving_kerns_window_keeps_the_bar_open_with_its_text", () => {
  const input = bar();
  fireEvent.change(input, { target: { value: "/typed" } });
  leaveWindow(input);
  expect(onClose).not.toHaveBeenCalled();
  expect(input).toHaveValue("/typed");
  expect(onNavigate).not.toHaveBeenCalled();
});

test("after_the_window_comes_back_the_next_blur_inside_kern_closes_the_bar", () => {
  const input = bar();
  fireEvent.change(input, { target: { value: "/typed" } });
  leaveWindow(input);
  // Back in Kern: the document has focus again and the user clicks elsewhere.
  hasFocus.mockReturnValue(true);
  fireEvent.focus(input);
  screen.getByRole("button", { name: "elsewhere" }).focus();
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledWith("blur");
});

test("escape_closes_a_bar_that_stayed_open_when_the_window_lost_focus", () => {
  const input = bar();
  leaveWindow(input);
  fireEvent.keyDown(input, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledWith("done");
});

test("enter_after_the_window_came_back_still_navigates", async () => {
  const input = bar();
  fireEvent.change(input, { target: { value: "/usr" } });
  leaveWindow(input);
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(p("/usr")));
  expect(onClose).toHaveBeenCalledWith("done");
});

test("enter_with_a_valid_path_navigates_and_closes_once", async () => {
  const input = bar();
  fireEvent.change(input, { target: { value: "/usr" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(p("/usr")));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledWith("done");
});

test("escape_closes_with_the_list_taking_the_keyboard_back", () => {
  const input = bar();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledWith("done");
  // The input leaving the page after the close is not a second close.
  cleanup();
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("a_blur_during_a_submit_neither_closes_nor_loses_the_error", async () => {
  let release: ((v: { home: WirePath }) => void) | undefined;
  ipc.userDirs.mockReturnValue(new Promise((r) => (release = r)));
  const input = bar();
  fireEvent.change(input, { target: { value: "~root/x" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(release).toBeDefined());
  screen.getByRole("button", { name: "elsewhere" }).focus();
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => release!({ home: p("/home/u") }));
  // The text was refused: the bar stays open and says why.
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
  expect(onNavigate).not.toHaveBeenCalled();
});

test("a_blur_during_a_submit_that_succeeds_closes_when_it_settles", async () => {
  let release: ((v: { home: WirePath }) => void) | undefined;
  ipc.userDirs.mockReturnValue(new Promise((r) => (release = r)));
  const input = bar();
  fireEvent.change(input, { target: { value: "~/Documents" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(release).toBeDefined());
  screen.getByRole("button", { name: "elsewhere" }).focus();
  await act(async () => release!({ home: p("/home/u") }));
  expect(onNavigate).toHaveBeenCalledWith(p("/home/u/Documents"));
  // Focus is where the user put it: the bar closes as a blur and does not pull it back to the list.
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledWith("blur");
});

test("a_blur_to_another_window_during_a_submit_that_succeeds_also_closes_as_a_blur", async () => {
  let release: ((v: { home: WirePath }) => void) | undefined;
  ipc.userDirs.mockReturnValue(new Promise((r) => (release = r)));
  const input = bar();
  fireEvent.change(input, { target: { value: "~/Documents" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(release).toBeDefined());
  leaveWindow(input);
  await act(async () => release!({ home: p("/home/u") }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledWith("blur");
});

test("a_check_that_succeeds_with_focus_still_in_the_bar_closes_as_done", async () => {
  const input = bar();
  fireEvent.change(input, { target: { value: "~/Documents" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(onNavigate).toHaveBeenCalled());
  expect(onClose).toHaveBeenCalledWith("done");
});

test("a_bar_that_stayed_open_with_an_error_closes_on_the_next_blur", async () => {
  const input = bar();
  fireEvent.change(input, { target: { value: "relative" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(input).toHaveFocus();
  screen.getByRole("button", { name: "elsewhere" }).focus();
  expect(onClose).toHaveBeenCalledWith("blur");
});
