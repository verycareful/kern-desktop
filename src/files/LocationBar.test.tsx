// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { WirePath } from "../ipc";

const ipc = vi.hoisted(() => ({ userDirs: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { LocationBar } from "./LocationBar";

// Design 5.1: the typed location. It closes when focus leaves it (R63), dropping
// what was typed, except while a submit is in flight.

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

beforeEach(() => {
  ipc.userDirs.mockResolvedValue({ home: p("/home/u") });
});
afterEach(() => {
  cleanup();
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

test("focus_leaving_the_window_closes_the_bar", () => {
  const input = bar();
  // Another window taking the focus blurs the input with no related target.
  fireEvent.blur(input, { relatedTarget: null });
  expect(onClose).toHaveBeenCalledWith("blur");
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
  expect(onClose).toHaveBeenCalledTimes(1);
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
