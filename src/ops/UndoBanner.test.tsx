// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { WireError } from "../ipc";

const ipc = vi.hoisted(() => ({ undoState: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { UndoBanner } from "./UndoBanner";
import { useOps } from "./useOps";

const err = (message: string): WireError => ({
  kind: "Internal",
  message,
  path: null,
  details: null,
});

beforeEach(() => {
  useOps.getState().reset();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("nothing_is_shown_while_the_undo_history_reads_fine", () => {
  render(<UndoBanner />);
  expect(screen.queryByTestId("undo-error")).toBeNull();
});

test("an_unreadable_undo_history_is_a_banner_with_the_reason_and_a_retry", async () => {
  ipc.undoState.mockRejectedValue(err("journal poisoned"));
  render(<UndoBanner />);
  await act(() => useOps.getState().refreshUndo());
  const banner = screen.getByTestId("undo-error");
  expect(banner).toHaveTextContent("The undo history could not be read");
  expect(banner).toHaveTextContent("journal poisoned");
  expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
});

test("the_banner_is_not_modal_and_does_not_take_the_focus", async () => {
  const other = document.createElement("button");
  document.body.append(other);
  other.focus();
  ipc.undoState.mockRejectedValue(err("journal poisoned"));
  render(<UndoBanner />);
  await act(() => useOps.getState().refreshUndo());
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(screen.getByTestId("undo-error")).not.toHaveAttribute("aria-modal");
  expect(other).toHaveFocus();
  // A key aimed at the page is not held back.
  const event = new KeyboardEvent("keydown", {
    key: "z",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  other.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  other.remove();
});

test("retry_reads_the_history_again_and_the_banner_goes_when_it_works", async () => {
  ipc.undoState.mockRejectedValue(err("journal poisoned"));
  render(<UndoBanner />);
  await act(() => useOps.getState().refreshUndo());
  ipc.undoState.mockResolvedValue({ undo: null, redo: null });
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.queryByTestId("undo-error")).toBeNull());
  expect(ipc.undoState).toHaveBeenCalledTimes(2);
});

test("a_retry_that_fails_again_keeps_the_banner_with_the_new_reason", async () => {
  ipc.undoState.mockRejectedValue(err("first"));
  render(<UndoBanner />);
  await act(() => useOps.getState().refreshUndo());
  ipc.undoState.mockRejectedValue(err("second"));
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.getByTestId("undo-error")).toHaveTextContent("second"));
  expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
});
